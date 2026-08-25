import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { ConnectorRegistry } from './connector-registry';

@Module({
  imports: [AuditModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, ConnectorRegistry],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
