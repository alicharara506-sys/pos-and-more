import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PERMISSIONS } from '@salesmaster/domain';
import { askAssistantSchema, type AskAssistantInput } from '@salesmaster/contracts';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RbacGuard } from '../common/guards/rbac.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-membership.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AssistantService } from './assistant.service';

@ApiTags('assistant')
@UseGuards(SessionAuthGuard, TenantGuard, RbacGuard)
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get('status')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  status() {
    return { configured: this.assistant.isConfigured() };
  }

  // Each call can trigger a real, billed external API request (once a
  // provider is configured) — tighter than the global throttle to bound
  // cost from a runaway client, not just abuse.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('ask')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  async ask(
    @CurrentTenantId() tenantId: string,
    @Body(new ZodValidationPipe(askAssistantSchema)) body: unknown,
  ) {
    return this.assistant.ask(tenantId, body as AskAssistantInput);
  }
}
