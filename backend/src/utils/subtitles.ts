import { Cue, StyleConfig, VideoMetadata } from "../types/models";

const pad = (value: number, size = 2): string => value.toString().padStart(size, "0");

export const toVttTimestamp = (sec: number): string => {
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = Math.floor(sec % 60);
  const milliseconds = Math.floor((sec % 1) * 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(milliseconds, 3)}`;
};

export const toSrtTimestamp = (sec: number): string => {
  return toVttTimestamp(sec).replace(".", ",");
};

export const toAssTimestamp = (sec: number): string => {
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = Math.floor(sec % 60);
  const centiseconds = Math.floor((sec % 1) * 100);
  return `${hours}:${pad(minutes)}:${pad(seconds)}.${pad(centiseconds)}`;
};

export const cuesToVtt = (cues: Cue[]): string => {
  const lines: string[] = ["WEBVTT", ""];
  cues.forEach((cue) => {
    lines.push(`${toVttTimestamp(cue.startSec)} --> ${toVttTimestamp(cue.endSec)}`);
    lines.push(cue.text);
    lines.push("");
  });
  return lines.join("\n");
};

export const cuesToSrt = (cues: Cue[]): string => {
  const lines: string[] = [];
  cues.forEach((cue, index) => {
    lines.push(String(index + 1));
    lines.push(`${toSrtTimestamp(cue.startSec)} --> ${toSrtTimestamp(cue.endSec)}`);
    lines.push(cue.text);
    lines.push("");
  });
  return lines.join("\n");
};

const toSeconds = (value: string): number => {
  const normalized = value.replace(",", ".");
  const parts = normalized.split(":").map(Number);
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    return 0;
  }
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
};

export const parseVtt = (content: string): Cue[] => {
  const normalized = content.replace(/\r/g, "").trim();
  if (!normalized) {
    return [];
  }

  const lines = normalized.split("\n");
  const cues: Cue[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!line || line === "WEBVTT") {
      i += 1;
      continue;
    }

    if (!line.includes("-->")) {
      i += 1;
      continue;
    }

    const [startRaw, endRaw] = line.split("-->").map((part) => part.trim().split(" ")[0]);
    const textLines: string[] = [];
    i += 1;

    while (i < lines.length && lines[i].trim() !== "") {
      textLines.push(lines[i]);
      i += 1;
    }

    cues.push({
      startSec: toSeconds(startRaw),
      endSec: toSeconds(endRaw),
      text: textLines.join("\n").trim(),
    });

    i += 1;
  }

  return cues;
};

const escapeAssText = (value: string): string => {
  return value.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\n/g, "\\N");
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
  return lines.join("\\N");
};

const normalizeHexColor = (value: string | undefined, fallback = "#FFFFFF"): string => {
  const raw = (value ?? fallback).trim();
  const match = raw.match(/^#([0-9a-fA-F]{6})$/);
  return match ? `#${match[1].toUpperCase()}` : fallback;
};

const toAssColor = (hexRgb: string, alpha: number): string => {
  const cleaned = normalizeHexColor(hexRgb).replace("#", "");
  const rr = cleaned.slice(0, 2);
  const gg = cleaned.slice(2, 4);
  const bb = cleaned.slice(4, 6);
  const alphaByte = Math.max(0, Math.min(255, Math.round((1 - alpha) * 255)));
  return `&H${pad(alphaByte, 2)}${bb}${gg}${rr}`;
};

const toAssAlignmentTag = (align: StyleConfig["textAlign"]): string => {
  if (align === "left") {
    return "\\an4";
  }
  if (align === "right") {
    return "\\an6";
  }
  return "\\an5";
};

export const cuesToAss = (
  cues: Cue[],
  style: StyleConfig,
  metadata: VideoMetadata,
): string => {
  const playResX = Math.max(1, Math.round(metadata.width));
  const playResY = Math.max(1, Math.round(metadata.height));
  const fontSize = Math.round(style.fontSize);
  const outline = style.stroke?.enabled ? Math.max(0, style.stroke.width) : 0;
  const shadow = style.shadow?.enabled ? Math.max(1, Math.round((style.shadow.opacity ?? 0.3) * 5)) : 0;
  const maxWidthRatio = style.maxWidthRatio ?? 0.9;
  const sideMargin = Math.round(((1 - maxWidthRatio) * playResX) / 2);
  const marginL = Math.max(0, sideMargin);
  const marginR = Math.max(0, sideMargin);
  const xPx = Math.round(style.position.x * playResX);
  const yPx = Math.round(style.position.y * playResY);
  const maxChars = Math.floor((playResX * maxWidthRatio) / Math.max(1, fontSize * 0.8));
  const fontColor = normalizeHexColor(style.fontColor, "#FFFFFF");

  const stylesLine = [
    "Style: Default",
    style.fontFamily ?? "Noto Sans SC",
    fontSize,
    toAssColor(fontColor, 1),
    toAssColor(fontColor, 1),
    toAssColor("#000000", Math.max(0, Math.min(1, style.shadow?.opacity ?? 0.3))),
    toAssColor("#000000", 1),
    0,
    0,
    outline,
    shadow,
    0,
    100,
    100,
    0,
    0,
    1,
    2,
    style.textAlign === "left" ? 4 : style.textAlign === "right" ? 6 : 5,
    marginL,
    marginR,
    0,
    1,
  ].join(",");

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    stylesLine,
    "",
    "[Events]",
    "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
  ];

  const alignTag = toAssAlignmentTag(style.textAlign);
  const dialogues = cues.map((cue) => {
    const wrapped = wrapTextByWidth(cue.text, maxChars);
    const escaped = escapeAssText(wrapped);
    return `Dialogue: 0,${toAssTimestamp(cue.startSec)},${toAssTimestamp(cue.endSec)},Default,,0,0,0,,{${alignTag}\\pos(${xPx},${yPx})}${escaped}`;
  });

  return [...header, ...dialogues, ""].join("\n");
};
