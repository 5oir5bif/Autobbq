import { Cue } from "../types/models";
import { AsrProvider, TranslationProvider } from "./types";

const sampleEnglish = [
  "Hello everyone, welcome to this demo video.",
  "This MVP extracts English speech and translates it into Chinese subtitles.",
  "You can edit subtitle style before rendering the final video.",
  "Click render to burn subtitles into the output file.",
];

const zhMap: Record<string, string> = {
  "Hello everyone, welcome to this demo video.": "大家好，欢迎来到这个演示视频。",
  "This MVP extracts English speech and translates it into Chinese subtitles.": "这个 MVP 会提取英文语音并翻译成中文字幕。",
  "You can edit subtitle style before rendering the final video.": "在生成最终视频前，你可以调整字幕样式。",
  "Click render to burn subtitles into the output file.": "点击生成即可将字幕烧录到输出视频中。",
};

export class MockAsrProvider implements AsrProvider {
  async transcribe(_videoPath: string, durationSec: number): Promise<Cue[]> {
    const cueCount = Math.min(sampleEnglish.length, Math.max(2, Math.ceil(durationSec / 12)));
    const segment = durationSec / cueCount;

    return Array.from({ length: cueCount }).map((_, index) => {
      const start = Number((index * segment).toFixed(3));
      const end = Number(Math.min(durationSec, (index + 1) * segment - 0.1).toFixed(3));
      return {
        startSec: start,
        endSec: Math.max(start + 1, end),
        text: sampleEnglish[index],
      };
    });
  }
}

export class MockTranslationProvider implements TranslationProvider {
  async translate(texts: string[]): Promise<string[]> {
    return texts.map((text) => zhMap[text] ?? `【中文翻译】${text}`);
  }
}
