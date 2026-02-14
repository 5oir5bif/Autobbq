import { env } from "../config/env";
import { MockAsrProvider, MockTranslationProvider } from "./mockProvider";
import { OpenAiAsrProvider, OpenAiTranslationProvider } from "./openAiProvider";
import { AsrProvider, TranslationProvider } from "./types";

export const buildProviders = (): {
  asrProvider: AsrProvider;
  translationProvider: TranslationProvider;
} => {
  const asrProvider: AsrProvider = env.asrProvider === "openai" ? new OpenAiAsrProvider() : new MockAsrProvider();
  const translationProvider: TranslationProvider =
    env.translationProvider === "openai" ? new OpenAiTranslationProvider() : new MockTranslationProvider();

  return {
    asrProvider,
    translationProvider,
  };
};
