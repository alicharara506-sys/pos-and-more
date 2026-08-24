import { Injectable } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { loadEnv } from '@salesmaster/config';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export interface VerifiedGoogleIdentity {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  pictureUrl: string | null;
  rawAccessToken?: string;
  rawRefreshToken?: string;
  tokenExpiresAt?: Date;
}

const jwks = createRemoteJWKSet(new URL(JWKS_URI));

/**
 * Google "Continue with Google" via Authorization Code + PKCE. Works for
 * both personal Gmail accounts and Google Workspace accounts — Workspace
 * accounts simply carry a `hd` (hosted domain) claim we pass through
 * unvalidated (we don't restrict sign-in to a domain; that's a
 * tenant-level policy decision, not an identity one).
 */
@Injectable()
export class GoogleOAuthService {
  isConfigured(): boolean {
    const env = loadEnv();
    return Boolean(
      env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REDIRECT_URI,
    );
  }

  buildAuthorizationUrl(params: { state: string; nonce: string; codeChallenge: string }): string {
    const env = loadEnv();
    if (!this.isConfigured()) throw new Error('Google OAuth is not configured');

    const url = new URL(AUTH_ENDPOINT);
    url.searchParams.set('client_id', env.GOOGLE_OAUTH_CLIENT_ID!);
    url.searchParams.set('redirect_uri', env.GOOGLE_OAUTH_REDIRECT_URI!);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', params.state);
    url.searchParams.set('nonce', params.nonce);
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    return url.toString();
  }

  async exchangeCodeForIdentity(params: {
    code: string;
    codeVerifier: string;
    expectedNonce: string;
  }): Promise<VerifiedGoogleIdentity> {
    const env = loadEnv();
    if (!this.isConfigured()) throw new Error('Google OAuth is not configured');

    const tokenResponse = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GOOGLE_OAUTH_CLIENT_ID!,
        client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET!,
        redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI!,
        grant_type: 'authorization_code',
        code: params.code,
        code_verifier: params.codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error(
        `Google token exchange failed: ${tokenResponse.status} ${await tokenResponse.text()}`,
      );
    }

    const tokens = (await tokenResponse.json()) as {
      id_token: string;
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const { payload } = await jwtVerify(tokens.id_token, jwks, {
      issuer: ISSUERS,
      audience: env.GOOGLE_OAUTH_CLIENT_ID!,
    });

    if (payload.nonce !== params.expectedNonce) {
      throw new Error('Google ID token nonce mismatch');
    }

    return {
      subject: payload.sub!,
      email: (payload.email as string | undefined) ?? null,
      emailVerified: Boolean(payload.email_verified),
      name: (payload.name as string | undefined) ?? null,
      pictureUrl: (payload.picture as string | undefined) ?? null,
      rawAccessToken: tokens.access_token,
      rawRefreshToken: tokens.refresh_token,
      tokenExpiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : undefined,
    };
  }
}
