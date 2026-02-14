import fs from "node:fs/promises";
import path from "node:path";
import { Cue, StyleConfig, VideoMetadata } from "../types/models";
import { runCommand } from "./process";

interface ProbeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
}

interface ProbeFormat {
  duration?: string;
}

interface ProbePayload {
  streams?: ProbeStream[];
  format?: ProbeFormat;
}

const filterSupportCache = new Map<string, boolean>();

const CJK_FONT_CANDIDATES = [
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
  "/System/Library/Fonts/PingFang.ttc",
  "/System/Library/Fonts/STHeiti Light.ttc",
];

const parseFrameRate = (raw?: string): number => {
  if (!raw || raw === "0/0") {
    return 0;
  }
  const [numStr, denStr] = raw.split("/");
  const num = Number(numStr);
  const den = Number(denStr);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
    return 0;
  }
  return Number((num / den).toFixed(3));
};

const escapeFilterPath = (value: string): string => {
  return value
    .replace(/\\/g, "/")
    .replace(/'/g, "\\\\'")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
};

const escapeDrawtextValue = (value: string): string => {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/%/g, "\\%")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\n/g, "\\n");
};

const wrapTextByWidth = (text: string, maxCharsPerLine: number): string => {
  if (!Number.isFinite(maxCharsPerLine) || maxCharsPerLine < 8) {
    return text;
  }

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 1) {
    return text;
  }

  const lines: string[] = [];
  let current = words[0];

  for (let index = 1; index < words.length; index += 1) {
    const candidate = `${current} ${words[index]}`;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[index];
    }
  }

  lines.push(current);
  return lines.join("\n");
};

const normalizeHexColor = (value: string | undefined, fallback = "#ffffff"): string => {
  const raw = (value ?? fallback).trim();
  const match = raw.match(/^#([0-9a-fA-F]{6})$/);
  return match ? `#${match[1].toLowerCase()}` : fallback;
};

const resolveDrawtextXExpression = (
  align: StyleConfig["textAlign"],
  xPx: number,
  maxWidthRatio: number,
  videoWidth: number,
): string => {
  if (align === "left") {
    const leftAnchor = Math.round(xPx - (videoWidth * maxWidthRatio) / 2);
    return `max(0,min(w-text_w,${leftAnchor}))`;
  }
  if (align === "right") {
    const rightAnchor = Math.round(xPx + (videoWidth * maxWidthRatio) / 2);
    return `max(0,min(w-text_w,${rightAnchor}-text_w))`;
  }
  return `max(0,min(w-text_w,${xPx}-text_w/2))`;
};

const hasFilter = async (filterName: string): Promise<boolean> => {
  const cached = filterSupportCache.get(filterName);
  if (typeof cached === "boolean") {
    return cached;
  }

  try {
    const { stdout, stderr } = await runCommand("ffmpeg", ["-hide_banner", "-filters"]);
    const all = `${stdout}\n${stderr}`;
    const supported = new RegExp(`\\b${filterName}\\b`).test(all);
    filterSupportCache.set(filterName, supported);
    return supported;
  } catch {
    filterSupportCache.set(filterName, false);
    return false;
  }
};

const resolveCjkFontFile = async (): Promise<string | null> => {
  for (const candidate of CJK_FONT_CANDIDATES) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
};

const burnSubtitleWithAss = async (
  inputVideoPath: string,
  assPath: string,
  outputVideoPath: string,
): Promise<void> => {
  await fs.mkdir(path.dirname(outputVideoPath), { recursive: true });
  const escapedPath = escapeFilterPath(assPath);
  const filter = `ass=filename='${escapedPath}'`;

  await runCommand("ffmpeg", [
    "-y",
    "-i",
    inputVideoPath,
    "-vf",
    filter,
    "-c:a",
    "copy",
    outputVideoPath,
  ]);
};

const burnSubtitleWithDrawtext = async (
  inputVideoPath: string,
  cues: Cue[],
  style: StyleConfig,
  metadata: VideoMetadata,
  outputVideoPath: string,
): Promise<void> => {
  await fs.mkdir(path.dirname(outputVideoPath), { recursive: true });

  const fontFile = await resolveCjkFontFile();
  const fontSize = Math.round(style.fontSize);
  const outline = style.stroke?.enabled ? Math.max(0, style.stroke.width) : 0;
  const shadowOpacity = style.shadow?.enabled ? Math.max(0, Math.min(1, style.shadow.opacity ?? 0.6)) : 0;
  const maxWidthRatio = style.maxWidthRatio ?? 0.9;
  const xPx = Math.round(style.position.x * metadata.width);
  const yPx = Math.round(style.position.y * metadata.height);
  const maxChars = Math.floor((metadata.width * maxWidthRatio) / Math.max(1, fontSize * 0.75));
  const fontColor = normalizeHexColor(style.fontColor, "#ffffff");
  const xExpression = resolveDrawtextXExpression(style.textAlign, xPx, maxWidthRatio, metadata.width);

  const filters = cues.map((cue) => {
    const wrappedText = wrapTextByWidth(cue.text, maxChars);
    const escapedText = escapeDrawtextValue(wrappedText);

    const options = [
      `text='${escapedText}'`,
      `fontsize=${fontSize}`,
      `fontcolor=${fontColor}`,
      `borderw=${outline}`,
      "bordercolor=black",
      "line_spacing=6",
      "box=1",
      "boxcolor=black@0.35",
      "boxborderw=12",
      `x='${xExpression}'`,
      `y='max(0,min(h-text_h,${yPx}-text_h/2))'`,
      `enable='between(t,${cue.startSec.toFixed(3)},${cue.endSec.toFixed(3)})'`,
    ];

    if (fontFile) {
      options.push(`fontfile='${escapeFilterPath(fontFile)}'`);
    }

    if (shadowOpacity > 0) {
      options.push("shadowx=2", "shadowy=2", `shadowcolor=black@${shadowOpacity.toFixed(2)}`);
    }

    return `drawtext=${options.join(":")}`;
  });

  const filterChain = filters.join(",");

  await runCommand("ffmpeg", [
    "-y",
    "-i",
    inputVideoPath,
    "-vf",
    filterChain,
    "-c:a",
    "copy",
    outputVideoPath,
  ]);
};

export const burnSubtitles = async (params: {
  inputVideoPath: string;
  assPath: string;
  cues: Cue[];
  style: StyleConfig;
  metadata: VideoMetadata;
  outputVideoPath: string;
}): Promise<void> => {
  const supportsDrawtext = await hasFilter("drawtext");
  if (supportsDrawtext) {
    await burnSubtitleWithDrawtext(
      params.inputVideoPath,
      params.cues,
      params.style,
      params.metadata,
      params.outputVideoPath,
    );
    return;
  }

  const supportsAss = await hasFilter("ass");
  if (supportsAss) {
    await burnSubtitleWithAss(params.inputVideoPath, params.assPath, params.outputVideoPath);
    return;
  }

  throw new Error(
    "Current FFmpeg lacks both 'ass' and 'drawtext' filters, so subtitles cannot be burned into video. Please use Docker backend or install FFmpeg with libass/libfreetype.",
  );
};

export const ffprobeVideo = async (inputPath: string): Promise<VideoMetadata> => {
  const { stdout } = await runCommand("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type,width,height,avg_frame_rate",
    "-of",
    "json",
    inputPath,
  ]);

  const parsed = JSON.parse(stdout) as ProbePayload;
  const videoStream = parsed.streams?.find((stream) => stream.codec_type === "video");
  const durationSec = Number(parsed.format?.duration ?? 0);

  if (!videoStream || !durationSec) {
    throw new Error("Unable to read video metadata");
  }

  return {
    durationSec,
    width: videoStream.width ?? 0,
    height: videoStream.height ?? 0,
    fps: parseFrameRate(videoStream.avg_frame_rate),
  };
};
