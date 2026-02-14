export type QueueJobName = "processVideo" | "renderVideo";

export interface Cue {
  startSec: number;
  endSec: number;
  text: string;
}

export interface VideoMetadata {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
}

export interface VideoRecord {
  id: string;
  originalFilename: string;
  mimeType: string;
  originalPath: string;
  originalUrl: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  subtitleEnPath?: string;
  subtitleEnUrl?: string;
  subtitleZhPath?: string;
  subtitleZhUrl?: string;
  outputPath?: string;
  outputUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessResult {
  subtitleEnUrl: string;
  subtitleZhUrl: string;
}

export interface RenderResult {
  outputUrl: string;
}

export interface PositionConfig {
  x: number;
  y: number;
}

export interface ToggleNumberConfig {
  enabled: boolean;
  width?: number;
  opacity?: number;
}

export interface StyleConfig {
  fontSize: number;
  position: PositionConfig;
  maxWidthRatio?: number;
  stroke?: {
    enabled: boolean;
    width: number;
  };
  shadow?: {
    enabled: boolean;
    opacity: number;
  };
  fontFamily?: string;
  fontColor?: string;
  textAlign?: "left" | "center" | "right";
}

export interface JobView<T = unknown> {
  jobId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number;
  error?: string;
  result?: T;
}
