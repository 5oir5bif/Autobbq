import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { env } from "../config/env";
import { Cue } from "../types/models";
import { runCommand } from "../utils/process";
import { AsrProvider, TranslationProvider } from "./types";

interface OpenAiSegment {
  start: number;
  end: number;
  text: string;
}

interface TranscriptionResponse {
  segments?: OpenAiSegment[];
}

interface ChatChoice {
  message?: {
    content?: unknown;
  };
}

interface ChatResponse {
  choices?: ChatChoice[];
}

const isDashscopeCompatibleBase = (baseUrl: string): boolean => {
  return baseUrl.includes("dashscope") && baseUrl.includes("compatible-mode");
};

const splitTextToCues = (text: string, durationSec: number): Cue[] => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const parts = normalized
    .split(/(?<=[.!?。！？])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length) {
    return [];
  }

  const totalChars = parts.reduce((sum, part) => sum + part.length, 0);
  let cursor = 0;

  return parts.map((part, index) => {
    const portion = totalChars > 0 ? part.length / totalChars : 1 / parts.length;
    const startSec = cursor;
    const endSec = index === parts.length - 1 ? durationSec : Math.min(durationSec, cursor + durationSec * portion);
    cursor = endSec;

    return {
      startSec: Number(startSec.toFixed(3)),
      endSec: Number(Math.max(startSec + 0.5, endSec).toFixed(3)),
      text: part,
    };
  });
};

const extractAudioDataUriFromVideo = async (videoPath: string): Promise<string> => {
  const tmpAudioPath = path.join(os.tmpdir(), `${path.basename(videoPath)}.${Date.now()}.mp3`);

  try {
    await runCommand("ffmpeg", [
      "-y",
      "-i",
      videoPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "48k",
      tmpAudioPath,
    ]);

    const audioBytes = await fs.readFile(tmpAudioPath);
    const base64 = audioBytes.toString("base64");
    return `data:audio/mpeg;base64,${base64}`;
  } finally {
    await fs.rm(tmpAudioPath, { force: true });
  }
};

const extractTextFromChatContent = (content: unknown): string => {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const texts = content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .filter(Boolean);

    return texts.join(" ").trim();
  }

  return "";
};

export class OpenAiAsrProvider implements AsrProvider {
  async transcribe(videoPath: string, durationSec: number): Promise<Cue[]> {
    if (!env.openAiApiKey) {
      throw new Error("OPENAI_API_KEY is required for ASR provider");
    }

    if (isDashscopeCompatibleBase(env.openAiBaseUrl)) {
      const audioDataUri = await extractAudioDataUriFromVideo(videoPath);

      const response = await fetch(`${env.openAiBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.openAiApiKey}`,
        },
        body: JSON.stringify({
          model: env.openAiAsrModel,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "input_audio",
                  input_audio: {
                    data: audioDataUri,
                  },
                },
              ],
            },
          ],
          stream: false,
          extra_body: {
            asr_options: {
              language: "en",
              enable_itn: false,
            },
          },
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Qwen ASR failed: ${response.status} ${body}`);
      }

      const payload = (await response.json()) as ChatResponse;
      const content = payload.choices?.[0]?.message?.content;
      const text = extractTextFromChatContent(content);
      if (!text) {
        throw new Error("Qwen ASR returned empty transcript");
      }

      const cues = splitTextToCues(text, durationSec);
      if (!cues.length) {
        throw new Error("Qwen ASR transcript parsing failed");
      }

      return cues;
    }

    const bytes = await fs.readFile(videoPath);
    const file = new File([bytes], path.basename(videoPath), {
      type: "video/mp4",
    });

    const formData = new FormData();
    formData.set("file", file);
    formData.set("model", env.openAiAsrModel);
    formData.set("response_format", "verbose_json");
    formData.set("language", "en");

    const response = await fetch(`${env.openAiBaseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.openAiApiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI ASR failed: ${response.status} ${body}`);
    }

    const payload = (await response.json()) as TranscriptionResponse;
    const segments = payload.segments ?? [];

    return segments
      .filter((segment) => typeof segment.start === "number" && typeof segment.end === "number" && segment.text)
      .map((segment) => ({
        startSec: segment.start,
        endSec: segment.end,
        text: segment.text.trim(),
      }));
  }
}

export class OpenAiTranslationProvider implements TranslationProvider {
  private async requestChatCompletion(messages: Array<{ role: "system" | "user"; content: string }>): Promise<string> {
    const response = await fetch(`${env.openAiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.openAiApiKey}`,
      },
      body: JSON.stringify({
        model: env.openAiTranslationModel,
        temperature: 0,
        messages,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Translation failed: ${response.status} ${body}`);
    }

    const payload = (await response.json()) as ChatResponse;
    const content = payload.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : extractTextFromChatContent(content);
  }

  private parseJsonArray(content: string): string[] | null {
    const trimmed = content.trim();

    const candidates = [trimmed];

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
      candidates.push(fenced[1].trim());
    }

    const firstBracket = trimmed.indexOf("[");
    const lastBracket = trimmed.lastIndexOf("]");
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      candidates.push(trimmed.slice(firstBracket, lastBracket + 1));
    }

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
          return parsed as string[];
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private async translateOneByOne(texts: string[]): Promise<string[]> {
    const result: string[] = [];

    for (const text of texts) {
      const content = await this.requestChatCompletion([
        {
          role: "system",
          content: "Translate English to Simplified Chinese. Return only translated text with no explanation.",
        },
        {
          role: "user",
          content: text,
        },
      ]);

      const translated = (content || "").trim();
      result.push(translated || text);
    }

    return result;
  }

  async translate(texts: string[]): Promise<string[]> {
    if (!env.openAiApiKey) {
      throw new Error("OPENAI_API_KEY is required for translation provider");
    }

    if (texts.length === 0) {
      return [];
    }

    const batchContent = await this.requestChatCompletion([
      {
        role: "system",
        content:
          "Translate each English string to Simplified Chinese. Output ONLY a JSON array of strings in the same order, no extra text.",
      },
      {
        role: "user",
        content: JSON.stringify(texts),
      },
    ]);

    const parsed = this.parseJsonArray(batchContent || "");
    if (parsed && parsed.length === texts.length) {
      return parsed;
    }

    // Fallback for providers that do not strictly follow JSON-array output.
    return this.translateOneByOne(texts);
  }
}
