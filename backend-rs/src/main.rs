use std::{env, net::SocketAddr, path::PathBuf, sync::Arc};

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqlitePoolOptions, FromRow, SqlitePool};
use tokio::sync::RwLock;
use tower_http::{cors::CorsLayer, services::ServeDir, trace::TraceLayer};

#[derive(Clone)]
struct AppState {
    db: SqlitePool,
    config: Arc<RwLock<RuntimeConfig>>,
    api_base_url: String,
}

#[derive(Clone)]
struct AppConfig {
    port: u16,
    api_base_url: String,
    database_url: String,
    storage_dir: PathBuf,
    open_ai_base_url: String,
    open_ai_asr_model: String,
    open_ai_translation_model: String,
    has_open_ai_api_key: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeConfig {
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
}

#[derive(FromRow)]
struct VideoRow {
    id: String,
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
struct ErrorView {
    message: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let config = AppConfig::from_env();
    if let Some(parent) = sqlite_file_path(&config.database_url).and_then(|path| path.parent().map(|p| p.to_path_buf())) {
        tokio::fs::create_dir_all(parent).await?;
    }

    let db = SqlitePoolOptions::new()
        .max_connections(8)
        .connect(&config.database_url)
        .await?;
    run_migrations(&db).await?;

    let state = AppState {
        db,
        api_base_url: config.api_base_url.clone(),
        config: Arc::new(RwLock::new(RuntimeConfig {
            open_ai_base_url: config.open_ai_base_url,
            open_ai_asr_model: config.open_ai_asr_model,
            open_ai_translation_model: config.open_ai_translation_model,
            has_open_ai_api_key: config.has_open_ai_api_key,
        })),
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/runtime-config", get(get_runtime_config).post(update_runtime_config))
        .route("/api/videos/:id", get(get_video))
        .route("/api/videos/:id/output", get(get_output))
        .route("/api/videos/upload", post(not_implemented))
        .route("/api/videos/:id/process", post(not_implemented))
        .route("/api/videos/:id/render", post(not_implemented))
        .nest_service("/files", ServeDir::new(config.storage_dir))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("rust backend listening on http://{addr}");
    axum::serve(listener, app).await?;
    Ok(())
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

async fn health() -> Json<HealthView> {
    Json(HealthView {
        ok: true,
        backend: "rust-axum",
        database: "sqlite",
    })
}

async fn get_runtime_config(State(state): State<AppState>) -> Json<RuntimeConfig> {
    Json(state.config.read().await.clone())
}

async fn update_runtime_config(
    State(state): State<AppState>,
    Json(input): Json<RuntimeConfigInput>,
) -> Json<RuntimeConfig> {
    let mut config = state.config.write().await;
    if let Some(base_url) = input.open_ai_base_url.filter(|value| !value.trim().is_empty()) {
        config.open_ai_base_url = base_url;
    }
    if let Some(model) = input.open_ai_asr_model.filter(|value| !value.trim().is_empty()) {
        config.open_ai_asr_model = model;
    }
    if let Some(model) = input.open_ai_translation_model.filter(|value| !value.trim().is_empty()) {
        config.open_ai_translation_model = model;
    }
    if input.open_ai_api_key.filter(|value| !value.trim().is_empty()).is_some() {
        config.has_open_ai_api_key = true;
    }
    Json(config.clone())
}

async fn get_video(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    match load_video(&state, &id).await {
        Ok(Some(video)) => (StatusCode::OK, Json(video)).into_response(),
        Ok(None) => not_found("Video not found"),
        Err(error) => server_error(error),
    }
}

async fn get_output(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    match load_video(&state, &id).await {
        Ok(Some(video)) if video.output_url.is_some() => {
            let output_url = video.output_url.unwrap_or_default();
            (StatusCode::OK, Json(serde_json::json!({ "outputUrl": output_url }))).into_response()
        }
        Ok(Some(_)) => not_found("Output video not ready"),
        Ok(None) => not_found("Video not found"),
        Err(error) => server_error(error),
    }
}

async fn not_implemented() -> impl IntoResponse {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(ErrorView {
            message: "This endpoint is still handled by the TypeScript backend during the Rust migration".to_string(),
        }),
    )
}

async fn load_video(state: &AppState, id: &str) -> anyhow::Result<Option<VideoView>> {
    let row = sqlx::query_as::<_, VideoRow>(
        "SELECT id, original_url, duration_sec, width, height, fps, subtitle_en_url, subtitle_zh_url, output_url, created_at, updated_at FROM videos WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?;

    Ok(row.map(|row| VideoView {
        video_id: row.id,
        original_url: absolute_url(&state.api_base_url, &row.original_url),
        duration_sec: row.duration_sec,
        width: row.width,
        height: row.height,
        fps: row.fps,
        subtitle_en_url: row.subtitle_en_url.map(|url| absolute_url(&state.api_base_url, &url)),
        subtitle_zh_url: row.subtitle_zh_url.map(|url| absolute_url(&state.api_base_url, &url)),
        output_url: row.output_url.map(|url| absolute_url(&state.api_base_url, &url)),
        created_at: row.created_at,
        updated_at: row.updated_at,
    }))
}

fn absolute_url(base: &str, path: &str) -> String {
    if path.starts_with("http://") || path.starts_with("https://") {
        return path.to_string();
    }
    format!("{}{}", base.trim_end_matches('/'), path)
}

fn not_found(message: &str) -> axum::response::Response {
    (StatusCode::NOT_FOUND, Json(ErrorView { message: message.to_string() })).into_response()
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

impl AppConfig {
    fn from_env() -> Self {
        let default_storage_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../backend/storage");
        let storage_dir = env::var("STORAGE_DIR")
            .map(PathBuf::from)
            .unwrap_or(default_storage_dir);
        let default_database_url = format!(
            "sqlite:{}",
            storage_dir.join("data/autobbq.sqlite").to_string_lossy()
        );

        Self {
            port: env::var("RUST_BACKEND_PORT")
                .or_else(|_| env::var("PORT"))
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(4001),
            api_base_url: env::var("API_BASE_URL").unwrap_or_else(|_| "http://localhost:4001".to_string()),
            database_url: normalize_database_url(&env::var("DATABASE_URL").unwrap_or(default_database_url)),
            storage_dir,
            open_ai_base_url: env::var("OPENAI_BASE_URL").unwrap_or_else(|_| "https://api.openai.com/v1".to_string()),
            open_ai_asr_model: env::var("OPENAI_ASR_MODEL").unwrap_or_else(|_| "gpt-4o-mini-transcribe".to_string()),
            open_ai_translation_model: env::var("OPENAI_TRANSLATION_MODEL").unwrap_or_else(|_| "gpt-4o-mini".to_string()),
            has_open_ai_api_key: env::var("OPENAI_API_KEY").map(|value| !value.trim().is_empty()).unwrap_or(false),
        }
    }
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

#[cfg(test)]
mod tests {
    use super::absolute_url;

    #[test]
    fn absolute_url_keeps_remote_urls() {
        assert_eq!(absolute_url("http://localhost:4001", "https://example.com/video.mp4"), "https://example.com/video.mp4");
    }

    #[test]
    fn absolute_url_prefixes_file_paths() {
        assert_eq!(absolute_url("http://localhost:4001/", "/files/video.mp4"), "http://localhost:4001/files/video.mp4");
    }
}
