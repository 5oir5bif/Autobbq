import { Cue } from "../types/models";

export interface AsrProvider {
  transcribe(videoPath: string, durationSec: number): Promise<Cue[]>;
}

export interface TranslationProvider {
  translate(texts: string[]): Promise<string[]>;
}
