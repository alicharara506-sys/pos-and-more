import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@salesmaster/domain';
import { createTenantOnboardingSchema, inviteUserSchema } from '@salesmaster/contracts';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RbacGuard } from '../common/guards/rbac.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentTenantId } from '../common/decorators/current-membership.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { OnboardingService } from './onboarding.service';
import type { User } from '@salesmaster/database';

@ApiTags('onboarding')
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @UseGuards(SessionAuthGuard)
  @Post('tenant')
  async createTenant(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createTenantOnboardingSchema)) body: unknown,
  ) {
    const input = body as import('@salesmaster/contracts').CreateTenantOnboardingInput;
    const { tenant, branch } = await this.onboarding.createTenant(user, input);
    return { tenant, branch };
  }

  @UseGuards(SessionAuthGuard, TenantGuard, RbacGuard)
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @Post('invite')
  async invite(
    @CurrentUser() user: User,
    @CurrentTenantId() tenantId: string,
    @Body(new ZodValidationPipe(inviteUserSchema)) body: unknown,
  ) {
    const input = body as import('@salesmaster/contracts').InviteUserInput;
    const invitation = await this.onboarding.inviteUser(tenantId, user.id, input);
    return { id: invitation.id, email: invitation.email, expiresAt: invitation.expiresAt };
  }

  @UseGuards(SessionAuthGuard)
  @Post('invite/:token/accept')
  async acceptInvite(@CurrentUser() user: User, @Param('token') token: string) {
    return this.onboarding.acceptInvitation(token, user);
  }
}
