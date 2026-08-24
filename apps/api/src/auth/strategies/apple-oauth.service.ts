import { Injectable } from '@nestjs/common';
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose';
import { loadEnv } from '@salesmaster/config';

const AUTH_ENDPOINT = 'https://appleid.apple.com/auth/authorize';
const TOKEN_ENDPOINT = 'https://appleid.apple.com/auth/token';
const JWKS_URI = 'https://appleid.apple.com/auth/keys';
const ISSUER = 'https://appleid.apple.com';

export interface VerifiedAppleIdentity {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  isPrivateRelayEmail: boolean;
  rawAccessToken?: string;
  rawRefreshToken?: string;
  tokenExpiresAt?: Date;
}

const jwks = createRemoteJWKSet(new URL(JWKS_URI));

/**
 * Sign in with Apple via Authorization Code flow. Apple requires the client
 * secret to be a short-lived JWT signed with the app's private key (ES256),
 * not a static secret string — see docs/security.md §Apple.
 *
 * Because scope includes "name email", Apple sends the callback as an HTTP
 * POST (`response_mode=form_post`); the callback controller must accept a
 * POST body, not query params.
 */
@Injectable()
export class AppleOAuthService {
  isConfigured(): boolean {
    const env = loadEnv();
    return Boolean(
      env.APPLE_OAUTH_CLIENT_ID &&
      env.APPLE_OAUTH_TEAM_ID &&
      env.APPLE_OAUTH_KEY_ID &&
      env.APPLE_OAUTH_PRIVATE_KEY_BASE64 &&
      env.APPLE_OAUTH_REDIRECT_URI,
    );
  }

  buildAuthorizationUrl(params: { state: string; nonce: string }): string {
    const env = loadEnv();
    if (!this.isConfigured()) throw new Error('Apple OAuth is not configured');

    const url = new URL(AUTH_ENDPOINT);
    url.searchParams.set('client_id', env.APPLE_OAUTH_CLIENT_ID!);
    url.searchParams.set('redirect_uri', env.APPLE_OAUTH_REDIRECT_URI!);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'name email');
    url.searchParams.set('response_mode', 'form_post');
    url.searchParams.set('state', params.state);
    url.searchParams.set('nonce', params.nonce);
    return url.toString();
  }

  private async buildClientSecret(): Promise<string> {
    const env = loadEnv();
    const pem = Buffer.from(env.APPLE_OAUTH_PRIVATE_KEY_BASE64!, 'base64').toString('utf8');
    const privateKey = await importPKCS8(pem, 'ES256');

    return new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: env.APPLE_OAUTH_KEY_ID! })
      .setIssuer(env.APPLE_OAUTH_TEAM_ID!)
      .setSubject(env.APPLE_OAUTH_CLIENT_ID!)
      .setAudience(ISSUER)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
  }

  async exchangeCodeForIdentity(params: {
    code: string;
    expectedNonce: string;
  }): Promise<VerifiedAppleIdentity> {
    const env = loadEnv();
    if (!this.isConfigured()) throw new Error('Apple OAuth is not configured');

    const clientSecret = await this.buildClientSecret();

    const tokenResponse = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.APPLE_OAUTH_CLIENT_ID!,
        client_secret: clientSecret,
        redirect_uri: env.APPLE_OAUTH_REDIRECT_URI!,
        grant_type: 'authorization_code',
        code: params.code,
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error(
        `Apple token exchange failed: ${tokenResponse.status} ${await tokenResponse.text()}`,
      );
    }

    const tokens = (await tokenResponse.json()) as {
      id_token: string;
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const { payload } = await jwtVerify(tokens.id_token, jwks, {
      issuer: ISSUER,
      audience: env.APPLE_OAUTH_CLIENT_ID!,
    });

    if (payload.nonce !== params.expectedNonce) {
      throw new Error('Apple ID token nonce mismatch');
    }

    return {
      subject: payload.sub!,
      email: (payload.email as string | undefined) ?? null,
      emailVerified: payload.email_verified === true || payload.email_verified === 'true',
      isPrivateRelayEmail: payload.is_private_email === true || payload.is_private_email === 'true',
      rawAccessToken: tokens.access_token,
      rawRefreshToken: tokens.refresh_token,
      tokenExpiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : undefined,
    };
  }
}
