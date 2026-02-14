"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  API_URL_STORAGE_KEY,
  getJob,
  getRuntimeConfig,
  processVideo,
  setApiBaseUrl,
  updateRuntimeConfig,
  uploadVideo,
} from "../lib/api";

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const defaultApiUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export function UploadForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("请选择英文视频文件（≤5 分钟）");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showConfig, setShowConfig] = useState(false);

  const [apiBaseUrl, setApiBaseUrlInput] = useState(defaultApiUrl);
  const [openAiApiKey, setOpenAiApiKey] = useState("");
  const [openAiBaseUrl, setOpenAiBaseUrl] = useState("https://dashscope.aliyuncs.com/compatible-mode/v1");
  const [openAiAsrModel, setOpenAiAsrModel] = useState("qwen3-asr-flash");
  const [openAiTranslationModel, setOpenAiTranslationModel] = useState("qwen-plus");
  const [configStatus, setConfigStatus] = useState("");

  useEffect(() => {
    const stored = window.localStorage.getItem(API_URL_STORAGE_KEY);
    if (stored?.trim()) {
      setApiBaseUrlInput(stored.trim());
    }
  }, []);

  useEffect(() => {
    const loadRuntimeConfig = async () => {
      try {
        const config = await getRuntimeConfig();
        setOpenAiBaseUrl(config.openAiBaseUrl || openAiBaseUrl);
        setOpenAiAsrModel(config.openAiAsrModel || openAiAsrModel);
        setOpenAiTranslationModel(config.openAiTranslationModel || openAiTranslationModel);
      } catch {
        // Keep upload flow available even when backend config endpoint is temporarily unavailable.
      }
    };

    void loadRuntimeConfig();
  }, []);

  const handleSaveConfig = async () => {
    try {
      if (!apiBaseUrl.trim()) {
        setConfigStatus("API URL 不能为空");
        return;
      }

      setApiBaseUrl(apiBaseUrl.trim());

      await updateRuntimeConfig({
        openAiApiKey: openAiApiKey.trim() || undefined,
        openAiBaseUrl: openAiBaseUrl.trim() || undefined,
        openAiAsrModel: openAiAsrModel.trim() || undefined,
        openAiTranslationModel: openAiTranslationModel.trim() || undefined,
      });

      setOpenAiApiKey("");
      setConfigStatus("配置已保存并生效");
    } catch (error) {
      setConfigStatus(error instanceof Error ? error.message : "配置保存失败");
    }
  };

  const handleStart = async () => {
    if (!file) {
      setStatus("请先选择文件");
      return;
    }

    setBusy(true);
    setProgress(0);

    try {
      setStatus("上传中...");
      const uploadRes = await uploadVideo(file);
      setProgress(20);

      setStatus("已上传，开始识别并翻译...");
      const processRes = await processVideo(uploadRes.videoId);

      while (true) {
        const job = await getJob<{ subtitleZhUrl: string }>(processRes.jobId);
        setProgress(Math.max(20, Math.min(100, job.progress || 0)));

        if (job.status === "failed") {
          throw new Error(job.error ?? "字幕处理失败");
        }

        if (job.status === "succeeded") {
          setStatus("处理完成，进入编辑页面...");
          router.push(`/videos/${uploadRes.videoId}`);
          return;
        }

        await delay(1200);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "处理失败");
      setBusy(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) {
      setFile(dropped);
      setStatus(`已选择：${dropped.name}`);
      setProgress(0);
    }
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="neo-page">
      <div className="neo-shell">
        <header className="neo-header">
          <div className="neo-brand">
            <div className="neo-brand-logo">B</div>
            <div>
              <h1>Autobbq</h1>
              <p>AI Video Subtitle Expert</p>
            </div>
          </div>
          <button className="neo-icon-btn" type="button" onClick={() => setShowConfig((prev) => !prev)}>
            设置
          </button>
        </header>

        {showConfig ? (
          <section className="neo-card neo-config-card">
            <h2>API 运行配置</h2>
            <div className="neo-config-grid">
              <label>
                Backend URL
                <input value={apiBaseUrl} onChange={(event) => setApiBaseUrlInput(event.target.value)} />
              </label>
              <label>
                API Key
                <input
                  type="password"
                  placeholder="留空表示不更新"
                  value={openAiApiKey}
                  onChange={(event) => setOpenAiApiKey(event.target.value)}
                />
              </label>
              <label>
                ASR 模型
                <input value={openAiAsrModel} onChange={(event) => setOpenAiAsrModel(event.target.value)} />
              </label>
              <label>
                翻译模型
                <input
                  value={openAiTranslationModel}
                  onChange={(event) => setOpenAiTranslationModel(event.target.value)}
                />
              </label>
              <label className="neo-full-span">
                Base URL
                <input value={openAiBaseUrl} onChange={(event) => setOpenAiBaseUrl(event.target.value)} />
              </label>
            </div>
            <div className="neo-config-actions">
              <button className="neo-primary-btn" type="button" onClick={handleSaveConfig}>
                保存配置
              </button>
              <p className={`neo-status ${configStatus.includes("失败") ? "is-error" : ""}`}>
                {configStatus || "先保存配置，再上传视频。"}
              </p>
            </div>
          </section>
        ) : null}

        <section
          className={`neo-card neo-upload-zone ${file ? "is-selected" : ""}`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <div className="neo-upload-icon">上传</div>
          <h2>{file ? file.name : "开始你的视频转译"}</h2>
          <p>拖拽英文视频到此处，我们将自动生成中文字幕并支持在线调节样式。</p>

          <input
            ref={fileInputRef}
            type="file"
            hidden
            accept="video/mp4,video/quicktime,video/webm"
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null;
              setFile(selected);
              if (selected) {
                setStatus(`已选择：${selected.name}`);
                setProgress(0);
              }
            }}
          />

          <div className="neo-upload-actions">
            <button className="neo-ghost-btn" type="button" onClick={openFilePicker}>
              {file ? "重新选择文件" : "选择本地视频"}
            </button>
            <button className="neo-primary-btn" type="button" disabled={!file || busy} onClick={handleStart}>
              {busy ? "视频处理中..." : "一键生成字幕"}
            </button>
            <span className="neo-hint">Supports MP4, MOV, WEBM</span>
          </div>

          <div className="neo-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <div className="neo-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <p className={`neo-status ${status.includes("失败") ? "is-error" : ""}`}>{status}</p>
        </section>
      </div>
    </div>
  );
}
