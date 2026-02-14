import fs from "node:fs/promises";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { env } from "../config/env";
import { StoreService } from "./store";
import { ffprobeVideo } from "../utils/ffmpeg";
import { safeJoin, storagePaths, toPublicFileUrl } from "../utils/storage";
import { VideoRecord } from "../types/models";
import { isAllowedDuration, isAllowedVideoFile } from "../utils/validators";

export class VideoService {
  constructor(private readonly store: StoreService) {}

  async createFromUpload(file: Express.Multer.File): Promise<VideoRecord> {
    if (!isAllowedVideoFile(file.originalname, file.mimetype)) {
      await fs.rm(file.path, { force: true });
      throw new Error("Unsupported file format. Allowed: mp4, mov, webm");
    }

    const metadata = await ffprobeVideo(file.path);
    if (!isAllowedDuration(metadata.durationSec, env.maxDurationSec)) {
      await fs.rm(file.path, { force: true });
      throw new Error(`Video duration exceeds ${env.maxDurationSec} seconds`);
    }

    const videoId = uuidv4();
    const extension = path.extname(file.originalname).toLowerCase();
    const finalFilename = `${videoId}${extension}`;
    const finalPath = safeJoin(storagePaths.uploads, finalFilename);

    await fs.rename(file.path, finalPath);

    const now = new Date().toISOString();
    const record: VideoRecord = {
      id: videoId,
      originalFilename: file.originalname,
      mimeType: file.mimetype,
      originalPath: finalPath,
      originalUrl: toPublicFileUrl(finalPath),
      durationSec: metadata.durationSec,
      width: metadata.width,
      height: metadata.height,
      fps: metadata.fps,
      createdAt: now,
      updatedAt: now,
    };

    await this.store.upsertVideo(record);
    return record;
  }

  getVideo(videoId: string): VideoRecord | undefined {
    return this.store.getVideo(videoId);
  }

  async saveSubtitles(
    videoId: string,
    subtitleEnPath: string,
    subtitleZhPath: string,
  ): Promise<VideoRecord> {
    const existing = this.store.getVideo(videoId);
    if (!existing) {
      throw new Error("Video not found");
    }

    const updated: VideoRecord = {
      ...existing,
      subtitleEnPath,
      subtitleZhPath,
      subtitleEnUrl: toPublicFileUrl(subtitleEnPath),
      subtitleZhUrl: toPublicFileUrl(subtitleZhPath),
      updatedAt: new Date().toISOString(),
    };

    await this.store.upsertVideo(updated);
    return updated;
  }

  async saveRenderedOutput(videoId: string, outputPath: string): Promise<VideoRecord> {
    const existing = this.store.getVideo(videoId);
    if (!existing) {
      throw new Error("Video not found");
    }

    const updated: VideoRecord = {
      ...existing,
      outputPath,
      outputUrl: toPublicFileUrl(outputPath),
      updatedAt: new Date().toISOString(),
    };

    await this.store.upsertVideo(updated);
    return updated;
  }

  publicVideoView(video: VideoRecord): Record<string, unknown> {
    return {
      videoId: video.id,
      originalUrl: `${env.apiBaseUrl}${video.originalUrl}`,
      durationSec: video.durationSec,
      width: video.width,
      height: video.height,
      fps: video.fps,
      subtitleEnUrl: video.subtitleEnUrl ? `${env.apiBaseUrl}${video.subtitleEnUrl}` : undefined,
      subtitleZhUrl: video.subtitleZhUrl ? `${env.apiBaseUrl}${video.subtitleZhUrl}` : undefined,
      outputUrl: video.outputUrl ? `${env.apiBaseUrl}${video.outputUrl}` : undefined,
      createdAt: video.createdAt,
      updatedAt: video.updatedAt,
    };
  }
}
