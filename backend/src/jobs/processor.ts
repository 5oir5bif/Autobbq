import fs from "node:fs/promises";
import { Job } from "bullmq";
import { env } from "../config/env";
import { RenderVideoJobData } from "./types";
import { AsrProvider, TranslationProvider } from "../providers/types";
import { VideoService } from "../services/videoService";
import { JobData } from "./types";
import { ProcessResult, RenderResult } from "../types/models";
import { burnSubtitles } from "../utils/ffmpeg";
import { cuesToAss, cuesToSrt, cuesToVtt, parseVtt } from "../utils/subtitles";
import { safeJoin, storagePaths } from "../utils/storage";

export class JobProcessor {
  constructor(
    private readonly videoService: VideoService,
    private readonly asrProvider: AsrProvider,
    private readonly translationProvider: TranslationProvider,
  ) {}

  async handle(job: Job<JobData>): Promise<ProcessResult | RenderResult> {
    if (job.name === "processVideo") {
      return this.processVideo(job as Job<{ videoId: string }>);
    }
    if (job.name === "renderVideo") {
      return this.renderVideo(job as Job<RenderVideoJobData>);
    }
    throw new Error(`Unknown job name: ${job.name}`);
  }

  private async processVideo(job: Job<{ videoId: string }>): Promise<ProcessResult> {
    const video = this.videoService.getVideo(job.data.videoId);
    if (!video) {
      throw new Error("Video not found");
    }

    await job.updateProgress(10);
    const enCues = await this.asrProvider.transcribe(video.originalPath, video.durationSec);
    if (!enCues.length) {
      throw new Error("ASR returned empty subtitles");
    }

    await job.updateProgress(45);
    const zhTexts = await this.translationProvider.translate(enCues.map((cue) => cue.text));
    if (zhTexts.length !== enCues.length) {
      throw new Error("Translation result count mismatch");
    }

    const zhCues = enCues.map((cue, index) => ({
      ...cue,
      text: zhTexts[index],
    }));

    const enVttPath = safeJoin(storagePaths.subtitles, `${video.id}.en.vtt`);
    const enSrtPath = safeJoin(storagePaths.subtitles, `${video.id}.en.srt`);
    const zhVttPath = safeJoin(storagePaths.subtitles, `${video.id}.zh.vtt`);
    const zhSrtPath = safeJoin(storagePaths.subtitles, `${video.id}.zh.srt`);

    await Promise.all([
      fs.writeFile(enVttPath, cuesToVtt(enCues), "utf-8"),
      fs.writeFile(enSrtPath, cuesToSrt(enCues), "utf-8"),
      fs.writeFile(zhVttPath, cuesToVtt(zhCues), "utf-8"),
      fs.writeFile(zhSrtPath, cuesToSrt(zhCues), "utf-8"),
    ]);

    const updated = await this.videoService.saveSubtitles(video.id, enVttPath, zhVttPath);
    await job.updateProgress(100);

    return {
      subtitleEnUrl: `${env.apiBaseUrl}${updated.subtitleEnUrl}`,
      subtitleZhUrl: `${env.apiBaseUrl}${updated.subtitleZhUrl}`,
    };
  }

  private async renderVideo(job: Job<RenderVideoJobData>): Promise<RenderResult> {
    const video = this.videoService.getVideo(job.data.videoId);
    if (!video) {
      throw new Error("Video not found");
    }
    if (!video.subtitleZhPath) {
      throw new Error("Chinese subtitle not found. Run process first.");
    }

    const metadata = {
      durationSec: video.durationSec,
      width: video.width,
      height: video.height,
      fps: video.fps,
    };

    await job.updateProgress(20);
    const vttContent = await fs.readFile(video.subtitleZhPath, "utf-8");
    const cues = parseVtt(vttContent);
    if (!cues.length) {
      throw new Error("No subtitle cues found for rendering");
    }

    const ass = cuesToAss(cues, job.data.styleConfig, metadata);
    const assPath = safeJoin(storagePaths.temp, `${video.id}.${Date.now()}.ass`);
    await fs.writeFile(assPath, ass, "utf-8");

    await job.updateProgress(50);
    const outputPath = safeJoin(storagePaths.output, `${video.id}.rendered.mp4`);

    try {
      await burnSubtitles({
        inputVideoPath: video.originalPath,
        assPath,
        cues,
        style: job.data.styleConfig,
        metadata,
        outputVideoPath: outputPath,
      });
    } finally {
      await fs.rm(assPath, { force: true });
    }

    const updated = await this.videoService.saveRenderedOutput(video.id, outputPath);
    await job.updateProgress(100);

    return {
      outputUrl: `${env.apiBaseUrl}${updated.outputUrl}`,
    };
  }
}
