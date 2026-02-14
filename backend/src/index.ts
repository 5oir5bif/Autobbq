import "./config/loadEnv";
import { createApp } from "./api/createApp";
import { env } from "./config/env";
import { JobProcessor } from "./jobs/processor";
import { JobQueue } from "./jobs/queue";
import { buildProviders } from "./providers";
import { StoreService } from "./services/store";
import { VideoService } from "./services/videoService";
import { ensureStorageDirs } from "./utils/storage";

const bootstrap = async (): Promise<void> => {
  await ensureStorageDirs();

  const store = new StoreService();
  await store.init();

  const videoService = new VideoService(store);
  const { asrProvider, translationProvider } = buildProviders();
  const jobQueue = new JobQueue();
  const processor = new JobProcessor(videoService, asrProvider, translationProvider);
  jobQueue.startWorker((job) => processor.handle(job));

  const app = createApp({
    videoService,
    jobQueue,
  });

  const server = app.listen(env.port, () => {
    console.log(`[backend] listening at http://localhost:${env.port}`);
    console.log(`[backend] asrProvider=${env.asrProvider}, translationProvider=${env.translationProvider}`);
    console.log(`[backend] maxDurationSec=${env.maxDurationSec}, maxUploadSizeMb=${env.maxUploadSizeMb}`);
  });

  const shutdown = async (): Promise<void> => {
    await jobQueue.close();
    server.close();
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
};

bootstrap().catch((error) => {
  console.error("Failed to start backend", error);
  process.exit(1);
});
