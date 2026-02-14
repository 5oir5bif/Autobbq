import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";

export const storagePaths = {
  root: env.storageDir,
  uploads: path.join(env.storageDir, "uploads"),
  subtitles: path.join(env.storageDir, "subtitles"),
  output: path.join(env.storageDir, "output"),
  temp: path.join(env.storageDir, "temp"),
  data: path.join(env.storageDir, "data"),
};

export const ensureStorageDirs = async (): Promise<void> => {
  await Promise.all(
    Object.values(storagePaths).map(async (dirPath) => {
      await fs.mkdir(dirPath, { recursive: true });
    }),
  );
};

export const safeJoin = (baseDir: string, filename: string): string => {
  const cleaned = path.basename(filename);
  const outputPath = path.join(baseDir, cleaned);
  const relative = path.relative(baseDir, outputPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid filename");
  }
  return outputPath;
};

export const toPublicFileUrl = (absolutePath: string): string => {
  const relativePath = path.relative(storagePaths.root, absolutePath).split(path.sep).join("/");
  return `/files/${relativePath}`;
};
