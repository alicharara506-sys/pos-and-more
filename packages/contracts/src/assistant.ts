import { z } from 'zod';

export const assistantConversationTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(4000),
});

export const askAssistantSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  // Prior turns for a multi-turn chat — kept client-side only, never
  // persisted server-side in this phase (see docs/ai-assistant.md).
  conversation: z.array(assistantConversationTurnSchema).max(20).default([]),
});
export type AskAssistantInput = z.infer<typeof askAssistantSchema>;
