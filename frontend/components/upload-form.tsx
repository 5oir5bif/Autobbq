"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("请选择英文视频文件（≤5 分钟）");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

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
        // ignore initial loading errors to keep upload flow available
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

  return (
    <div className="panel" style={{ display: "grid", gap: 16 }}>
      <h1 style={{ margin: 0, fontSize: 30 }}>英文视频自动翻译中文字幕</h1>
      <p style={{ margin: 0, color: "var(--text-muted)" }}>
        支持 `mp4/mov/webm`，最大 5 分钟（建议 ≤300MB）。
      </p>

      <div style={{ display: "grid", gap: 10, padding: 12, border: "1px solid #dbeafe", borderRadius: 12 }}>
        <strong>运行配置</strong>
        <label>
          API URL
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
          <input value={openAiTranslationModel} onChange={(event) => setOpenAiTranslationModel(event.target.value)} />
        </label>
        <label>
          Base URL
          <input value={openAiBaseUrl} onChange={(event) => setOpenAiBaseUrl(event.target.value)} />
        </label>
        <button className="btn" type="button" onClick={handleSaveConfig}>
          保存配置
        </button>
        <p style={{ margin: 0, color: configStatus.includes("失败") ? "var(--danger)" : "var(--text-muted)" }}>
          {configStatus || "先保存配置，再上传视频。"}
        </p>
      </div>

      <input
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <button className="btn" type="button" disabled={!file || busy} onClick={handleStart}>
        {busy ? "处理中..." : "上传并开始处理"}
      </button>
      <div style={{ height: 10, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${progress}%`,
            background: "linear-gradient(90deg, #0ea5e9, #14b8a6)",
            transition: "width 0.3s ease",
          }}
        />
      </div>
      <p style={{ margin: 0, color: status.includes("失败") ? "var(--danger)" : "var(--text-muted)" }}>{status}</p>
    </div>
  );
}
