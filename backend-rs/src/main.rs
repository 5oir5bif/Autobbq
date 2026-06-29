use std::{
    env,
    net::SocketAddr,
    path::{Path as FsPath, PathBuf},
    str::FromStr,
    sync::Arc,
};

use anyhow::{anyhow, Context};
use axum::{
    extract::{DefaultBodyLimit, Multipart, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Utc;
use reqwest::multipart::{Form, Part};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    FromRow, SqlitePool,
};
use tokio::{process::Command, sync::RwLock};
use tower_http::{cors::CorsLayer, services::ServeDir, trace::TraceLayer};
use uuid::Uuid;

const SAMPLE_ENGLISH: [&str; 4] = [
    "Hello everyone, welcome to this demo video.",
    "This MVP extracts English speech and translates it into Chinese subtitles.",
    "You can edit subtitle style before rendering the final video.",
    "Click render to burn subtitles into the output file.",
];

#[derive(Clone)]
struct AppState {
    db: SqlitePool,
    runtime: Arc<RwLock<RuntimeConfig>>,
    settings: Arc<AppSettings>,
    client: reqwest::Client,
}

#[derive(Clone)]
struct AppSettings {
    port: u16,
    api_base_url: String,
    storage_dir: PathBuf,
    uploads_dir: PathBuf,
    subtitles_dir: PathBuf,
    output_dir: PathBuf,
    temp_dir: PathBuf,
    max_duration_sec: f64,
    max_upload_size_bytes: usize,
    asr_provider: String,
    translation_provider: String,
}

#[derive(Clone)]
struct RuntimeConfig {
    open_ai_api_key: Option<String>,
    open_ai_base_url: String,
    open_ai_asr_model: String,
    open_ai_translation_model: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeConfigView {
    open_ai_base_url: String,
    open_ai_asr_model: String,
    open_ai_translation_model: String,
    has_open_ai_api_key: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeConfigInput {
    open_ai_api_key: Option<String>,
    open_ai_base_url: Option<String>,
    open_ai_asr_model: Option<String>,
    open_ai_translation_model: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthView {
    ok: bool,
    backend: &'static str,
    database: &'static str,
    asr_provider: String,
    translation_provider: String,
    max_duration_sec: f64,
    max_upload_size_mb: usize,
}

#[derive(Serialize)]
struct ErrorView {
    message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Cue {
    start_sec: f64,
    end_sec: f64,
    text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VideoMetadata {
    duration_sec: f64,
    width: i64,
    height: i64,
    fps: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StyleConfig {
    font_size: f64,
    position: PositionConfig,
    #[serde(default = "default_max_width_ratio")]
    max_width_ratio: f64,
    #[serde(default)]
    stroke: StrokeConfig,
    #[serde(default)]
    shadow: ShadowConfig,
    #[serde(default = "default_font_family")]
    font_family: String,
    #[serde(default = "default_font_color")]
    font_color: String,
    #[serde(default = "default_text_align")]
    text_align: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct PositionConfig {
    x: f64,
    y: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct StrokeConfig {
    enabled: bool,
    width: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ShadowConfig {
    enabled: bool,
    opacity: f64,
}

impl Default for StrokeConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            width: 2.0,
        }
    }
}

impl Default for ShadowConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            opacity: 0.3,
        }
    }
}

#[derive(FromRow, Clone)]
struct VideoRow {
    id: String,
    original_filename: String,
    mime_type: String,
    original_path: String,
    original_url: String,
    duration_sec: f64,
    width: i64,
    height: i64,
    fps: f64,
    subtitle_en_url: Option<String>,
    subtitle_zh_path: Option<String>,
    subtitle_zh_url: Option<String>,
    output_url: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(FromRow)]
struct JobRow {
    id: String,
    status: String,
    progress: f64,
    error: Option<String>,
    result_json: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoView {
    video_id: String,
    original_url: String,
    duration_sec: f64,
    width: i64,
    height: i64,
    fps: f64,
    subtitle_en_url: Option<String>,
    subtitle_zh_url: Option<String>,
    output_url: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadView {
    video_id: String,
    original_url: String,
    duration_sec: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JobCreatedView {
    job_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JobView {
    job_id: String,
    status: String,
    progress: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    load_env();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let settings = Arc::new(AppSettings::from_env());
    ensure_storage_dirs(&settings).await?;

    let database_url = normalize_database_url(&env::var("DATABASE_URL").unwrap_or_else(|_| {
        format!(
            "sqlite:{}",
            settings
                .storage_dir
                .join("data/autobbq.sqlite")
                .to_string_lossy()
        )
    }));
    if let Some(parent) =
        sqlite_file_path(&database_url).and_then(|path| path.parent().map(|p| p.to_path_buf()))
    {
        tokio::fs::create_dir_all(parent).await?;
    }

    let connect_options = SqliteConnectOptions::from_str(&database_url)?.create_if_missing(true);
    let db = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(connect_options)
        .await?;
    run_migrations(&db).await?;

    let runtime = Arc::new(RwLock::new(RuntimeConfig::from_env()));
    let state = AppState {
        db,
        runtime,
        settings: settings.clone(),
        client: reqwest::Client::new(),
    };

    let app = Router::new()
        .route("/health", get(health))
        .route(
            "/api/runtime-config",
            get(get_runtime_config).post(update_runtime_config),
        )
        .route("/api/videos/upload", post(upload_video))
        .route("/api/videos/:id", get(get_video))
        .route("/api/videos/:id/process", post(enqueue_process_video))
        .route("/api/videos/:id/render", post(enqueue_render_video))
        .route("/api/videos/:id/output", get(get_output))
        .route("/api/jobs/:job_id", get(get_job))
        .nest_service("/files", ServeDir::new(settings.storage_dir.clone()))
        .layer(DefaultBodyLimit::disable())
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], settings.port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("rust backend listening on http://{addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

fn load_env() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let _ = dotenvy::from_path(manifest_dir.join("../.env"));
    let _ = dotenvy::dotenv();
}

async fn health(State(state): State<AppState>) -> Json<HealthView> {
    Json(HealthView {
        ok: true,
        backend: "rust-axum",
        database: "sqlite",
        asr_provider: state.settings.asr_provider.clone(),
        translation_provider: state.settings.translation_provider.clone(),
        max_duration_sec: state.settings.max_duration_sec,
        max_upload_size_mb: state.settings.max_upload_size_bytes / 1024 / 1024,
    })
}

async fn get_runtime_config(State(state): State<AppState>) -> Json<RuntimeConfigView> {
    Json(state.runtime.read().await.to_view())
}

async fn update_runtime_config(
    State(state): State<AppState>,
    Json(input): Json<RuntimeConfigInput>,
) -> Json<Value> {
    let mut config = state.runtime.write().await;
    if let Some(key) = input
        .open_ai_api_key
        .filter(|value| !value.trim().is_empty())
    {
        config.open_ai_api_key = Some(key);
    }
    if let Some(base_url) = input
        .open_ai_base_url
        .filter(|value| !value.trim().is_empty())
    {
        config.open_ai_base_url = base_url;
    }
    if let Some(model) = input
        .open_ai_asr_model
        .filter(|value| !value.trim().is_empty())
    {
        config.open_ai_asr_model = model;
    }
    if let Some(model) = input
        .open_ai_translation_model
        .filter(|value| !value.trim().is_empty())
    {
        config.open_ai_translation_model = model;
    }

    let view = config.to_view();
    Json(json!({
        "message": "Runtime config updated",
        "openAiBaseUrl": view.open_ai_base_url,
        "openAiAsrModel": view.open_ai_asr_model,
        "openAiTranslationModel": view.open_ai_translation_model,
        "hasOpenAiApiKey": view.has_open_ai_api_key,
    }))
}

async fn upload_video(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    match async {
        let file = read_upload_file(&state, &mut multipart).await?;
        create_video_from_upload(&state, file).await
    }
    .await
    {
        Ok(view) => (StatusCode::OK, Json(view)).into_response(),
        Err(error) => client_error(error),
    }
}

async fn get_video(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    match load_video(&state.db, &id).await {
        Ok(Some(video)) => (StatusCode::OK, Json(video_to_view(&state, video))).into_response(),
        Ok(None) => not_found("Video not found"),
        Err(error) => server_error(error),
    }
}

async fn enqueue_process_video(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match load_video(&state.db, &id).await {
        Ok(Some(_)) => match create_job(&state.db, "processVideo", &id, None).await {
            Ok(job_id) => {
                let cloned = state.clone();
                let task_job_id = job_id.clone();
                tokio::spawn(async move {
                    if let Err(error) =
                        process_video_job(cloned.clone(), task_job_id.clone(), id).await
                    {
                        let _ = fail_job(&cloned.db, &task_job_id, &error.to_string()).await;
                    }
                });
                (StatusCode::OK, Json(JobCreatedView { job_id })).into_response()
            }
            Err(error) => server_error(error),
        },
        Ok(None) => not_found("Video not found"),
        Err(error) => server_error(error),
    }
}

async fn enqueue_render_video(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(style): Json<StyleConfig>,
) -> impl IntoResponse {
    if let Err(message) = validate_style_config(&style) {
        return (StatusCode::BAD_REQUEST, Json(ErrorView { message })).into_response();
    }

    match load_video(&state.db, &id).await {
        Ok(Some(_)) => match create_job(&state.db, "renderVideo", &id, Some(&style)).await {
            Ok(job_id) => {
                let cloned = state.clone();
                let task_job_id = job_id.clone();
                tokio::spawn(async move {
                    if let Err(error) =
                        render_video_job(cloned.clone(), task_job_id.clone(), id, style).await
                    {
                        let _ = fail_job(&cloned.db, &task_job_id, &error.to_string()).await;
                    }
                });
                (StatusCode::OK, Json(JobCreatedView { job_id })).into_response()
            }
            Err(error) => server_error(error),
        },
        Ok(None) => not_found("Video not found"),
        Err(error) => server_error(error),
    }
}

async fn get_output(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    match load_video(&state.db, &id).await {
        Ok(Some(video)) => match video.output_url {
            Some(url) => (
                StatusCode::OK,
                Json(json!({ "outputUrl": absolute_url(&state.settings.api_base_url, &url) })),
            )
                .into_response(),
            None => not_found("Output video not ready"),
        },
        Ok(None) => not_found("Video not found"),
        Err(error) => server_error(error),
    }
}

async fn get_job(State(state): State<AppState>, Path(job_id): Path<String>) -> impl IntoResponse {
    match load_job(&state.db, &job_id).await {
        Ok(Some(job)) => (StatusCode::OK, Json(job)).into_response(),
        Ok(None) => not_found("Job not found"),
        Err(error) => server_error(error),
    }
}

struct UploadFile {
    original_filename: String,
    mime_type: String,
    temp_path: PathBuf,
}

async fn read_upload_file(
    state: &AppState,
    multipart: &mut Multipart,
) -> anyhow::Result<UploadFile> {
    while let Some(field) = multipart
        .next_field()
        .await
        .context("Invalid multipart form")?
    {
        if field.name() != Some("file") {
            continue;
        }

        let original_filename = field.file_name().unwrap_or("upload.mp4").to_string();
        let mime_type = field
            .content_type()
            .map(ToString::to_string)
            .unwrap_or_else(|| "application/octet-stream".to_string());
        if !is_allowed_video_file(&original_filename, &mime_type) {
            return Err(anyhow!("Unsupported file format. Allowed: mp4, mov, webm"));
        }

        let bytes = field.bytes().await.context("Unable to read upload body")?;
        if bytes.len() > state.settings.max_upload_size_bytes {
            return Err(anyhow!(
                "File too large. Max allowed is {}MB",
                state.settings.max_upload_size_bytes / 1024 / 1024
            ));
        }

        let ext = file_extension(&original_filename).unwrap_or_else(|| "mp4".to_string());
        let temp_path = state
            .settings
            .temp_dir
            .join(format!("{}.{}", Uuid::new_v4(), ext));
        tokio::fs::write(&temp_path, bytes).await?;
        return Ok(UploadFile {
            original_filename,
            mime_type,
            temp_path,
        });
    }

    Err(anyhow!("file is required"))
}

async fn create_video_from_upload(
    state: &AppState,
    upload: UploadFile,
) -> anyhow::Result<UploadView> {
    let metadata = match ffprobe_video(&upload.temp_path).await {
        Ok(metadata) => metadata,
        Err(error) => {
            let _ = tokio::fs::remove_file(&upload.temp_path).await;
            return Err(error);
        }
    };

    if metadata.duration_sec <= 0.0 || metadata.duration_sec > state.settings.max_duration_sec {
        let _ = tokio::fs::remove_file(&upload.temp_path).await;
        return Err(anyhow!(
            "Video duration exceeds {} seconds",
            state.settings.max_duration_sec
        ));
    }

    let video_id = Uuid::new_v4().to_string();
    let ext = file_extension(&upload.original_filename).unwrap_or_else(|| "mp4".to_string());
    let final_path = state
        .settings
        .uploads_dir
        .join(format!("{}.{}", video_id, ext));
    tokio::fs::rename(&upload.temp_path, &final_path).await?;

    let now = now_iso();
    let original_url = public_file_url(&state.settings, &final_path)?;

    sqlx::query(
        "INSERT INTO videos (id, original_filename, mime_type, original_path, original_url, duration_sec, width, height, fps, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&video_id)
    .bind(&upload.original_filename)
    .bind(&upload.mime_type)
    .bind(final_path.to_string_lossy().to_string())
    .bind(&original_url)
    .bind(metadata.duration_sec)
    .bind(metadata.width)
    .bind(metadata.height)
    .bind(metadata.fps)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await?;

    Ok(UploadView {
        video_id,
        original_url: absolute_url(&state.settings.api_base_url, &original_url),
        duration_sec: metadata.duration_sec,
    })
}

async fn process_video_job(
    state: AppState,
    job_id: String,
    video_id: String,
) -> anyhow::Result<()> {
    update_job(&state.db, &job_id, "running", 10.0, None, None).await?;
    let video = load_video(&state.db, &video_id)
        .await?
        .ok_or_else(|| anyhow!("Video not found"))?;

    let en_cues = transcribe(&state, &video).await?;
    if en_cues.is_empty() {
        return Err(anyhow!("ASR returned empty subtitles"));
    }

    update_job(&state.db, &job_id, "running", 45.0, None, None).await?;
    let texts: Vec<String> = en_cues.iter().map(|cue| cue.text.clone()).collect();
    let zh_texts = translate(&state, &texts).await?;
    if zh_texts.len() != en_cues.len() {
        return Err(anyhow!("Translation result count mismatch"));
    }

    let zh_cues: Vec<Cue> = en_cues
        .iter()
        .zip(zh_texts.iter())
        .map(|(cue, text)| Cue {
            text: text.clone(),
            ..cue.clone()
        })
        .collect();

    let en_vtt_path = state
        .settings
        .subtitles_dir
        .join(format!("{}.en.vtt", video.id));
    let en_srt_path = state
        .settings
        .subtitles_dir
        .join(format!("{}.en.srt", video.id));
    let zh_vtt_path = state
        .settings
        .subtitles_dir
        .join(format!("{}.zh.vtt", video.id));
    let zh_srt_path = state
        .settings
        .subtitles_dir
        .join(format!("{}.zh.srt", video.id));

    tokio::fs::write(&en_vtt_path, cues_to_vtt(&en_cues)).await?;
    tokio::fs::write(&en_srt_path, cues_to_srt(&en_cues)).await?;
    tokio::fs::write(&zh_vtt_path, cues_to_vtt(&zh_cues)).await?;
    tokio::fs::write(&zh_srt_path, cues_to_srt(&zh_cues)).await?;

    let en_url = public_file_url(&state.settings, &en_vtt_path)?;
    let zh_url = public_file_url(&state.settings, &zh_vtt_path)?;
    let now = now_iso();
    sqlx::query("UPDATE videos SET subtitle_en_path = ?, subtitle_en_url = ?, subtitle_zh_path = ?, subtitle_zh_url = ?, updated_at = ? WHERE id = ?")
        .bind(en_vtt_path.to_string_lossy().to_string())
        .bind(&en_url)
        .bind(zh_vtt_path.to_string_lossy().to_string())
        .bind(&zh_url)
        .bind(&now)
        .bind(&video.id)
        .execute(&state.db)
        .await?;

    update_job(
        &state.db,
        &job_id,
        "succeeded",
        100.0,
        None,
        Some(json!({
            "subtitleEnUrl": absolute_url(&state.settings.api_base_url, &en_url),
            "subtitleZhUrl": absolute_url(&state.settings.api_base_url, &zh_url),
        })),
    )
    .await?;
    Ok(())
}

async fn render_video_job(
    state: AppState,
    job_id: String,
    video_id: String,
    style: StyleConfig,
) -> anyhow::Result<()> {
    update_job(&state.db, &job_id, "running", 20.0, None, None).await?;
    let video = load_video(&state.db, &video_id)
        .await?
        .ok_or_else(|| anyhow!("Video not found"))?;
    let zh_path = video
        .subtitle_zh_path
        .clone()
        .ok_or_else(|| anyhow!("Chinese subtitle not found. Run process first."))?;

    let vtt = tokio::fs::read_to_string(&zh_path).await?;
    let cues = parse_vtt(&vtt);
    if cues.is_empty() {
        return Err(anyhow!("No subtitle cues found for rendering"));
    }

    let ass = cues_to_ass(&cues, &style, &video.metadata());
    let ass_path = state.settings.temp_dir.join(format!(
        "{}.{}.ass",
        video.id,
        Utc::now().timestamp_millis()
    ));
    tokio::fs::write(&ass_path, ass).await?;

    update_job(&state.db, &job_id, "running", 55.0, None, None).await?;
    let output_path = state
        .settings
        .output_dir
        .join(format!("{}.rendered.mp4", video.id));
    let burn_result = burn_subtitles(
        &PathBuf::from(&video.original_path),
        &ass_path,
        &output_path,
    )
    .await;
    let _ = tokio::fs::remove_file(&ass_path).await;
    burn_result?;

    let output_url = public_file_url(&state.settings, &output_path)?;
    let now = now_iso();
    sqlx::query("UPDATE videos SET output_path = ?, output_url = ?, updated_at = ? WHERE id = ?")
        .bind(output_path.to_string_lossy().to_string())
        .bind(&output_url)
        .bind(&now)
        .bind(&video.id)
        .execute(&state.db)
        .await?;

    update_job(
        &state.db,
        &job_id,
        "succeeded",
        100.0,
        None,
        Some(json!({ "outputUrl": absolute_url(&state.settings.api_base_url, &output_url) })),
    )
    .await?;
    Ok(())
}

async fn transcribe(state: &AppState, video: &VideoRow) -> anyhow::Result<Vec<Cue>> {
    if state.settings.asr_provider == "mock" {
        return Ok(mock_transcribe(video.duration_sec));
    }

    let config = state.runtime.read().await.clone();
    let api_key = config
        .open_ai_api_key
        .ok_or_else(|| anyhow!("OPENAI_API_KEY is required for ASR provider"))?;
    if config.open_ai_base_url.contains("dashscope")
        && config.open_ai_base_url.contains("compatible-mode")
    {
        let audio_data_uri = extract_audio_data_uri(&PathBuf::from(&video.original_path)).await?;
        let response = state
            .client
            .post(format!(
                "{}/chat/completions",
                config.open_ai_base_url.trim_end_matches('/')
            ))
            .bearer_auth(api_key)
            .json(&json!({
                "model": config.open_ai_asr_model,
                "messages": [{
                    "role": "user",
                    "content": [{
                        "type": "input_audio",
                        "input_audio": { "data": audio_data_uri }
                    }]
                }],
                "stream": false,
                "extra_body": { "asr_options": { "language": "en", "enable_itn": false } }
            }))
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(anyhow!(
                "Qwen ASR failed: {} {}",
                response.status(),
                response.text().await.unwrap_or_default()
            ));
        }
        let payload: Value = response.json().await?;
        let text = extract_chat_content(&payload);
        let cues = split_text_to_cues(&text, video.duration_sec);
        if cues.is_empty() {
            return Err(anyhow!("Qwen ASR returned empty transcript"));
        }
        return Ok(cues);
    }

    let bytes = tokio::fs::read(&video.original_path).await?;
    let part = Part::bytes(bytes)
        .file_name(video.original_filename.clone())
        .mime_str(&video.mime_type)?;
    let form = Form::new()
        .part("file", part)
        .text("model", config.open_ai_asr_model)
        .text("response_format", "verbose_json")
        .text("language", "en");
    let response = state
        .client
        .post(format!(
            "{}/audio/transcriptions",
            config.open_ai_base_url.trim_end_matches('/')
        ))
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(anyhow!(
            "OpenAI ASR failed: {} {}",
            response.status(),
            response.text().await.unwrap_or_default()
        ));
    }
    let payload: Value = response.json().await?;
    let segments = payload
        .get("segments")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let cues: Vec<Cue> = segments
        .into_iter()
        .filter_map(|segment| {
            Some(Cue {
                start_sec: segment.get("start")?.as_f64()?,
                end_sec: segment.get("end")?.as_f64()?,
                text: segment.get("text")?.as_str()?.trim().to_string(),
            })
        })
        .collect();
    Ok(cues)
}

async fn translate(state: &AppState, texts: &[String]) -> anyhow::Result<Vec<String>> {
    if state.settings.translation_provider == "mock" {
        return Ok(texts.iter().map(|text| mock_translate(text)).collect());
    }
    if texts.is_empty() {
        return Ok(Vec::new());
    }

    let batch = request_translation(state, vec![
        json!({ "role": "system", "content": "Translate each English string to Simplified Chinese. Output ONLY a JSON array of strings in the same order, no extra text." }),
        json!({ "role": "user", "content": serde_json::to_string(texts)? }),
    ]).await?;

    if let Some(parsed) = parse_json_string_array(&batch) {
        if parsed.len() == texts.len() {
            return Ok(parsed);
        }
    }

    let mut output = Vec::with_capacity(texts.len());
    for text in texts {
        let translated = request_translation(state, vec![
            json!({ "role": "system", "content": "Translate English to Simplified Chinese. Return only translated text with no explanation." }),
            json!({ "role": "user", "content": text }),
        ]).await?;
        output.push(if translated.trim().is_empty() {
            text.clone()
        } else {
            translated.trim().to_string()
        });
    }
    Ok(output)
}

async fn request_translation(state: &AppState, messages: Vec<Value>) -> anyhow::Result<String> {
    let config = state.runtime.read().await.clone();
    let api_key = config
        .open_ai_api_key
        .ok_or_else(|| anyhow!("OPENAI_API_KEY is required for translation provider"))?;
    let response = state
        .client
        .post(format!(
            "{}/chat/completions",
            config.open_ai_base_url.trim_end_matches('/')
        ))
        .bearer_auth(api_key)
        .json(&json!({
            "model": config.open_ai_translation_model,
            "temperature": 0,
            "messages": messages,
        }))
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(anyhow!(
            "Translation failed: {} {}",
            response.status(),
            response.text().await.unwrap_or_default()
        ));
    }
    let payload: Value = response.json().await?;
    Ok(extract_chat_content(&payload))
}

async fn create_job(
    db: &SqlitePool,
    kind: &str,
    video_id: &str,
    style: Option<&StyleConfig>,
) -> anyhow::Result<String> {
    let id = Uuid::new_v4().to_string();
    let now = now_iso();
    let style_json = match style {
        Some(style) => Some(serde_json::to_string(style)?),
        None => None,
    };
    sqlx::query("INSERT INTO jobs (id, kind, video_id, status, progress, style_json, created_at, updated_at) VALUES (?, ?, ?, 'queued', 0, ?, ?, ?)")
        .bind(&id)
        .bind(kind)
        .bind(video_id)
        .bind(style_json)
        .bind(&now)
        .bind(&now)
        .execute(db)
        .await?;
    Ok(id)
}

async fn update_job(
    db: &SqlitePool,
    id: &str,
    status: &str,
    progress: f64,
    error: Option<&str>,
    result: Option<Value>,
) -> anyhow::Result<()> {
    let result_json = match result {
        Some(value) => Some(serde_json::to_string(&value)?),
        None => None,
    };
    sqlx::query("UPDATE jobs SET status = ?, progress = ?, error = ?, result_json = COALESCE(?, result_json), updated_at = ? WHERE id = ?")
        .bind(status)
        .bind(progress)
        .bind(error)
        .bind(result_json)
        .bind(now_iso())
        .bind(id)
        .execute(db)
        .await?;
    Ok(())
}

async fn fail_job(db: &SqlitePool, id: &str, message: &str) -> anyhow::Result<()> {
    update_job(db, id, "failed", 100.0, Some(message), None).await
}

async fn load_job(db: &SqlitePool, id: &str) -> anyhow::Result<Option<JobView>> {
    let row = sqlx::query_as::<_, JobRow>(
        "SELECT id, status, progress, error, result_json FROM jobs WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(db)
    .await?;
    Ok(row.map(|row| JobView {
        job_id: row.id,
        status: row.status,
        progress: row.progress,
        error: row.error,
        result: row
            .result_json
            .and_then(|raw| serde_json::from_str(&raw).ok()),
    }))
}

async fn load_video(db: &SqlitePool, id: &str) -> anyhow::Result<Option<VideoRow>> {
    let row = sqlx::query_as::<_, VideoRow>("SELECT * FROM videos WHERE id = ?")
        .bind(id)
        .fetch_optional(db)
        .await?;
    Ok(row)
}

async fn run_migrations(db: &SqlitePool) -> anyhow::Result<()> {
    for statement in include_str!("../migrations/0001_init.sql")
        .split(';')
        .map(str::trim)
        .filter(|statement| !statement.is_empty())
    {
        sqlx::query(statement).execute(db).await?;
    }
    Ok(())
}

async fn ensure_storage_dirs(settings: &AppSettings) -> anyhow::Result<()> {
    for dir in [
        &settings.storage_dir,
        &settings.uploads_dir,
        &settings.subtitles_dir,
        &settings.output_dir,
        &settings.temp_dir,
        &settings.storage_dir.join("data"),
    ] {
        tokio::fs::create_dir_all(dir).await?;
    }
    Ok(())
}

async fn ffprobe_video(path: &FsPath) -> anyhow::Result<VideoMetadata> {
    let output = run_command(
        "ffprobe",
        &[
            "-v".into(),
            "error".into(),
            "-show_entries".into(),
            "format=duration:stream=codec_type,width,height,avg_frame_rate".into(),
            "-of".into(),
            "json".into(),
            path.to_string_lossy().to_string(),
        ],
    )
    .await?;
    let payload: Value = serde_json::from_str(&output.stdout)?;
    let streams = payload
        .get("streams")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let video_stream = streams
        .iter()
        .find(|stream| stream.get("codec_type").and_then(Value::as_str) == Some("video"));
    let duration_sec = payload
        .get("format")
        .and_then(|format| format.get("duration"))
        .and_then(Value::as_str)
        .and_then(|raw| raw.parse::<f64>().ok())
        .unwrap_or(0.0);
    let stream = video_stream.ok_or_else(|| anyhow!("Unable to read video metadata"))?;
    if duration_sec <= 0.0 {
        return Err(anyhow!("Unable to read video metadata"));
    }
    Ok(VideoMetadata {
        duration_sec,
        width: stream.get("width").and_then(Value::as_i64).unwrap_or(0),
        height: stream.get("height").and_then(Value::as_i64).unwrap_or(0),
        fps: parse_frame_rate(stream.get("avg_frame_rate").and_then(Value::as_str)),
    })
}

async fn extract_audio_data_uri(video_path: &FsPath) -> anyhow::Result<String> {
    let tmp_audio = env::temp_dir().join(format!(
        "{}.{}.mp3",
        video_path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("audio"),
        Utc::now().timestamp_millis()
    ));
    let result = run_command(
        "ffmpeg",
        &[
            "-y".into(),
            "-i".into(),
            video_path.to_string_lossy().to_string(),
            "-vn".into(),
            "-ac".into(),
            "1".into(),
            "-ar".into(),
            "16000".into(),
            "-b:a".into(),
            "48k".into(),
            tmp_audio.to_string_lossy().to_string(),
        ],
    )
    .await;
    if let Err(error) = result {
        let _ = tokio::fs::remove_file(&tmp_audio).await;
        return Err(error);
    }
    let bytes = tokio::fs::read(&tmp_audio).await?;
    let _ = tokio::fs::remove_file(&tmp_audio).await;
    Ok(format!("data:audio/mpeg;base64,{}", BASE64.encode(bytes)))
}

async fn burn_subtitles(input: &FsPath, ass_path: &FsPath, output: &FsPath) -> anyhow::Result<()> {
    if let Some(parent) = output.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let filter = format!(
        "ass=filename='{}'",
        escape_filter_path(&ass_path.to_string_lossy())
    );
    run_command(
        "ffmpeg",
        &[
            "-y".into(),
            "-i".into(),
            input.to_string_lossy().to_string(),
            "-vf".into(),
            filter,
            "-c:a".into(),
            "copy".into(),
            output.to_string_lossy().to_string(),
        ],
    )
    .await?;
    Ok(())
}

struct CommandOutput {
    stdout: String,
}

async fn run_command(program: &str, args: &[String]) -> anyhow::Result<CommandOutput> {
    let output = Command::new(program)
        .args(args)
        .output()
        .await
        .with_context(|| format!("Failed to start {program}"))?;
    if !output.status.success() {
        return Err(anyhow!(
            "{} failed: {}",
            program,
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(CommandOutput {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
    })
}

fn mock_transcribe(duration_sec: f64) -> Vec<Cue> {
    let cue_count = SAMPLE_ENGLISH
        .len()
        .min(2.max((duration_sec / 12.0).ceil() as usize));
    let segment = duration_sec / cue_count as f64;
    (0..cue_count)
        .map(|index| {
            let start = round3(index as f64 * segment);
            let end =
                round3((duration_sec.min((index + 1) as f64 * segment - 0.1)).max(start + 1.0));
            Cue {
                start_sec: start,
                end_sec: end,
                text: SAMPLE_ENGLISH[index].to_string(),
            }
        })
        .collect()
}

fn mock_translate(text: &str) -> String {
    match text {
        "Hello everyone, welcome to this demo video." => "大家好，欢迎来到这个演示视频。".into(),
        "This MVP extracts English speech and translates it into Chinese subtitles." => {
            "这个 MVP 会提取英文语音并翻译成中文字幕。".into()
        }
        "You can edit subtitle style before rendering the final video." => {
            "在生成最终视频前，你可以调整字幕样式。".into()
        }
        "Click render to burn subtitles into the output file." => {
            "点击生成即可将字幕烧录到输出视频中。".into()
        }
        _ => format!("【中文翻译】{}", text),
    }
}

fn split_text_to_cues(text: &str, duration_sec: f64) -> Vec<Cue> {
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return Vec::new();
    }
    let mut parts = Vec::new();
    let mut current = String::new();
    for ch in normalized.chars() {
        current.push(ch);
        if matches!(ch, '.' | '!' | '?' | '。' | '！' | '？') {
            parts.push(current.trim().to_string());
            current.clear();
        }
    }
    if !current.trim().is_empty() {
        parts.push(current.trim().to_string());
    }
    if parts.is_empty() {
        parts.push(normalized);
    }
    let total_chars: usize = parts.iter().map(String::len).sum();
    let mut cursor = 0.0;
    parts
        .iter()
        .enumerate()
        .map(|(index, part)| {
            let portion = if total_chars > 0 {
                part.len() as f64 / total_chars as f64
            } else {
                1.0 / parts.len() as f64
            };
            let start = cursor;
            let end = if index == parts.len() - 1 {
                duration_sec
            } else {
                (cursor + duration_sec * portion).min(duration_sec)
            };
            cursor = end;
            Cue {
                start_sec: round3(start),
                end_sec: round3(end.max(start + 0.5)),
                text: part.clone(),
            }
        })
        .collect()
}

fn extract_chat_content(payload: &Value) -> String {
    let content = payload
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"));
    match content {
        Some(Value::String(text)) => text.trim().to_string(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| {
                if let Some(text) = part.as_str() {
                    Some(text.to_string())
                } else {
                    part.get("text").and_then(Value::as_str).map(str::to_string)
                }
            })
            .collect::<Vec<_>>()
            .join(" ")
            .trim()
            .to_string(),
        _ => String::new(),
    }
}

fn parse_json_string_array(content: &str) -> Option<Vec<String>> {
    let trimmed = content.trim();
    let mut candidates = vec![trimmed.to_string()];
    if let (Some(start), Some(end)) = (trimmed.find('['), trimmed.rfind(']')) {
        if end > start {
            candidates.push(trimmed[start..=end].to_string());
        }
    }
    for candidate in candidates {
        if let Ok(value) = serde_json::from_str::<Vec<String>>(&candidate) {
            return Some(value);
        }
    }
    None
}

fn cues_to_vtt(cues: &[Cue]) -> String {
    let mut lines = vec!["WEBVTT".to_string(), "".to_string()];
    for cue in cues {
        lines.push(format!(
            "{} --> {}",
            to_vtt_timestamp(cue.start_sec),
            to_vtt_timestamp(cue.end_sec)
        ));
        lines.push(cue.text.clone());
        lines.push(String::new());
    }
    lines.join("\n")
}

fn cues_to_srt(cues: &[Cue]) -> String {
    let mut lines = Vec::new();
    for (index, cue) in cues.iter().enumerate() {
        lines.push((index + 1).to_string());
        lines.push(format!(
            "{} --> {}",
            to_srt_timestamp(cue.start_sec),
            to_srt_timestamp(cue.end_sec)
        ));
        lines.push(cue.text.clone());
        lines.push(String::new());
    }
    lines.join("\n")
}

fn parse_vtt(content: &str) -> Vec<Cue> {
    let mut cues = Vec::new();
    let normalized = content.replace('\r', "");
    let lines: Vec<&str> = normalized.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i].trim();
        if !line.contains("-->") {
            i += 1;
            continue;
        }
        let mut parts = line.split("-->");
        let start = parts
            .next()
            .map(str::trim)
            .and_then(parse_timestamp)
            .unwrap_or(0.0);
        let end = parts
            .next()
            .map(str::trim)
            .and_then(|raw| parse_timestamp(raw.split_whitespace().next().unwrap_or(raw)))
            .unwrap_or(start + 1.0);
        i += 1;
        let mut text = Vec::new();
        while i < lines.len() && !lines[i].trim().is_empty() {
            text.push(lines[i].to_string());
            i += 1;
        }
        cues.push(Cue {
            start_sec: start,
            end_sec: end,
            text: text.join("\n").trim().to_string(),
        });
        i += 1;
    }
    cues
}

fn cues_to_ass(cues: &[Cue], style: &StyleConfig, metadata: &VideoMetadata) -> String {
    let play_res_x = metadata.width.max(1);
    let play_res_y = metadata.height.max(1);
    let font_size = style.font_size.round().max(1.0) as i64;
    let outline = if style.stroke.enabled {
        style.stroke.width.max(0.0).round() as i64
    } else {
        0
    };
    let shadow = if style.shadow.enabled {
        (style.shadow.opacity.clamp(0.0, 1.0) * 5.0)
            .round()
            .max(1.0) as i64
    } else {
        0
    };
    let max_width_ratio = style.max_width_ratio.clamp(0.25, 1.0);
    let side_margin = (((1.0 - max_width_ratio) * play_res_x as f64) / 2.0)
        .round()
        .max(0.0) as i64;
    let x = (style.position.x.clamp(0.0, 1.0) * play_res_x as f64).round() as i64;
    let y = (style.position.y.clamp(0.0, 1.0) * play_res_y as f64).round() as i64;
    let max_chars = ((play_res_x as f64 * max_width_ratio) / (font_size as f64 * 0.8).max(1.0))
        .floor() as usize;
    let font_color = normalize_hex_color(&style.font_color, "#FFFFFF");
    let alignment = match style.text_align.as_str() {
        "left" => 4,
        "right" => 6,
        _ => 5,
    };

    let styles_line = format!(
        "Style: Default,{},{},{},{},{},{},0,0,0,0,100,100,0,0,1,{},{},{},{},{},0,1",
        style.font_family,
        font_size,
        to_ass_color(&font_color, 1.0),
        to_ass_color(&font_color, 1.0),
        to_ass_color("#000000", style.shadow.opacity.clamp(0.0, 1.0)),
        to_ass_color("#000000", 1.0),
        outline,
        shadow,
        alignment,
        side_margin,
        side_margin,
    );
    let mut lines = vec![
        "[Script Info]".to_string(),
        "ScriptType: v4.00+".to_string(),
        format!("PlayResX: {}", play_res_x),
        format!("PlayResY: {}", play_res_y),
        "ScaledBorderAndShadow: yes".to_string(),
        String::new(),
        "[V4+ Styles]".to_string(),
        "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding".to_string(),
        styles_line,
        String::new(),
        "[Events]".to_string(),
        "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text".to_string(),
    ];
    let align_tag = match style.text_align.as_str() {
        "left" => "\\an4",
        "right" => "\\an6",
        _ => "\\an5",
    };
    for cue in cues {
        let wrapped = wrap_text_by_width(&cue.text, max_chars);
        let escaped = escape_ass_text(&wrapped);
        lines.push(format!(
            "Dialogue: 0,{},{},Default,,0,0,0,,{{{}\\pos({},{})}}{}",
            to_ass_timestamp(cue.start_sec),
            to_ass_timestamp(cue.end_sec),
            align_tag,
            x,
            y,
            escaped,
        ));
    }
    lines.push(String::new());
    lines.join("\n")
}

fn validate_style_config(style: &StyleConfig) -> Result<(), String> {
    if !(12.0..=120.0).contains(&style.font_size) {
        return Err("Invalid styleConfig".into());
    }
    if !(0.0..=1.0).contains(&style.position.x) || !(0.0..=1.0).contains(&style.position.y) {
        return Err("Invalid styleConfig".into());
    }
    if !(0.25..=1.0).contains(&style.max_width_ratio) {
        return Err("Invalid styleConfig".into());
    }
    if !matches!(style.text_align.as_str(), "left" | "center" | "right") {
        return Err("Invalid styleConfig".into());
    }
    if normalize_hex_color(&style.font_color, "").is_empty() {
        return Err("Invalid styleConfig".into());
    }
    Ok(())
}

fn video_to_view(state: &AppState, video: VideoRow) -> VideoView {
    VideoView {
        video_id: video.id,
        original_url: absolute_url(&state.settings.api_base_url, &video.original_url),
        duration_sec: video.duration_sec,
        width: video.width,
        height: video.height,
        fps: video.fps,
        subtitle_en_url: video
            .subtitle_en_url
            .map(|url| absolute_url(&state.settings.api_base_url, &url)),
        subtitle_zh_url: video
            .subtitle_zh_url
            .map(|url| absolute_url(&state.settings.api_base_url, &url)),
        output_url: video
            .output_url
            .map(|url| absolute_url(&state.settings.api_base_url, &url)),
        created_at: video.created_at,
        updated_at: video.updated_at,
    }
}

impl VideoRow {
    fn metadata(&self) -> VideoMetadata {
        VideoMetadata {
            duration_sec: self.duration_sec,
            width: self.width,
            height: self.height,
            fps: self.fps,
        }
    }
}

impl RuntimeConfig {
    fn from_env() -> Self {
        Self {
            open_ai_api_key: env::var("OPENAI_API_KEY")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            open_ai_base_url: env::var("OPENAI_BASE_URL")
                .unwrap_or_else(|_| "https://api.openai.com/v1".into()),
            open_ai_asr_model: env::var("OPENAI_ASR_MODEL")
                .unwrap_or_else(|_| "gpt-4o-transcribe".into()),
            open_ai_translation_model: env::var("OPENAI_TRANSLATION_MODEL")
                .unwrap_or_else(|_| "gpt-5.4-mini".into()),
        }
    }

    fn to_view(&self) -> RuntimeConfigView {
        RuntimeConfigView {
            open_ai_base_url: self.open_ai_base_url.clone(),
            open_ai_asr_model: self.open_ai_asr_model.clone(),
            open_ai_translation_model: self.open_ai_translation_model.clone(),
            has_open_ai_api_key: self.open_ai_api_key.is_some(),
        }
    }
}

impl AppSettings {
    fn from_env() -> Self {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let default_storage_dir = manifest_dir.join("../storage");
        let storage_dir = env::var("STORAGE_DIR")
            .map(PathBuf::from)
            .unwrap_or(default_storage_dir);
        let max_upload_size_mb = env::var("MAX_UPLOAD_SIZE_MB")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(300);
        Self {
            port: env::var("PORT")
                .ok()
                .and_then(|value| value.parse::<u16>().ok())
                .unwrap_or(4000),
            api_base_url: env::var("API_BASE_URL")
                .unwrap_or_else(|_| "http://localhost:4000".into()),
            uploads_dir: storage_dir.join("uploads"),
            subtitles_dir: storage_dir.join("subtitles"),
            output_dir: storage_dir.join("output"),
            temp_dir: storage_dir.join("temp"),
            storage_dir,
            max_duration_sec: env::var("MAX_DURATION_SEC")
                .ok()
                .and_then(|value| value.parse::<f64>().ok())
                .unwrap_or(300.0),
            max_upload_size_bytes: max_upload_size_mb * 1024 * 1024,
            asr_provider: env::var("ASR_PROVIDER").unwrap_or_else(|_| "mock".into()),
            translation_provider: env::var("TRANSLATION_PROVIDER")
                .unwrap_or_else(|_| "mock".into()),
        }
    }
}

fn is_allowed_video_file(filename: &str, mime_type: &str) -> bool {
    matches!(
        file_extension(filename).as_deref(),
        Some("mp4" | "mov" | "webm")
    ) && matches!(
        mime_type,
        "video/mp4" | "video/quicktime" | "video/webm" | "application/octet-stream"
    )
}

fn file_extension(filename: &str) -> Option<String> {
    FsPath::new(filename)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
}

fn public_file_url(settings: &AppSettings, path: &FsPath) -> anyhow::Result<String> {
    let relative = path
        .strip_prefix(&settings.storage_dir)
        .with_context(|| format!("{} is outside storage dir", path.display()))?;
    Ok(format!(
        "/files/{}",
        relative.to_string_lossy().replace('\\', "/")
    ))
}

fn absolute_url(base: &str, path: &str) -> String {
    if path.starts_with("http://") || path.starts_with("https://") {
        return path.to_string();
    }
    format!("{}{}", base.trim_end_matches('/'), path)
}

fn client_error(error: anyhow::Error) -> axum::response::Response {
    let message = error.to_string();
    let status = if message.contains("Unsupported file format")
        || message.contains("duration exceeds")
        || message.contains("File too large")
        || message.contains("file is required")
        || message.contains("Unable to read video metadata")
        || message.contains("Invalid data found when processing input")
    {
        StatusCode::BAD_REQUEST
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    };
    let public_message = if message.contains("Unable to read video metadata")
        || message.contains("Invalid data found when processing input")
    {
        "Invalid or corrupted video file".to_string()
    } else if status == StatusCode::INTERNAL_SERVER_ERROR {
        tracing::error!(?error, "request failed");
        "Internal server error".to_string()
    } else {
        message
    };
    (
        status,
        Json(ErrorView {
            message: public_message,
        }),
    )
        .into_response()
}

fn not_found(message: &str) -> axum::response::Response {
    (
        StatusCode::NOT_FOUND,
        Json(ErrorView {
            message: message.to_string(),
        }),
    )
        .into_response()
}

fn server_error(error: anyhow::Error) -> axum::response::Response {
    tracing::error!(?error, "request failed");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorView {
            message: "Internal server error".to_string(),
        }),
    )
        .into_response()
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn sqlite_file_path(database_url: &str) -> Option<PathBuf> {
    if database_url == "sqlite::memory:" {
        return None;
    }
    database_url.strip_prefix("sqlite:").map(PathBuf::from)
}

fn normalize_database_url(value: &str) -> String {
    if value == ":memory:" || value == "sqlite::memory:" {
        return "sqlite::memory:".to_string();
    }
    if value.starts_with("sqlite:") {
        return value.to_string();
    }
    format!("sqlite:{value}")
}

fn parse_frame_rate(raw: Option<&str>) -> f64 {
    let Some(raw) = raw else {
        return 0.0;
    };
    if raw == "0/0" {
        return 0.0;
    }
    let mut parts = raw.split('/');
    let num = parts
        .next()
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(0.0);
    let den = parts
        .next()
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(0.0);
    if den == 0.0 {
        0.0
    } else {
        round3(num / den)
    }
}

fn parse_timestamp(value: &str) -> Option<f64> {
    let normalized = value.replace(',', ".");
    let parts: Vec<f64> = normalized
        .split(':')
        .filter_map(|part| part.parse::<f64>().ok())
        .collect();
    if parts.len() != 3 {
        return None;
    }
    Some(parts[0] * 3600.0 + parts[1] * 60.0 + parts[2])
}

fn to_vtt_timestamp(sec: f64) -> String {
    let hours = (sec / 3600.0).floor() as i64;
    let minutes = ((sec % 3600.0) / 60.0).floor() as i64;
    let seconds = (sec % 60.0).floor() as i64;
    let millis = ((sec % 1.0) * 1000.0).floor() as i64;
    format!("{hours:02}:{minutes:02}:{seconds:02}.{millis:03}")
}

fn to_srt_timestamp(sec: f64) -> String {
    to_vtt_timestamp(sec).replace('.', ",")
}

fn to_ass_timestamp(sec: f64) -> String {
    let hours = (sec / 3600.0).floor() as i64;
    let minutes = ((sec % 3600.0) / 60.0).floor() as i64;
    let seconds = (sec % 60.0).floor() as i64;
    let centis = ((sec % 1.0) * 100.0).floor() as i64;
    format!("{hours}:{minutes:02}:{seconds:02}.{centis:02}")
}

fn round3(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

fn default_max_width_ratio() -> f64 {
    0.9
}
fn default_font_family() -> String {
    "Noto Sans SC".into()
}
fn default_font_color() -> String {
    "#ffffff".into()
}
fn default_text_align() -> String {
    "center".into()
}

fn normalize_hex_color(value: &str, fallback: &str) -> String {
    let raw = if value.is_empty() { fallback } else { value }.trim();
    if raw.len() == 7 && raw.starts_with('#') && raw[1..].chars().all(|ch| ch.is_ascii_hexdigit()) {
        raw.to_uppercase()
    } else {
        fallback.to_string()
    }
}

fn to_ass_color(hex: &str, alpha: f64) -> String {
    let cleaned = normalize_hex_color(hex, "#FFFFFF").replace('#', "");
    let rr = &cleaned[0..2];
    let gg = &cleaned[2..4];
    let bb = &cleaned[4..6];
    let alpha_byte = ((1.0 - alpha.clamp(0.0, 1.0)) * 255.0).round() as u8;
    format!("&H{alpha_byte:02X}{bb}{gg}{rr}")
}

fn escape_ass_text(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('{', "\\{")
        .replace('}', "\\}")
        .replace('\n', "\\N")
}

fn escape_filter_path(value: &str) -> String {
    value
        .replace('\\', "/")
        .replace('\'', "\\'")
        .replace(':', "\\:")
        .replace(',', "\\,")
        .replace('[', "\\[")
        .replace(']', "\\]")
}
fn wrap_text_by_width(text: &str, max_chars_per_line: usize) -> String {
    if max_chars_per_line < 8 {
        return text.to_string();
    }
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.len() <= 1 {
        return text.to_string();
    }
    let mut lines = Vec::new();
    let mut current = words[0].to_string();
    for word in words.iter().skip(1) {
        let candidate = format!("{} {}", current, word);
        if candidate.len() <= max_chars_per_line {
            current = candidate;
        } else {
            lines.push(current);
            current = (*word).to_string();
        }
    }
    lines.push(current);
    lines.join("\\N")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absolute_url_keeps_remote_urls() {
        assert_eq!(
            absolute_url("http://localhost:4000", "https://example.com/video.mp4"),
            "https://example.com/video.mp4"
        );
    }

    #[test]
    fn absolute_url_prefixes_file_paths() {
        assert_eq!(
            absolute_url("http://localhost:4000/", "/files/video.mp4"),
            "http://localhost:4000/files/video.mp4"
        );
    }

    #[test]
    fn vtt_timestamp_formats_millis() {
        assert_eq!(to_vtt_timestamp(62.345), "00:01:02.344");
    }

    #[test]
    fn mock_asr_returns_cues() {
        assert!(!mock_transcribe(24.0).is_empty());
    }
}
