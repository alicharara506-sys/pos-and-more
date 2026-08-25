import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { NullAiAssistantAdapter } from './null-ai.adapter';
import { AnthropicAiAssistantAdapter } from './anthropic-ai.adapter';
import { createToolExecutor } from './tools';
import { AssistantService } from './assistant.service';
import type { ReportsService } from '../reports/reports.service';

describe('NullAiAssistantAdapter', () => {
  it('reports itself unconfigured and never fakes an answer', async () => {
    const adapter = new NullAiAssistantAdapter();
    expect(adapter.isConfigured()).toBe(false);
    await expect(
      adapter.ask({ systemPrompt: 'x', conversation: [], tools: [], executeTool: vi.fn() }),
    ).rejects.toThrow(/not configured/);
  });
});

function fakeAnthropicClient(responses: Array<Partial<Anthropic.Message>>): {
  client: Anthropic;
  calls: unknown[];
} {
  const calls: unknown[] = [];
  let i = 0;
  const create = vi.fn(async (params: unknown) => {
    calls.push(params);
    const next = responses[Math.min(i, responses.length - 1)];
    i++;
    return next as Anthropic.Message;
  });
  return { client: { messages: { create } } as unknown as Anthropic, calls };
}

describe('AnthropicAiAssistantAdapter', () => {
  it('returns the final text answer when the model needs no tools', async () => {
    const { client } = fakeAnthropicClient([
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Your sales were flat this week.' } as never],
      },
    ]);
    const adapter = new AnthropicAiAssistantAdapter({ apiKey: 'sk-test', client });

    const result = await adapter.ask({
      systemPrompt: 'system',
      conversation: [{ role: 'user', content: 'How were sales?' }],
      tools: [],
      executeTool: vi.fn(),
    });

    expect(result.answer).toBe('Your sales were flat this week.');
    expect(result.toolCalls).toHaveLength(0);
  });

  it('executes a requested tool and feeds the result back before answering', async () => {
    const { client, calls } = fakeAnthropicClient([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'call_1', name: 'get_low_stock_items', input: {} } as never,
        ],
      },
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'You have 2 items low on stock.' } as never],
      },
    ]);
    const executeTool = vi.fn().mockResolvedValue([{ sku: 'A' }, { sku: 'B' }]);
    const adapter = new AnthropicAiAssistantAdapter({ apiKey: 'sk-test', client });

    const result = await adapter.ask({
      systemPrompt: 'system',
      conversation: [{ role: 'user', content: "What's low on stock?" }],
      tools: [
        {
          name: 'get_low_stock_items',
          description: 'x',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
      executeTool,
    });

    expect(executeTool).toHaveBeenCalledWith('get_low_stock_items', {});
    expect(result.answer).toBe('You have 2 items low on stock.');
    expect(result.toolCalls).toEqual([{ name: 'get_low_stock_items', input: {} }]);

    // Second API call must include the tool_result for the first call's tool_use_id.
    const secondCallParams = calls[1] as { messages: Array<{ role: string; content: unknown }> };
    const toolResultMessage = secondCallParams.messages.at(-1)!;
    expect(toolResultMessage.role).toBe('user');
    expect(toolResultMessage.content).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 'call_1',
        content: JSON.stringify([{ sku: 'A' }, { sku: 'B' }]),
      },
    ]);
  });

  it('reports a failed tool call as an error result instead of throwing', async () => {
    const { client } = fakeAnthropicClient([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'call_1', name: 'get_sales_summary', input: {} } as never,
        ],
      },
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'I could not run that report.' } as never],
      },
    ]);
    const executeTool = vi.fn().mockRejectedValue(new Error('Invalid from/to date'));
    const adapter = new AnthropicAiAssistantAdapter({ apiKey: 'sk-test', client });

    const result = await adapter.ask({
      systemPrompt: 'system',
      conversation: [{ role: 'user', content: 'sales?' }],
      tools: [],
      executeTool,
    });

    expect(result.answer).toBe('I could not run that report.');
  });
});

describe('createToolExecutor', () => {
  function fakeReports(): ReportsService {
    return {
      getSalesByPeriod: vi.fn().mockResolvedValue('sales-result'),
      getLowStockItems: vi.fn().mockResolvedValue('low-stock-result'),
      getInventoryValuation: vi.fn().mockResolvedValue('valuation-result'),
      getDashboard: vi.fn().mockResolvedValue('dashboard-result'),
    } as unknown as ReportsService;
  }

  it('routes get_sales_summary to ReportsService.getSalesByPeriod with parsed dates', async () => {
    const reports = fakeReports();
    const execute = createToolExecutor('tenant-1', reports);
    const result = await execute('get_sales_summary', {
      from: '2026-01-01',
      to: '2026-01-31',
      groupBy: 'week',
    });
    expect(reports.getSalesByPeriod).toHaveBeenCalledWith(
      'tenant-1',
      new Date('2026-01-01'),
      new Date('2026-01-31'),
      'week',
    );
    expect(result).toBe('sales-result');
  });

  it('rejects an invalid date rather than passing NaN through', async () => {
    const execute = createToolExecutor('tenant-1', fakeReports());
    await expect(
      execute('get_sales_summary', { from: 'not-a-date', to: '2026-01-31' }),
    ).rejects.toThrow();
  });

  it('rejects an unknown tool name', async () => {
    const execute = createToolExecutor('tenant-1', fakeReports());
    await expect(execute('drop_all_tables', {})).rejects.toThrow(/Unknown tool/);
  });
});

describe('AssistantService', () => {
  it('reports "not configured" honestly instead of calling the adapter', async () => {
    const adapter = { name: 'none', isConfigured: () => false, ask: vi.fn() };
    const service = new AssistantService(adapter, {} as ReportsService);

    await expect(service.ask('tenant-1', { question: 'hi', conversation: [] })).rejects.toThrow(
      /not configured/,
    );
    expect(adapter.ask).not.toHaveBeenCalled();
  });

  it('calls the adapter with the question appended to the conversation when configured', async () => {
    const adapter = {
      name: 'anthropic',
      isConfigured: () => true,
      ask: vi.fn().mockResolvedValue({
        answer: 'Answer',
        toolCalls: [{ name: 'get_low_stock_items', input: {} }],
      }),
    };
    const service = new AssistantService(adapter, {} as ReportsService);

    const result = await service.ask('tenant-1', {
      question: 'How is stock?',
      conversation: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
    });

    expect(result).toEqual({ answer: 'Answer', toolCalls: ['get_low_stock_items'] });
    expect(adapter.ask).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
          { role: 'user', content: 'How is stock?' },
        ],
      }),
    );
  });
});
