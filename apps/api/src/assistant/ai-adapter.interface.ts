export interface AiToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's input, in the shape every major LLM tool-use API expects. */
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface AiConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AskAiAssistantInput {
  systemPrompt: string;
  /** Prior turns plus the latest user question as the final entry. */
  conversation: AiConversationTurn[];
  tools: AiToolDefinition[];
  /** Executes one tool call against real tenant-scoped data — the adapter never touches storage directly. */
  executeTool: (name: string, input: Record<string, unknown>) => Promise<unknown>;
}

export interface AskAiAssistantResult {
  answer: string;
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
}

/**
 * Typed provider boundary for the AI assistant (section 1.2: keep external
 * providers behind typed adapters) — mirrors EmailAdapter/SmsAdapter/
 * CommerceConnector's shape. `isConfigured()` lets a caller check up front
 * rather than relying on a thrown error, matching BillingProvider's pattern
 * (see apps/api/src/billing/stripe/billing-provider.interface.ts).
 */
export interface AiAssistantAdapter {
  readonly name: string;
  isConfigured(): boolean;
  ask(input: AskAiAssistantInput): Promise<AskAiAssistantResult>;
}

/** NestJS DI token for the bound `AiAssistantAdapter` — see assistant.module.ts. */
export const AI_ASSISTANT_ADAPTER = Symbol('AI_ASSISTANT_ADAPTER');
