import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StoreService } from "../services/store";
import { VideoRecord } from "../types/models";

const tempDirs: string[] = [];

const createStore = async (): Promise<StoreService> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "autobbq-store-"));
  tempDirs.push(dir);
  const store = new StoreService(path.join(dir, "autobbq.sqlite"));
  await store.init();
  return store;
};

const sampleVideo = (id: string, createdAt: string): VideoRecord => ({
  id,
  originalFilename: id + ".mp4",
  mimeType: "video/mp4",
  originalPath: "/tmp/" + id + ".mp4",
  originalUrl: "/files/uploads/" + id + ".mp4",
  durationSec: 42,
  width: 1280,
  height: 720,
  fps: 30,
  createdAt,
  updatedAt: createdAt,
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("StoreService", () => {
  it("persists and reloads videos from sqlite", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "autobbq-store-"));
    tempDirs.push(dir);
    const dbPath = path.join(dir, "autobbq.sqlite");

    const firstStore = new StoreService(dbPath);
    await firstStore.init();
    await firstStore.upsertVideo(sampleVideo("video-1", "2026-01-01T00:00:00.000Z"));
    firstStore.close();

    const secondStore = new StoreService(dbPath);
    await secondStore.init();
    const restored = secondStore.getVideo("video-1");
    secondStore.close();

    expect(restored?.id).toBe("video-1");
    expect(restored?.originalFilename).toBe("video-1.mp4");
  });

  it("updates an existing video and keeps newest records first", async () => {
    const store = await createStore();

    await store.upsertVideo(sampleVideo("old", "2026-01-01T00:00:00.000Z"));
    await store.upsertVideo(sampleVideo("new", "2026-02-01T00:00:00.000Z"));
    await store.upsertVideo({
      ...sampleVideo("old", "2026-01-01T00:00:00.000Z"),
      subtitleZhUrl: "/files/subtitles/old.zh.vtt",
    });

    expect(store.getVideo("old")?.subtitleZhUrl).toBe("/files/subtitles/old.zh.vtt");
    expect(store.listVideos().map((video) => video.id)).toEqual(["new", "old"]);
    store.close();
  });
});
