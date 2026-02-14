export interface Cue {
  startSec: number;
  endSec: number;
  text: string;
}

export type TextAlignMode = "left" | "center" | "right";

export interface StyleConfig {
  fontSize: number;
  position: {
    x: number;
    y: number;
  };
  maxWidthRatio: number;
  stroke: {
    enabled: boolean;
    width: number;
  };
  shadow: {
    enabled: boolean;
    opacity: number;
  };
  fontFamily: string;
  fontColor: string;
  textAlign: TextAlignMode;
}

export interface JobStatus<T = unknown> {
  jobId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number;
  error?: string;
  result?: T;
}

export interface VideoInfo {
  videoId: string;
  originalUrl: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  subtitleEnUrl?: string;
  subtitleZhUrl?: string;
  outputUrl?: string;
}

export interface RuntimeConfig {
  openAiBaseUrl: string;
  openAiAsrModel: string;
  openAiTranslationModel: string;
  hasOpenAiApiKey: boolean;
}
