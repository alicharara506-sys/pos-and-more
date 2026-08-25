import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PERMISSIONS } from '@salesmaster/domain';
import {
  createInvoiceSchema,
  createQuoteSchema,
  recordInvoicePaymentSchema,
  sendInvoiceSchema,
} from '@salesmaster/contracts';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RbacGuard } from '../common/guards/rbac.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { InvoicesService } from './invoices.service';
import type { User } from '@salesmaster/database';

@ApiTags('invoices')
@Controller()
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  // Public, revocable invoice-view link — no auth, deliberately outside the tenant guard chain (spec §10).
  @Public()
  @Get('public/invoices/:token')
  async getPublic(@Param('token') token: string) {
    return this.invoices.getPublicInvoice(token);
  }

  @UseGuards(SessionAuthGuard, TenantGuard, RbacGuard)
  @Get('invoices')
  @RequirePermissions(PERMISSIONS.INVOICES_MANAGE)
  async list(@CurrentTenantId() tenantId: string) {
    return this.invoices.list(tenantId);
  }

  @UseGuards(SessionAuthGuard, TenantGuard, RbacGuard)
  @Get('invoices/:id')
  @RequirePermissions(PERMISSIONS.INVOICES_MANAGE)
  async get(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.invoices.get(tenantId, id);
  }

  @UseGuards(SessionAuthGuard, TenantGuard, RbacGuard)
  @Post('invoices')
  @RequirePermissions(PERMISSIONS.INVOICES_MANAGE)
  async create(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createInvoiceSchema)) body: unknown,
  ) {
    return this.invoices.createInvoice(
      tenantId,
      user.id,
      body as import('@salesmaster/contracts').CreateInvoiceInput,
    );
  }

  @UseGuards(SessionAuthGuard, TenantGuard, RbacGuard)
  @Post('invoices/:id/payments')
  @RequirePermissions(PERMISSIONS.INVOICES_MANAGE)
  async recordPayment(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(recordInvoicePaymentSchema)) body: unknown,
  ) {
    return this.invoices.recordPayment(
      tenantId,
      user.id,
      id,
      body as import('@salesmaster/contracts').RecordInvoicePaymentInput,
    );
  }

  @UseGuards(SessionAuthGuard, TenantGuard, RbacGuard)
  @Post('invoices/:id/void')
  @RequirePermissions(PERMISSIONS.INVOICES_MANAGE)
  async void_(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.invoices.voidInvoice(tenantId, user.id, id);
  }

  @UseGuards(SessionAuthGuard, TenantGuard, RbacGuard)
  @Get('invoices/:id/qr')
  @RequirePermissions(PERMISSIONS.INVOICES_MANAGE)
  async qr(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.invoices.getQrCode(tenantId, id);
  }

  // Each call can trigger a real, billed email/SMS send once a provider is
  // configured — bounds cost from a spammed button, not just abuse.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(SessionAuthGuard, TenantGuard, RbacGuard)
  @Post('invoices/:id/send')
  @RequirePermissions(PERMISSIONS.INVOICES_MANAGE)
  async send(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(sendInvoiceSchema)) body: unknown,
  ) {
    return this.invoices.send(
      tenantId,
      user.id,
      id,
      body as import('@salesmaster/contracts').SendInvoiceInput,
    );
  }

  @UseGuards(SessionAuthGuard, TenantGuard, RbacGuard)
  @Post('invoices/:id/revoke-public-link')
  @RequirePermissions(PERMISSIONS.INVOICES_MANAGE)
  async revokeLink(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.invoices.revokePublicLink(tenantId, user.id, id);
  }

  // --- Quotes ---------------------------------------------------------------

  @UseGuards(SessionAuthGuard, TenantGuard, RbacGuard)
  @Post('quotes')
  @RequirePermissions(PERMISSIONS.QUOTES_MANAGE)
  async createQuote(
    @CurrentTenantId() tenantId: string,
    @Body(new ZodValidationPipe(createQuoteSchema)) body: unknown,
  ) {
    return this.invoices.createQuote(
      tenantId,
      body as import('@salesmaster/contracts').CreateQuoteInput,
    );
  }

  @UseGuards(SessionAuthGuard, TenantGuard, RbacGuard)
  @Post('quotes/:id/convert')
  @RequirePermissions(PERMISSIONS.QUOTES_MANAGE)
  async convertQuote(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.invoices.convertQuoteToInvoice(tenantId, user.id, id);
  }
}
