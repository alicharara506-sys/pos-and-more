import Anthropic from '@anthropic-ai/sdk';
import type {
  AiAssistantAdapter,
  AskAiAssistantInput,
  AskAiAssistantResult,
} from './ai-adapter.interface';

const MODEL = 'claude-opus-5';
// Business-assistant replies are deliberately short conversational answers,
// not long-form generation — see the max_tokens guidance in the Claude API
// skill for when a value below its ~16000 non-streaming default is warranted.
const MAX_TOKENS = 4096;
const MAX_TOOL_ROUNDTRIPS = 5;

export interface AnthropicAiAssistantAdapterConfig {
  apiKey: string;
  client?: Anthropic;
}

/**
 * Real Anthropic Messages API integration via the official `@anthropic-ai/sdk`
 * (never raw HTTP — see the claude-api skill's Output Requirement), running
 * a manual tool-use loop rather than the beta tool runner so this stays
 * behind our own provider-agnostic `AiAssistantAdapter` interface. Genuine
 * code, exercised against the real endpoint whenever ANTHROPIC_API_KEY is
 * set; this environment has no live key, so it has only been verified to
 * build/typecheck and to make correctly-shaped requests against a fake
 * transport, never to actually receive a real model response — same honest
 * disclosure as the Resend/Twilio adapters (see docs/notifications.md).
 */
export class AnthropicAiAssistantAdapter implements AiAssistantAdapter {
  readonly name = 'anthropic' as const;
  private readonly client: Anthropic;

  constructor(config: AnthropicAiAssistantAdapterConfig) {
    this.client = config.client ?? new Anthropic({ apiKey: config.apiKey });
  }

  isConfigured(): boolean {
    return true;
  }

  async ask(input: AskAiAssistantInput): Promise<AskAiAssistantResult> {
    const tools: Anthropic.Tool[] = input.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));

    let messages: Anthropic.MessageParam[] = input.conversation.map((turn) => ({
      role: turn.role,
      content: turn.content,
    }));

    const toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];

    for (let roundtrip = 0; roundtrip <= MAX_TOOL_ROUNDTRIPS; roundtrip++) {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: input.systemPrompt,
        tools,
        messages,
      });

      if (response.stop_reason === 'pause_turn') {
        messages = [...messages, { role: 'assistant', content: response.content }];
        continue;
      }

      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );

      if (toolUseBlocks.length === 0 || roundtrip === MAX_TOOL_ROUNDTRIPS) {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        return {
          answer: text || "I wasn't able to find an answer to that.",
          toolCalls,
        };
      }

      messages = [...messages, { role: 'assistant', content: response.content }];

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        const toolInput = block.input as Record<string, unknown>;
        toolCalls.push({ name: block.name, input: toolInput });
        try {
          const result = await input.executeTool(block.name, toolInput);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        } catch (err) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: err instanceof Error ? err.message : 'Tool execution failed',
            is_error: true,
          });
        }
      }
      messages = [...messages, { role: 'user', content: toolResults }];
    }

    // Unreachable in practice — the loop above always returns by MAX_TOOL_ROUNDTRIPS.
    return { answer: "I wasn't able to find an answer to that.", toolCalls };
  }
}
