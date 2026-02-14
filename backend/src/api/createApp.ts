import express, { Request, Response } from "express";
import cors from "cors";
import multer from "multer";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { env } from "../config/env";
import { VideoService } from "../services/videoService";
import { JobQueue } from "../jobs/queue";
import { isAllowedVideoFile, styleConfigSchema } from "../utils/validators";
import { storagePaths } from "../utils/storage";

export interface AppDependencies {
  videoService: VideoService;
  jobQueue: Pick<JobQueue, "enqueueProcess" | "enqueueRender" | "getJob">;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, storagePaths.temp),
    filename: (_req, file, cb) => {
      const extension = path.extname(file.originalname).toLowerCase();
      cb(null, `${uuidv4()}${extension}`);
    },
  }),
  limits: {
    fileSize: env.maxUploadSizeMb * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedVideoFile(file.originalname, file.mimetype)) {
      cb(new Error("Unsupported file format. Allowed: mp4, mov, webm"));
      return;
    }
    cb(null, true);
  },
});

const runtimeConfigSchema = z
  .object({
    openAiApiKey: z.string().min(1).max(300).optional(),
    openAiBaseUrl: z.string().url().optional(),
    openAiAsrModel: z.string().min(1).max(120).optional(),
    openAiTranslationModel: z.string().min(1).max(120).optional(),
  })
  .strict();

const toClientError = (error: unknown): { statusCode: number; message: string } => {
  if (error instanceof Error) {
    if (
      error.message.includes("Unsupported file format") ||
      error.message.includes("duration exceeds") ||
      error.message.includes("Unable to read video metadata") ||
      error.message.includes("Invalid data found when processing input")
    ) {
      const message =
        error.message.includes("Unable to read video metadata") ||
        error.message.includes("Invalid data found when processing input")
          ? "Invalid or corrupted video file"
          : error.message;

      return {
        statusCode: 400,
        message,
      };
    }
  }
  return {
    statusCode: 500,
    message: "Internal server error",
  };
};

export const createApp = ({ videoService, jobQueue }: AppDependencies): express.Express => {
  const app = express();

  app.use(cors({ origin: env.frontendOrigin }));
  app.use(express.json({ limit: "2mb" }));
  app.use("/files", express.static(storagePaths.root));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      asrProvider: env.asrProvider,
      translationProvider: env.translationProvider,
      maxDurationSec: env.maxDurationSec,
      maxUploadSizeMb: env.maxUploadSizeMb,
    });
  });

  app.get("/api/runtime-config", (_req, res) => {
    res.json({
      openAiBaseUrl: env.openAiBaseUrl,
      openAiAsrModel: env.openAiAsrModel,
      openAiTranslationModel: env.openAiTranslationModel,
      hasOpenAiApiKey: Boolean(env.openAiApiKey),
    });
  });

  app.post("/api/runtime-config", (req: Request, res: Response) => {
    const parsed = runtimeConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid runtime config", issues: parsed.error.issues });
      return;
    }

    const config = parsed.data;
    if (typeof config.openAiApiKey === "string") {
      env.openAiApiKey = config.openAiApiKey;
    }
    if (typeof config.openAiBaseUrl === "string") {
      env.openAiBaseUrl = config.openAiBaseUrl;
    }
    if (typeof config.openAiAsrModel === "string") {
      env.openAiAsrModel = config.openAiAsrModel;
    }
    if (typeof config.openAiTranslationModel === "string") {
      env.openAiTranslationModel = config.openAiTranslationModel;
    }

    res.json({
      message: "Runtime config updated",
      openAiBaseUrl: env.openAiBaseUrl,
      openAiAsrModel: env.openAiAsrModel,
      openAiTranslationModel: env.openAiTranslationModel,
      hasOpenAiApiKey: Boolean(env.openAiApiKey),
    });
  });

  app.post("/api/videos/upload", upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ message: "file is required" });
        return;
      }
      const video = await videoService.createFromUpload(req.file);
      res.json({
        videoId: video.id,
        originalUrl: `${env.apiBaseUrl}${video.originalUrl}`,
        durationSec: video.durationSec,
      });
    } catch (error) {
      const clientError = toClientError(error);
      res.status(clientError.statusCode).json({ message: clientError.message });
    }
  });

  app.get("/api/videos/:id", (req: Request, res: Response) => {
    const video = videoService.getVideo(req.params.id);
    if (!video) {
      res.status(404).json({ message: "Video not found" });
      return;
    }
    res.json(videoService.publicVideoView(video));
  });

  app.post("/api/videos/:id/process", async (req: Request, res: Response) => {
    const video = videoService.getVideo(req.params.id);
    if (!video) {
      res.status(404).json({ message: "Video not found" });
      return;
    }

    try {
      const jobId = await jobQueue.enqueueProcess(video.id);
      res.json({ jobId });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to enqueue process job" });
    }
  });

  app.get("/api/jobs/:jobId", async (req: Request, res: Response) => {
    const job = await jobQueue.getJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ message: "Job not found" });
      return;
    }
    res.json(job);
  });

  app.post("/api/videos/:id/render", async (req: Request, res: Response) => {
    const video = videoService.getVideo(req.params.id);
    if (!video) {
      res.status(404).json({ message: "Video not found" });
      return;
    }

    const parsed = styleConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Invalid styleConfig",
        issues: parsed.error.issues,
      });
      return;
    }

    try {
      const jobId = await jobQueue.enqueueRender(video.id, parsed.data);
      res.json({ jobId });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to enqueue render job" });
    }
  });

  app.get("/api/videos/:id/output", (req: Request, res: Response) => {
    const video = videoService.getVideo(req.params.id);
    if (!video) {
      res.status(404).json({ message: "Video not found" });
      return;
    }

    if (!video.outputUrl) {
      res.status(404).json({ message: "Output video not ready" });
      return;
    }

    res.json({
      outputUrl: `${env.apiBaseUrl}${video.outputUrl}`,
    });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({
        message: `File too large. Max allowed is ${env.maxUploadSizeMb}MB`,
      });
      return;
    }

    const clientError = toClientError(error);
    res.status(clientError.statusCode).json({ message: clientError.message });
  });

  return app;
};
