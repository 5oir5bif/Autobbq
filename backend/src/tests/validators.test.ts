import { describe, expect, it } from "vitest";
import { isAllowedDuration, isAllowedVideoFile, styleConfigSchema } from "../utils/validators";

describe("upload validation", () => {
  it("accepts supported video format", () => {
    expect(isAllowedVideoFile("sample.mp4", "video/mp4")).toBe(true);
    expect(isAllowedVideoFile("sample.mov", "video/quicktime")).toBe(true);
  });

  it("rejects unsupported format", () => {
    expect(isAllowedVideoFile("sample.avi", "video/x-msvideo")).toBe(false);
  });

  it("validates max duration", () => {
    expect(isAllowedDuration(299.9, 300)).toBe(true);
    expect(isAllowedDuration(300, 300)).toBe(true);
    expect(isAllowedDuration(300.1, 300)).toBe(false);
  });
});

describe("styleConfig validation", () => {
  it("accepts valid style config", () => {
    const parsed = styleConfigSchema.safeParse({
      fontSize: 42,
      position: { x: 0.5, y: 0.9 },
      maxWidthRatio: 0.25,
      stroke: { enabled: true, width: 3 },
      shadow: { enabled: true, opacity: 0.6 },
      fontFamily: "Noto Sans SC",
      fontColor: "#00ffaa",
      textAlign: "left",
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects out of range style config", () => {
    const parsed = styleConfigSchema.safeParse({
      fontSize: 9,
      position: { x: 1.4, y: -0.1 },
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects invalid width ratio and color", () => {
    const parsed = styleConfigSchema.safeParse({
      fontSize: 35,
      position: { x: 0.5, y: 0.85 },
      maxWidthRatio: 0.24,
      fontColor: "#fff",
      textAlign: "center",
    });

    expect(parsed.success).toBe(false);
  });
});
