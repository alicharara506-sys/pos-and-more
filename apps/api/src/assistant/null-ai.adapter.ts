import { Injectable } from '@nestjs/common';
import type {
  AiAssistantAdapter,
  AskAiAssistantInput,
  AskAiAssistantResult,
} from './ai-adapter.interface';

/**
 * Fallback adapter used when AI_PROVIDER=none (the default in this
 * environment — no ANTHROPIC_API_KEY is available). Never fakes an answer;
 * the caller (AssistantService) checks `isConfigured()` before calling
 * `ask()` and returns an honest "not configured" response, so `ask()`
 * throwing here is a defense-in-depth backstop, not the primary path.
 */
@Injectable()
export class NullAiAssistantAdapter implements AiAssistantAdapter {
  readonly name = 'none' as const;

  isConfigured(): boolean {
    return false;
  }

  async ask(_input: AskAiAssistantInput): Promise<AskAiAssistantResult> {
    throw new Error(
      'AI assistant is not configured (AI_PROVIDER=none) — set ANTHROPIC_API_KEY to enable it.',
    );
  }
}
