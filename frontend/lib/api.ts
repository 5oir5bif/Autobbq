import { JobStatus, RuntimeConfig, StyleConfig, VideoInfo } from "./types";

const DEFAULT_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
export const API_URL_STORAGE_KEY = "subtitle_mvp_api_base_url";

const getApiBaseUrl = (): string => {
  if (typeof window === "undefined") {
    return DEFAULT_API_BASE_URL;
  }
  const stored = window.localStorage.getItem(API_URL_STORAGE_KEY);
  return stored?.trim() || DEFAULT_API_BASE_URL;
};

export const setApiBaseUrl = (value: string): void => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(API_URL_STORAGE_KEY, value.trim());
};

const handleResponse = async <T>(response: Response): Promise<T> => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data as { message?: string }).message ?? "Request failed";
    throw new Error(message);
  }
  return data as T;
};

export const uploadVideo = async (
  file: File,
): Promise<{ videoId: string; originalUrl: string; durationSec: number }> => {
  const formData = new FormData();
  formData.set("file", file);

  const response = await fetch(`${getApiBaseUrl()}/api/videos/upload`, {
    method: "POST",
    body: formData,
  });

  return handleResponse(response);
};

export const processVideo = async (videoId: string): Promise<{ jobId: string }> => {
  const response = await fetch(`${getApiBaseUrl()}/api/videos/${videoId}/process`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });
  return handleResponse(response);
};

export const renderVideo = async (
  videoId: string,
  styleConfig: StyleConfig,
): Promise<{ jobId: string }> => {
  const response = await fetch(`${getApiBaseUrl()}/api/videos/${videoId}/render`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(styleConfig),
  });
  return handleResponse(response);
};

export const getJob = async <T = unknown>(jobId: string): Promise<JobStatus<T>> => {
  const response = await fetch(`${getApiBaseUrl()}/api/jobs/${jobId}`);
  return handleResponse(response);
};

export const getVideo = async (videoId: string): Promise<VideoInfo> => {
  const response = await fetch(`${getApiBaseUrl()}/api/videos/${videoId}`);
  return handleResponse(response);
};

export const getOutput = async (videoId: string): Promise<{ outputUrl: string }> => {
  const response = await fetch(`${getApiBaseUrl()}/api/videos/${videoId}/output`);
  return handleResponse(response);
};

export const getRuntimeConfig = async (): Promise<RuntimeConfig> => {
  const response = await fetch(`${getApiBaseUrl()}/api/runtime-config`);
  return handleResponse(response);
};

export const updateRuntimeConfig = async (input: {
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  openAiAsrModel?: string;
  openAiTranslationModel?: string;
}): Promise<RuntimeConfig & { message: string }> => {
  const response = await fetch(`${getApiBaseUrl()}/api/runtime-config`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  return handleResponse(response);
};
