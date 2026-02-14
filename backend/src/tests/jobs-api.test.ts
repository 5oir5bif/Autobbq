import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../api/createApp";

describe("GET /api/jobs/:jobId", () => {
  it("returns job status payload", async () => {
    const app = createApp({
      videoService: {
        getVideo: vi.fn(),
        createFromUpload: vi.fn(),
        publicVideoView: vi.fn(),
      } as any,
      jobQueue: {
        enqueueProcess: vi.fn(),
        enqueueRender: vi.fn(),
        getJob: vi.fn().mockResolvedValue({
          jobId: "job-1",
          status: "running",
          progress: 60,
        }),
      },
    });

    const response = await request(app).get("/api/jobs/job-1");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      jobId: "job-1",
      status: "running",
      progress: 60,
    });
  });

  it("returns 404 when job not found", async () => {
    const app = createApp({
      videoService: {
        getVideo: vi.fn(),
        createFromUpload: vi.fn(),
        publicVideoView: vi.fn(),
      } as any,
      jobQueue: {
        enqueueProcess: vi.fn(),
        enqueueRender: vi.fn(),
        getJob: vi.fn().mockResolvedValue(null),
      },
    });

    const response = await request(app).get("/api/jobs/missing-job");
    expect(response.status).toBe(404);
    expect(response.body.message).toContain("Job not found");
  });
});

describe("POST /api/videos/:id/render", () => {
  it("rejects invalid styleConfig payload", async () => {
    const app = createApp({
      videoService: {
        getVideo: vi.fn().mockReturnValue({
          id: "video-1",
        }),
        createFromUpload: vi.fn(),
        publicVideoView: vi.fn(),
      } as any,
      jobQueue: {
        enqueueProcess: vi.fn(),
        enqueueRender: vi.fn(),
        getJob: vi.fn(),
      },
    });

    const response = await request(app).post("/api/videos/video-1/render").send({
      fontSize: 8,
      position: { x: 2, y: -1 },
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("Invalid styleConfig");
  });
});
