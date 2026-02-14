import fs from "node:fs/promises";
import path from "node:path";
import { VideoRecord } from "../types/models";
import { storagePaths } from "../utils/storage";

interface Database {
  videos: Record<string, VideoRecord>;
}

const dbFilePath = path.join(storagePaths.data, "db.json");

export class StoreService {
  private db: Database = { videos: {} };

  async init(): Promise<void> {
    try {
      const existing = await fs.readFile(dbFilePath, "utf-8");
      this.db = JSON.parse(existing) as Database;
    } catch {
      this.db = { videos: {} };
      await this.persist();
    }
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(dbFilePath), { recursive: true });
    await fs.writeFile(dbFilePath, JSON.stringify(this.db, null, 2), "utf-8");
  }

  getVideo(videoId: string): VideoRecord | undefined {
    return this.db.videos[videoId];
  }

  listVideos(): VideoRecord[] {
    return Object.values(this.db.videos).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async upsertVideo(record: VideoRecord): Promise<void> {
    this.db.videos[record.id] = {
      ...record,
      updatedAt: new Date().toISOString(),
    };
    await this.persist();
  }
}
