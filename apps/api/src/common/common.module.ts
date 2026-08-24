import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './crypto/encryption.service';

@Global()
@Module({
  providers: [EncryptionService],
  exports: [EncryptionService],
})
export class CommonModule {}
