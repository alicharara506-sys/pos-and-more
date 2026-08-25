import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './crypto/encryption.service';
import { QrService } from './qr/qr.service';

@Global()
@Module({
  providers: [EncryptionService, QrService],
  exports: [EncryptionService, QrService],
})
export class CommonModule {}
