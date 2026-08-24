import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import { randomBytes } from 'node:crypto';
import { EncryptionService } from '../common/crypto/encryption.service';

export interface MfaEnrollment {
  secret: string;
  otpauthUrl: string;
  recoveryCodes: string[];
}

/** TOTP-based MFA (Google Authenticator / Authy compatible) + single-use recovery codes. */
@Injectable()
export class MfaService {
  generateEnrollment(accountLabel: string): MfaEnrollment {
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(accountLabel, 'SalesMaster Pro', secret);
    const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(5).toString('hex'));
    return { secret, otpauthUrl, recoveryCodes };
  }

  verifyCode(secret: string, code: string): boolean {
    return authenticator.check(code, secret);
  }

  /** Recovery codes are stored hashed (never reversible), matching password handling. */
  hashRecoveryCodes(codes: string[]): string {
    return codes.map((c) => EncryptionService.sha256Hex(c)).join(',');
  }

  verifyRecoveryCode(
    hashedCodesCsv: string,
    candidate: string,
  ): { valid: boolean; remaining: string } {
    const hashes = hashedCodesCsv.split(',').filter(Boolean);
    const candidateHash = EncryptionService.sha256Hex(candidate);
    const index = hashes.indexOf(candidateHash);
    if (index === -1) {
      return { valid: false, remaining: hashedCodesCsv };
    }
    hashes.splice(index, 1);
    return { valid: true, remaining: hashes.join(',') };
  }
}
