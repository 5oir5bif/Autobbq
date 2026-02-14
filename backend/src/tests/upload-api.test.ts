import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../api/createApp";

const createTempFile = async (filename: string): Promise<string> => {
  const filePath = path.join(os.tmpdir(), `${Date.now()}-${filename}`);
  await fs.writeFile(filePath, "fake");
  return filePath;
};

describe("POST /api/videos/upload", () => {
  it("rejects unsupported format", async () => {
    const app = createApp({
      videoService: {
        createFromUpload: vi.fn(),
        getVideo: vi.fn(),
        publicVideoView: vi.fn(),
      } as any,
      jobQueue: {
        enqueueProcess: vi.fn(),
        enqueueRender: vi.fn(),
        getJob: vi.fn(),
      },
    });

    const filePath = await createTempFile("invalid.avi");
    const response = await request(app)
      .post("/api/videos/upload")
      .attach("file", filePath, { filename: "invalid.avi", contentType: "video/x-msvideo" });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("Unsupported file format");
  });

  it("rejects when duration exceeds max", async () => {
    const app = createApp({
      videoService: {
        createFromUpload: vi.fn().mockRejectedValue(new Error("Video duration exceeds 300 seconds")),
        getVideo: vi.fn(),
        publicVideoView: vi.fn(),
      } as any,
      jobQueue: {
        enqueueProcess: vi.fn(),
        enqueueRender: vi.fn(),
        getJob: vi.fn(),
      },
    });

    const filePath = await createTempFile("long.mp4");
    const response = await request(app)
      .post("/api/videos/upload")
      .attach("file", filePath, { filename: "long.mp4", contentType: "video/mp4" });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("duration exceeds");
  });

  it("rejects corrupted video metadata", async () => {
    const app = createApp({
      videoService: {
        createFromUpload: vi.fn().mockRejectedValue(new Error("Unable to read video metadata")),
        getVideo: vi.fn(),
        publicVideoView: vi.fn(),
      } as any,
      jobQueue: {
        enqueueProcess: vi.fn(),
        enqueueRender: vi.fn(),
        getJob: vi.fn(),
      },
    });

    const filePath = await createTempFile("broken.mp4");
    const response = await request(app)
      .post("/api/videos/upload")
      .attach("file", filePath, { filename: "broken.mp4", contentType: "video/mp4" });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("Invalid or corrupted video file");
  });
});
