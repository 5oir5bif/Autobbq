import { Job, Queue, Worker } from "bullmq";
import { env } from "../config/env";
import { JobView, ProcessResult, RenderResult, StyleConfig } from "../types/models";
import { JobData, ProcessVideoJobData, RenderVideoJobData } from "./types";

const QUEUE_NAME = "autobbq";

const mapState = (state: string): JobView["status"] => {
  if (state === "completed") {
    return "succeeded";
  }
  if (state === "failed") {
    return "failed";
  }
  if (state === "active") {
    return "running";
  }
  return "queued";
};

const connection = {
  url: env.redisUrl,
};

export class JobQueue {
  private readonly queue: Queue<JobData>;
  private worker?: Worker<JobData>;

  constructor() {
    this.queue = new Queue<JobData>(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }

  async enqueueProcess(videoId: string): Promise<string> {
    const job = await this.queue.add("processVideo", { videoId } satisfies ProcessVideoJobData);
    return String(job.id);
  }

  async enqueueRender(videoId: string, styleConfig: StyleConfig): Promise<string> {
    const job = await this.queue.add("renderVideo", { videoId, styleConfig } satisfies RenderVideoJobData);
    return String(job.id);
  }

  async getJob(jobId: string): Promise<JobView<ProcessResult | RenderResult> | null> {
    const job = await this.queue.getJob(jobId);
    if (!job) {
      return null;
    }

    const state = await job.getState();
    const rawProgress = job.progress;
    const numericProgress = typeof rawProgress === "number" ? rawProgress : Number(rawProgress ?? 0);

    return {
      jobId,
      status: mapState(state),
      progress: Number.isFinite(numericProgress) ? numericProgress : 0,
      error: job.failedReason || undefined,
      result: job.returnvalue as ProcessResult | RenderResult | undefined,
    };
  }

  startWorker(handler: (job: Job<JobData>) => Promise<ProcessResult | RenderResult>): void {
    this.worker = new Worker<JobData>(
      QUEUE_NAME,
      async (job) => handler(job),
      {
        connection,
        concurrency: env.queueConcurrency,
      },
    );

    this.worker.on("failed", (job, error) => {
      const id = job?.id ? String(job.id) : "unknown";
      console.error(`[worker] job failed: ${id}`, error.message);
    });
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }
}
