import { Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { EncryptionService } from '../common/crypto/encryption.service';

export interface OAuthHandshakeState {
  state: string;
  nonce: string;
  codeVerifier: string;
  createdAt: number;
}

export const OAUTH_HANDSHAKE_COOKIE_PREFIX = 'sm_oauth_';
const HANDSHAKE_TTL_MS = 10 * 60_000;

/**
 * Stores the PKCE code_verifier + state + nonce for an in-flight OAuth
 * Authorization Code flow in a short-lived, encrypted, httpOnly cookie
 * (scoped to the provider) rather than server-side session storage — avoids
 * a Redis dependency for a value that is only ever read once, seconds later,
 * by the same browser.
 */
@Injectable()
export class OAuthHandshakeService {
  constructor(private readonly encryption: EncryptionService) {}

  create(): { handshake: OAuthHandshakeState; cookieValue: string; codeChallenge: string } {
    const state = randomBytes(24).toString('hex');
    const nonce = randomBytes(24).toString('hex');
    const codeVerifier = base64url(randomBytes(32));
    const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());

    const handshake: OAuthHandshakeState = { state, nonce, codeVerifier, createdAt: Date.now() };
    const cookieValue = this.encryption.encrypt(JSON.stringify(handshake));

    return { handshake, cookieValue, codeChallenge };
  }

  consume(cookieValue: string | undefined, expectedState: string): OAuthHandshakeState {
    if (!cookieValue) {
      throw new Error('Missing OAuth handshake cookie');
    }
    const handshake = JSON.parse(this.encryption.decrypt(cookieValue)) as OAuthHandshakeState;

    if (Date.now() - handshake.createdAt > HANDSHAKE_TTL_MS) {
      throw new Error('OAuth handshake expired');
    }
    if (handshake.state !== expectedState) {
      throw new Error('OAuth state mismatch — possible CSRF');
    }
    return handshake;
  }
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
