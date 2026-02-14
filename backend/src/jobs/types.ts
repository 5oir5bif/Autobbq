import { StyleConfig } from "../types/models";

export interface ProcessVideoJobData {
  videoId: string;
}

export interface RenderVideoJobData {
  videoId: string;
  styleConfig: StyleConfig;
}

export type JobData = ProcessVideoJobData | RenderVideoJobData;
