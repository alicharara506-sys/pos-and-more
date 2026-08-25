import { Module } from '@nestjs/common';
import { loadEnv } from '@salesmaster/config';
import { ReportsModule } from '../reports/reports.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { AI_ASSISTANT_ADAPTER } from './ai-adapter.interface';
import { NullAiAssistantAdapter } from './null-ai.adapter';
import { AnthropicAiAssistantAdapter } from './anthropic-ai.adapter';

/**
 * Mirrors billing.module.ts's provider-selection shape: a real adapter when
 * genuinely configured, an honest null adapter otherwise — never a silent
 * no-op that pretends to work.
 */
@Module({
  imports: [ReportsModule],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    {
      provide: AI_ASSISTANT_ADAPTER,
      useFactory: () => {
        const env = loadEnv();
        switch (env.AI_PROVIDER) {
          case 'anthropic':
            if (!env.ANTHROPIC_API_KEY) {
              throw new Error('AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY to be set.');
            }
            return new AnthropicAiAssistantAdapter({ apiKey: env.ANTHROPIC_API_KEY });
          case 'local':
            throw new Error(
              'AI_PROVIDER=local has no adapter implementation yet — use "anthropic" or "none".',
            );
          case 'none':
            return new NullAiAssistantAdapter();
          default:
            throw new Error(`Unknown AI_PROVIDER: ${env.AI_PROVIDER satisfies never}`);
        }
      },
    },
  ],
})
export class AssistantModule {}
