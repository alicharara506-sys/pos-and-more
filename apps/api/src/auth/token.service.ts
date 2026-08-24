import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { loadEnv } from '@salesmaster/config';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/crypto/encryption.service';

export type OneTimeTokenPurpose =
  'magic_link' | 'password_reset' | 'email_verification' | 'invitation_accept' | 'mfa_challenge';

/**
 * Two distinct token families, deliberately not unified:
 *  - One-time purpose tokens (magic link, password reset, email verify,
 *    invitation accept): short-lived, stateless, signed JWTs. Self-contained
 *    is fine here because they are single-use-by-convention and short TTL.
 *  - Sessions: opaque, revocable, DB-backed tokens (see session-auth.guard).
 *    A JWT access token cannot be revoked before it expires, which conflicts
 *    with the spec's "remote sign-out" requirement, so logged-in access
 *    never uses a bare JWT.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  private getSecretKey(): Uint8Array {
    const env = loadEnv();
    if (!env.AUTH_JWT_SECRET) {
      throw new Error('AUTH_JWT_SECRET must be set.');
    }
    return new TextEncoder().encode(env.AUTH_JWT_SECRET);
  }

  async signOneTimeToken(
    purpose: OneTimeTokenPurpose,
    payload: Record<string, unknown>,
    ttlMinutes: number,
  ): Promise<string> {
    return new SignJWT({ ...payload, purpose })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${ttlMinutes}m`)
      .sign(this.getSecretKey());
  }

  async verifyOneTimeToken<T extends Record<string, unknown>>(
    purpose: OneTimeTokenPurpose,
    token: string,
  ): Promise<T> {
    // A malformed, tampered, expired, or wrong-secret token is a client
    // error (401), never a 500 — jose throws its own error classes for all
    // of those, which would otherwise bubble up as an unhandled 500.
    const { payload } = await jwtVerify(token, this.getSecretKey()).catch(() => {
      throw new UnauthorizedException('Invalid or expired token');
    });
    if (payload.purpose !== purpose) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    return payload as T;
  }

  /** Creates a new revocable session and returns the raw (unhashed) bearer token to send to the client exactly once. */
  async createSession(params: {
    userId: string;
    deviceId?: string;
    ipAddress?: string;
    userAgent?: string;
    ttlMinutes: number;
    rotatedFromId?: string;
  }): Promise<{ rawToken: string; sessionId: string; expiresAt: Date }> {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = EncryptionService.sha256Hex(rawToken);
    const expiresAt = new Date(Date.now() + params.ttlMinutes * 60_000);

    const session = await this.prisma.client.session.create({
      data: {
        userId: params.userId,
        deviceId: params.deviceId,
        tokenHash,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        expiresAt,
        rotatedFromId: params.rotatedFromId,
      },
    });

    return { rawToken, sessionId: session.id, expiresAt };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.client.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllSessionsForUser(userId: string, exceptSessionId?: string): Promise<void> {
    await this.prisma.client.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        id: exceptSessionId ? { not: exceptSessionId } : undefined,
      },
      data: { revokedAt: new Date() },
    });
  }
}
