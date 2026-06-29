import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { VideoRecord } from "../types/models";
import { storagePaths } from "../utils/storage";

interface VideoRow {
  id: string;
  original_filename: string;
  mime_type: string;
  original_path: string;
  original_url: string;
  duration_sec: number;
  width: number;
  height: number;
  fps: number;
  subtitle_en_path: string | null;
  subtitle_en_url: string | null;
  subtitle_zh_path: string | null;
  subtitle_zh_url: string | null;
  output_path: string | null;
  output_url: string | null;
  created_at: string;
  updated_at: string;
}

interface LegacyDatabase {
  videos?: Record<string, VideoRecord>;
}

const defaultDatabasePath = path.join(storagePaths.data, "autobbq.sqlite");
const legacyJsonPath = path.join(storagePaths.data, "db.json");

const parseSqlitePath = (databaseUrl: string | undefined, fallback: string): string => {
  if (!databaseUrl?.trim()) {
    return fallback;
  }

  const value = databaseUrl.trim();
  if (value === "sqlite::memory:" || value === ":memory:") {
    return ":memory:";
  }
  if (value.startsWith("sqlite://")) {
    return value.slice("sqlite://".length);
  }
  if (value.startsWith("sqlite:")) {
    return value.slice("sqlite:".length);
  }
  return value;
};

const rowToVideo = (row: VideoRow): VideoRecord => ({
  id: row.id,
  originalFilename: row.original_filename,
  mimeType: row.mime_type,
  originalPath: row.original_path,
  originalUrl: row.original_url,
  durationSec: row.duration_sec,
  width: row.width,
  height: row.height,
  fps: row.fps,
  subtitleEnPath: row.subtitle_en_path ?? undefined,
  subtitleEnUrl: row.subtitle_en_url ?? undefined,
  subtitleZhPath: row.subtitle_zh_path ?? undefined,
  subtitleZhUrl: row.subtitle_zh_url ?? undefined,
  outputPath: row.output_path ?? undefined,
  outputUrl: row.output_url ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const schemaSql = [
  "PRAGMA journal_mode = WAL",
  "CREATE TABLE IF NOT EXISTS videos (" +
    "id TEXT PRIMARY KEY," +
    "original_filename TEXT NOT NULL," +
    "mime_type TEXT NOT NULL," +
    "original_path TEXT NOT NULL," +
    "original_url TEXT NOT NULL," +
    "duration_sec REAL NOT NULL," +
    "width INTEGER NOT NULL," +
    "height INTEGER NOT NULL," +
    "fps REAL NOT NULL," +
    "subtitle_en_path TEXT," +
    "subtitle_en_url TEXT," +
    "subtitle_zh_path TEXT," +
    "subtitle_zh_url TEXT," +
    "output_path TEXT," +
    "output_url TEXT," +
    "created_at TEXT NOT NULL," +
    "updated_at TEXT NOT NULL" +
  ")",
  "CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos(created_at DESC)",
].join(";");

const upsertSql =
  "INSERT INTO videos (" +
  "id, original_filename, mime_type, original_path, original_url, duration_sec, width, height, fps, " +
  "subtitle_en_path, subtitle_en_url, subtitle_zh_path, subtitle_zh_url, output_path, output_url, created_at, updated_at" +
  ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
  "ON CONFLICT(id) DO UPDATE SET " +
  "original_filename = excluded.original_filename, " +
  "mime_type = excluded.mime_type, " +
  "original_path = excluded.original_path, " +
  "original_url = excluded.original_url, " +
  "duration_sec = excluded.duration_sec, " +
  "width = excluded.width, " +
  "height = excluded.height, " +
  "fps = excluded.fps, " +
  "subtitle_en_path = excluded.subtitle_en_path, " +
  "subtitle_en_url = excluded.subtitle_en_url, " +
  "subtitle_zh_path = excluded.subtitle_zh_path, " +
  "subtitle_zh_url = excluded.subtitle_zh_url, " +
  "output_path = excluded.output_path, " +
  "output_url = excluded.output_url, " +
  "created_at = excluded.created_at, " +
  "updated_at = excluded.updated_at";

export class StoreService {
  private db?: DatabaseSync;
  private readonly databasePath: string;

  constructor(databasePath = parseSqlitePath(process.env.DATABASE_URL, defaultDatabasePath)) {
    this.databasePath = databasePath;
  }

  async init(): Promise<void> {
    if (this.databasePath !== ":memory:") {
      await fs.mkdir(path.dirname(this.databasePath), { recursive: true });
    }

    this.db = new DatabaseSync(this.databasePath);
    this.db.exec(schemaSql);
    await this.migrateLegacyJsonIfPresent();
  }

  close(): void {
    this.db?.close();
    this.db = undefined;
  }

  getVideo(videoId: string): VideoRecord | undefined {
    const row = this.database.prepare("SELECT * FROM videos WHERE id = ?").get(videoId) as VideoRow | undefined;
    return row ? rowToVideo(row) : undefined;
  }

  listVideos(): VideoRecord[] {
    const rows = this.database.prepare("SELECT * FROM videos ORDER BY created_at DESC").all() as unknown as VideoRow[];
    return rows.map(rowToVideo);
  }

  async upsertVideo(record: VideoRecord): Promise<void> {
    const updatedAt = new Date().toISOString();
    this.database.prepare(upsertSql).run(
      record.id,
      record.originalFilename,
      record.mimeType,
      record.originalPath,
      record.originalUrl,
      record.durationSec,
      record.width,
      record.height,
      record.fps,
      record.subtitleEnPath ?? null,
      record.subtitleEnUrl ?? null,
      record.subtitleZhPath ?? null,
      record.subtitleZhUrl ?? null,
      record.outputPath ?? null,
      record.outputUrl ?? null,
      record.createdAt,
      updatedAt,
    );
  }

  private get database(): DatabaseSync {
    if (!this.db) {
      throw new Error("StoreService.init() must be called before accessing the database");
    }
    return this.db;
  }

  private async migrateLegacyJsonIfPresent(): Promise<void> {
    if (this.databasePath === ":memory:") {
      return;
    }

    try {
      const raw = await fs.readFile(legacyJsonPath, "utf-8");
      const legacy = JSON.parse(raw) as LegacyDatabase;
      const videos = Object.values(legacy.videos ?? {});
      for (const video of videos) {
        await this.upsertVideo(video);
      }
      await fs.rename(legacyJsonPath, legacyJsonPath + ".migrated");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
}
