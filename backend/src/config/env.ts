import path from "node:path";

const toNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const rootDir = path.resolve(__dirname, "..", "..");

const resolveStorageDir = (): string => {
  const raw = process.env.STORAGE_DIR?.trim();
  if (!raw) {
    return path.join(rootDir, "storage");
  }
  return path.isAbsolute(raw) ? raw : path.resolve(rootDir, raw);
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: toNumber(process.env.PORT, 4000),
  apiBaseUrl: process.env.API_BASE_URL ?? "http://localhost:4000",
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  queueConcurrency: toNumber(process.env.QUEUE_CONCURRENCY, 2),
  maxDurationSec: toNumber(process.env.MAX_DURATION_SEC, 300),
  maxUploadSizeMb: toNumber(process.env.MAX_UPLOAD_SIZE_MB, 300),
  asrProvider: process.env.ASR_PROVIDER ?? "mock",
  translationProvider: process.env.TRANSLATION_PROVIDER ?? "mock",
  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  openAiAsrModel: process.env.OPENAI_ASR_MODEL ?? "gpt-4o-mini-transcribe",
  openAiTranslationModel: process.env.OPENAI_TRANSLATION_MODEL ?? "gpt-4o-mini",
  rootDir,
  storageDir: resolveStorageDir(),
};
