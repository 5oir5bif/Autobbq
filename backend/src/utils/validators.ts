import path from "node:path";
import { z } from "zod";

const allowedExtensions = new Set([".mp4", ".mov", ".webm"]);
const allowedMimeTypes = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "application/octet-stream",
]);

export const isAllowedVideoFile = (filename: string, mimeType: string): boolean => {
  const extension = path.extname(filename).toLowerCase();
  return allowedExtensions.has(extension) && allowedMimeTypes.has(mimeType);
};

export const isAllowedDuration = (durationSec: number, maxDurationSec: number): boolean => {
  return Number.isFinite(durationSec) && durationSec > 0 && durationSec <= maxDurationSec;
};

export const styleConfigSchema = z.object({
  fontSize: z.number().min(12).max(120),
  position: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }),
  maxWidthRatio: z.number().min(0.25).max(1).optional().default(0.9),
  stroke: z
    .object({
      enabled: z.boolean(),
      width: z.number().min(0).max(10),
    })
    .optional()
    .default({ enabled: true, width: 2 }),
  shadow: z
    .object({
      enabled: z.boolean(),
      opacity: z.number().min(0).max(1),
    })
    .optional()
    .default({ enabled: true, opacity: 0.3 }),
  fontFamily: z.string().min(1).max(80).optional().default("Noto Sans SC"),
  fontColor: z.string().regex(/^#([0-9a-fA-F]{6})$/, "fontColor must be a hex color like #ffffff").optional().default("#ffffff"),
  textAlign: z.enum(["left", "center", "right"]).optional().default("center"),
});

export type StyleConfigInput = z.infer<typeof styleConfigSchema>;
