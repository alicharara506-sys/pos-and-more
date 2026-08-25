import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PERMISSIONS } from '@salesmaster/domain';
import { createCommerceConnectionSchema, triggerSyncSchema } from '@salesmaster/contracts';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RbacGuard } from '../common/guards/rbac.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { IntegrationsService } from './integrations.service';
import type { User } from '@salesmaster/database';

@ApiTags('integrations')
@Controller()
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @UseGuards(SessionAuthGuard, TenantGuard, RbacGuard)
  @Get('integrations/connections')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  async list(@CurrentTenantId() tenantId: string) {
    return this.integrations.listConnections(tenantId);
  }

  @UseGuards(SessionAuthGuard, TenantGuard, RbacGuard)
  @Post('integrations/connections')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  async create(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createCommerceConnectionSchema)) body: unknown,
  ) {
    return this.integrations.createConnection(
      tenantId,
      user.id,
      body as import('@salesmaster/contracts').CreateCommerceConnectionInput,
    );
  }

  @UseGuards(SessionAuthGuard, TenantGuard, RbacGuard)
  @Get('integrations/connections/:id/health')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  async health(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.integrations.getConnectionHealth(tenantId, id);
  }

  @UseGuards(SessionAuthGuard, TenantGuard, RbacGuard)
  @Post('integrations/connections/:id/test')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  async test(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.integrations.testConnection(tenantId, id);
  }

  @UseGuards(SessionAuthGuard, TenantGuard, RbacGuard)
  @Post('integrations/connections/:id/disconnect')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  async disconnect(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.integrations.disconnect(tenantId, user.id, id);
  }

  @UseGuards(SessionAuthGuard, TenantGuard, RbacGuard)
  @Post('integrations/connections/:id/sync')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  async sync(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(triggerSyncSchema)) body: unknown,
  ) {
    const input = body as import('@salesmaster/contracts').TriggerSyncInput;
    switch (input.domain) {
      case 'PRODUCTS':
        return this.integrations.syncProducts(tenantId, user.id, id);
      case 'INVENTORY':
        return this.integrations.pushInventory(tenantId, user.id, id);
      default:
        throw new BadRequestException(
          `Sync domain ${input.domain} is not implemented in this phase`,
        );
    }
  }

  // Public: providers call this directly, authenticated by their own
  // webhook signature (verified inside handleWebhook), not a SalesMaster
  // Pro session. Needs the raw body — see main.ts's raw-body exemption,
  // mirroring the Stripe webhook route.
  @Public()
  @Post('integrations/webhooks/:connectionId')
  async webhook(@Param('connectionId') connectionId: string, @Req() req: Request) {
    if (!Buffer.isBuffer(req.body)) {
      throw new BadRequestException('Webhook route must receive the raw request body');
    }
    return this.integrations.handleWebhook(
      connectionId,
      req.headers as Record<string, string>,
      req.body,
    );
  }
}
