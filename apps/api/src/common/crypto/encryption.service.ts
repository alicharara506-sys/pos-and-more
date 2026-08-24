import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { loadEnv } from '@salesmaster/config';

const ALGORITHM = 'aes-256-gcm';

/**
 * Field-level encryption for provider refresh tokens and other secrets that
 * must be reversible (unlike passwords, which are hashed). Uses AES-256-GCM
 * with a random IV per value. The key is derived from AUTH_ENCRYPTION_KEY via
 * SHA-256 so any sufficiently long secret string works as input.
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor() {
    const env = loadEnv();
    if (!env.AUTH_ENCRYPTION_KEY) {
      throw new Error('AUTH_ENCRYPTION_KEY must be set to encrypt provider secrets at rest.');
    }
    this.key = createHash('sha256').update(env.AUTH_ENCRYPTION_KEY).digest();
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join(
      '.',
    );
  }

  decrypt(payload: string): string {
    const [ivB64, authTagB64, dataB64] = payload.split('.');
    if (!ivB64 || !authTagB64 || !dataB64) {
      throw new Error('Malformed encrypted payload');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }

  /** One-way hash for values we verify but never need to reverse (e.g. recovery codes, session tokens). */
  static sha256Hex(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
