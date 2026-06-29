"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  API_URL_STORAGE_KEY,
  getJob,
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

  const [apiBaseUrl, setApiBaseUrlInput] = useState("");
  const [openAiApiKey, setOpenAiApiKey] = useState("");
  const [openAiBaseUrl, setOpenAiBaseUrl] = useState("");
  const [openAiAsrModel, setOpenAiAsrModel] = useState("");
  const [openAiTranslationModel, setOpenAiTranslationModel] = useState("");
  const [configStatus, setConfigStatus] = useState("");

  useEffect(() => {
    const stored = window.localStorage.getItem(API_URL_STORAGE_KEY);
    if (stored?.trim()) {
      setApiBaseUrlInput(stored.trim());
    }
  }, []);


  const handleSaveConfig = async () => {
    try {
      setApiBaseUrl(apiBaseUrl.trim() || defaultApiUrl);

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
            <div className="neo-brand-logo">A</div>
            <div>
              <h1>Autobbq</h1>
              <p>Subtitle production workspace</p>
            </div>
          </div>
          <button className="neo-icon-btn" type="button" onClick={() => setShowConfig((prev) => !prev)}>
            {showConfig ? "关闭设置" : "设置"}
          </button>
        </header>

        <div className="neo-home-grid">
          <section
            className={"neo-card neo-upload-zone " + (file ? "is-selected" : "")}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >
            <div className="neo-upload-copy">
              <span className="neo-kicker">Upload</span>
              <h2>{file ? file.name : "英文视频转中文字幕"}</h2>
              <p>MP4, MOV, WEBM</p>
            </div>

            <button className="neo-file-target" type="button" onClick={openFilePicker}>
              <span className="neo-upload-icon">+</span>
              <span>{file ? "更换视频文件" : "选择视频文件"}</span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              hidden
              accept="video/mp4,video/quicktime,video/webm"
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                setFile(selected);
                if (selected) {
                  setStatus("已选择：" + selected.name);
                  setProgress(0);
                }
              }}
            />

            <div className="neo-upload-actions">
              <button className="neo-primary-btn" type="button" disabled={!file || busy} onClick={handleStart}>
                {busy ? "处理中..." : "生成字幕"}
              </button>
              <button className="neo-ghost-btn" type="button" onClick={openFilePicker}>
                浏览文件
              </button>
            </div>

            <div className="neo-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
              <div className="neo-progress-fill" style={{ width: progress + "%" }} />
            </div>
            <p className={"neo-status " + (status.includes("失败") ? "is-error" : "")}>{status}</p>
          </section>

          <aside className="neo-side-panel">
            <div className="neo-run-card">
              <span className="neo-kicker">Pipeline</span>
              <ol className="neo-steps">
                <li className={progress >= 20 ? "is-done" : ""}>上传</li>
                <li className={progress > 20 ? "is-done" : ""}>识别</li>
                <li className={progress > 50 ? "is-done" : ""}>翻译</li>
                <li className={progress >= 100 ? "is-done" : ""}>编辑</li>
              </ol>
            </div>

            {showConfig ? (
              <section className="neo-config-card">
                <h2>API 配置</h2>
                <div className="neo-config-grid">
                  <label>
                    Backend URL
                    <input placeholder={defaultApiUrl} value={apiBaseUrl} onChange={(event) => setApiBaseUrlInput(event.target.value)} />
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
                    <input placeholder="OpenAI: gpt-4o-transcribe；DashScope: qwen3.5-omni-plus" value={openAiAsrModel} onChange={(event) => setOpenAiAsrModel(event.target.value)} />
                  </label>
                  <label>
                    翻译模型
                    <input
                      placeholder="OpenAI: gpt-5.4-mini；DashScope: qwen3.7-plus"
                      value={openAiTranslationModel}
                      onChange={(event) => setOpenAiTranslationModel(event.target.value)}
                    />
                  </label>
                  <label className="neo-full-span">
                    Base URL
                    <input placeholder="OpenAI: https://api.openai.com/v1；DashScope: compatible-mode/v1" value={openAiBaseUrl} onChange={(event) => setOpenAiBaseUrl(event.target.value)} />
                  </label>
                </div>
                <div className="neo-config-actions">
                  <button className="neo-primary-btn" type="button" onClick={handleSaveConfig}>
                    保存配置
                  </button>
                  <p className={"neo-status " + (configStatus.includes("失败") ? "is-error" : "")}>
                    {configStatus || "留空表示继续使用后端当前配置"}
                  </p>
                </div>

                <div className="neo-config-note">
                  <span className="neo-kicker">Model note</span>
                  <ul>
                    <li>平台：OpenAI API 或 OpenAI-compatible 网关，例如 DashScope compatible mode。</li>
                    <li>ASR：gpt-4o-transcribe、gpt-4o-mini-transcribe、whisper-1；DashScope 可试 qwen3.5-omni-plus。</li>
                    <li>翻译：gpt-5.5、gpt-5.4-mini；DashScope 可试 qwen3.7-plus、qwen3.6-flash。</li>
                    <li>如果模型只支持 Responses API，需要先升级后端接口。</li>
                  </ul>
                </div>
              </section>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
