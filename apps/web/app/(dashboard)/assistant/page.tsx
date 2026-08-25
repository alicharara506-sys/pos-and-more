'use client';

import { useEffect, useRef, useState } from 'react';
import { useTenantApi } from '@/lib/use-tenant-api';

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export default function AssistantPage() {
  const api = useTenantApi();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ configured: boolean }>('/assistant/status')
      .then((r) => setConfigured(r.configured))
      .catch(() => setConfigured(false));
  }, [api]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  async function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || sending) return;
    setError(null);
    const nextTurns: ChatTurn[] = [...turns, { role: 'user', content: question }];
    setTurns(nextTurns);
    setQuestion('');
    setSending(true);
    try {
      const result = await api<{ answer: string; toolCalls: string[] }>('/assistant/ask', {
        method: 'POST',
        body: { question, conversation: turns },
      });
      setTurns([...nextTurns, { role: 'assistant', content: result.answer }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The assistant could not answer that.');
      setTurns(turns); // roll back the optimistic user turn on failure
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4 md:h-[calc(100vh-2rem)]">
      <div>
        <h1 className="text-xl font-semibold">AI Assistant</h1>
        <p className="text-sm text-gray-500">
          Ask about your sales, inventory, and stock levels — answered from your real data, not
          guessed.
        </p>
      </div>

      {configured === false && (
        <div className="card border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          The AI assistant is not configured in this environment (no ANTHROPIC_API_KEY is set).
          Questions below will fail honestly rather than return a fabricated answer.
        </div>
      )}

      <div className="card flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {turns.length === 0 && (
            <p className="text-sm text-gray-500">
              Try asking: &ldquo;What were my sales this week?&rdquo; or &ldquo;What&apos;s low on
              stock?&rdquo;
            </p>
          )}
          {turns.map((turn, i) => (
            <div
              key={i}
              className={`flex ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                  turn.role === 'user' ? 'bg-brand-600 text-white' : 'bg-gray-100 dark:bg-gray-800'
                }`}
              >
                {turn.content}
              </div>
            </div>
          ))}
          {sending && <p className="text-sm text-gray-500">Thinking…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={handleAsk}
          className="flex gap-2 border-t border-gray-100 p-3 dark:border-gray-800"
        >
          <input
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
            placeholder="Ask a question about your business…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={sending}
          />
          <button
            disabled={sending || !question.trim()}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Ask
          </button>
        </form>
      </div>
    </div>
  );
}
