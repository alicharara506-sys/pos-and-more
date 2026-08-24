import { Global, Module } from '@nestjs/common';
import { MembershipService } from './membership.service';

// Global: TenantGuard (used on nearly every controller) depends on
// MembershipService, so every feature module needs it without having to
// remember to import TenancyModule individually — same rationale as
// PrismaModule/CommonModule being global.
@Global()
@Module({
  providers: [MembershipService],
  exports: [MembershipService],
})
export class TenancyModule {}
