import { Cue } from "./types";

const toSeconds = (time: string): number => {
  const normalized = time.replace(",", ".").trim();
  const [h, m, s] = normalized.split(":");
  const hours = Number(h);
  const minutes = Number(m);
  const seconds = Number(s);
  return hours * 3600 + minutes * 60 + seconds;
};

export const parseVtt = (input: string): Cue[] => {
  const lines = input.replace(/\r/g, "").split("\n");
  const cues: Cue[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || line === "WEBVTT" || !line.includes("-->")) {
      continue;
    }

    const [startRaw, endRaw] = line.split("-->").map((part) => part.trim().split(" ")[0]);
    const textLines: string[] = [];

    for (let next = index + 1; next < lines.length; next += 1) {
      const textLine = lines[next];
      if (!textLine.trim()) {
        index = next;
        break;
      }
      textLines.push(textLine);
      index = next;
    }

    cues.push({
      startSec: toSeconds(startRaw),
      endSec: toSeconds(endRaw),
      text: textLines.join("\n"),
    });
  }

  return cues;
};
