import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { AskAssistantInput } from '@salesmaster/contracts';
import { ReportsService } from '../reports/reports.service';
import { AI_ASSISTANT_ADAPTER, type AiAssistantAdapter } from './ai-adapter.interface';
import { ASSISTANT_TOOLS, createToolExecutor } from './tools';

const SYSTEM_PROMPT = `You are SalesMaster Pro's sales assistant, answering a business owner's
questions about their own store using the tools provided. Only use the tools — never invent
numbers. If a tool doesn't cover what's asked, say so plainly rather than guessing. Keep answers
short and concrete (numbers, not paragraphs of hedging). All figures are in the tenant's currency
unless a tool result says otherwise. Today's date is ${new Date().toISOString().slice(0, 10)}.`;

export interface AskAssistantResult {
  answer: string;
  toolCalls: string[];
}

@Injectable()
export class AssistantService {
  constructor(
    @Inject(AI_ASSISTANT_ADAPTER) private readonly adapter: AiAssistantAdapter,
    private readonly reports: ReportsService,
  ) {}

  isConfigured(): boolean {
    return this.adapter.isConfigured();
  }

  async ask(tenantId: string, input: AskAssistantInput): Promise<AskAssistantResult> {
    if (!this.adapter.isConfigured()) {
      throw new ServiceUnavailableException(
        `The AI assistant is not configured in this environment (provider: ${this.adapter.name}). Set AI_PROVIDER=anthropic and ANTHROPIC_API_KEY to enable it.`,
      );
    }

    const result = await this.adapter.ask({
      systemPrompt: SYSTEM_PROMPT,
      conversation: [...input.conversation, { role: 'user', content: input.question }],
      tools: ASSISTANT_TOOLS,
      executeTool: createToolExecutor(tenantId, this.reports),
    });

    return { answer: result.answer, toolCalls: result.toolCalls.map((t) => t.name) };
  }
}
