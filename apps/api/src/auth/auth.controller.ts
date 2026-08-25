import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { loadEnv } from '@salesmaster/config';
import {
  consumeMagicLinkSchema,
  loginWithPasswordSchema,
  registerWithPasswordSchema,
  requestMagicLinkSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  verifyMfaSchema,
} from '@salesmaster/contracts';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { MfaService } from './mfa.service';
import { EncryptionService } from '../common/crypto/encryption.service';
import { GoogleOAuthService } from './strategies/google-oauth.service';
import { AppleOAuthService } from './strategies/apple-oauth.service';
import { OAuthHandshakeService, OAUTH_HANDSHAKE_COOKIE_PREFIX } from './oauth-handshake.service';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SESSION_COOKIE_NAME } from '../common/guards/session-auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import type { User } from '@salesmaster/database';

const SESSION_COOKIE_OPTIONS = (env: ReturnType<typeof loadEnv>) => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
});

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly mfa: MfaService,
    private readonly encryption: EncryptionService,
    private readonly google: GoogleOAuthService,
    private readonly apple: AppleOAuthService,
    private readonly handshake: OAuthHandshakeService,
    private readonly prisma: PrismaService,
  ) {}

  private async respondWithSession(user: User, req: Request, res: Response) {
    const session = await this.auth.issueSession(user, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    const env = loadEnv();
    res.cookie(SESSION_COOKIE_NAME, session.rawToken, {
      ...SESSION_COOKIE_OPTIONS(env),
      expires: session.expiresAt,
    });
    return res.json({
      user: { id: user.id, email: user.email, name: user.name, mfaEnabled: user.mfaEnabled },
      // apps/web relies on the httpOnly cookie above and ignores this field.
      // Native clients (apps/mobile) can't read an httpOnly cookie from
      // fetch, so the raw token is also returned here for them to store in
      // SecureStore and send back as `Authorization: Bearer <token>` — see
      // SessionAuthGuard, which already accepts either.
      sessionToken: session.rawToken,
      sessionExpiresAt: session.expiresAt,
    });
  }

  // -- Email + password ----------------------------------------------------

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async register(
    @Body(new ZodValidationPipe(registerWithPasswordSchema)) body: unknown,
    @Res() res: Response,
  ) {
    const input = body as import('@salesmaster/contracts').RegisterWithPasswordInput;
    const user = await this.auth.register(input);
    return res.status(201).json({ id: user.id, email: user.email });
  }

  @Public()
  @Get('verify-email')
  async verifyEmail(@Query('token') token: string) {
    await this.auth.verifyEmail(token);
    return { verified: true };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  async login(
    @Body(new ZodValidationPipe(loginWithPasswordSchema)) body: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const input = body as import('@salesmaster/contracts').LoginWithPasswordInput;
    const result = await this.auth.loginWithPassword(input);
    if (result.status === 'mfa_required') {
      return res.json({ mfaRequired: true, mfaChallengeToken: result.mfaChallengeToken });
    }
    return this.respondWithSession(result.user, req, res);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/verify')
  async verifyMfaLogin(
    @Body() body: { mfaChallengeToken: string } & import('@salesmaster/contracts').VerifyMfaInput,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    verifyMfaSchema.parse({ code: body.code });
    const user = await this.auth.completeMfaChallenge(body.mfaChallengeToken, body.code);
    return this.respondWithSession(user, req, res);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password/forgot')
  async forgotPassword(@Body(new ZodValidationPipe(requestPasswordResetSchema)) body: unknown) {
    const input = body as import('@salesmaster/contracts').RequestPasswordResetInput;
    await this.auth.requestPasswordReset(input.email);
    return { sent: true };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password/reset')
  async resetPassword(@Body(new ZodValidationPipe(resetPasswordSchema)) body: unknown) {
    const input = body as import('@salesmaster/contracts').ResetPasswordInput;
    await this.auth.resetPassword(input.token, input.newPassword);
    return { reset: true };
  }

  // -- Magic link -----------------------------------------------------------

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('magic-link/request')
  async requestMagicLink(@Body(new ZodValidationPipe(requestMagicLinkSchema)) body: unknown) {
    const input = body as import('@salesmaster/contracts').RequestMagicLinkInput;
    await this.auth.requestMagicLink(input.email);
    return { sent: true };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('magic-link/consume')
  async consumeMagicLink(
    @Body(new ZodValidationPipe(consumeMagicLinkSchema)) body: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const input = body as import('@salesmaster/contracts').ConsumeMagicLinkInput;
    const user = await this.auth.consumeMagicLink(input.token);
    return this.respondWithSession(user, req, res);
  }

  // -- Google OAuth (Authorization Code + PKCE) ------------------------------

  @Public()
  @Get('google/start')
  async googleStart(@Res() res: Response) {
    const { handshake, cookieValue, codeChallenge } = this.handshake.create();
    const url = this.google.buildAuthorizationUrl({
      state: handshake.state,
      nonce: handshake.nonce,
      codeChallenge,
    });
    const env = loadEnv();
    res.cookie(`${OAUTH_HANDSHAKE_COOKIE_PREFIX}google`, cookieValue, {
      ...SESSION_COOKIE_OPTIONS(env),
      maxAge: 10 * 60_000,
    });
    return res.redirect(url);
  }

  @Public()
  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const cookieValue = req.cookies?.[`${OAUTH_HANDSHAKE_COOKIE_PREFIX}google`];
    const handshake = this.handshake.consume(cookieValue, state);
    const identity = await this.google.exchangeCodeForIdentity({
      code,
      codeVerifier: handshake.codeVerifier,
      expectedNonce: handshake.nonce,
    });
    const user = await this.auth.linkOrCreateUserForGoogleIdentity(identity);
    res.clearCookie(`${OAUTH_HANDSHAKE_COOKIE_PREFIX}google`);
    return this.respondWithSession(user, req, res);
  }

  // -- Apple OAuth (form_post callback) --------------------------------------

  @Public()
  @Get('apple/start')
  async appleStart(@Res() res: Response) {
    const { handshake, cookieValue } = this.handshake.create();
    const url = this.apple.buildAuthorizationUrl({
      state: handshake.state,
      nonce: handshake.nonce,
    });
    const env = loadEnv();
    res.cookie(`${OAUTH_HANDSHAKE_COOKIE_PREFIX}apple`, cookieValue, {
      ...SESSION_COOKIE_OPTIONS(env),
      maxAge: 10 * 60_000,
    });
    return res.redirect(url);
  }

  @Public()
  @Post('apple/callback')
  async appleCallback(
    @Body() body: { code: string; state: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const cookieValue = req.cookies?.[`${OAUTH_HANDSHAKE_COOKIE_PREFIX}apple`];
    const handshake = this.handshake.consume(cookieValue, body.state);
    const identity = await this.apple.exchangeCodeForIdentity({
      code: body.code,
      expectedNonce: handshake.nonce,
    });
    const user = await this.auth.linkOrCreateUserForAppleIdentity(identity);
    res.clearCookie(`${OAUTH_HANDSHAKE_COOKIE_PREFIX}apple`);
    return this.respondWithSession(user, req, res);
  }

  // -- MFA enrollment (requires an existing session) -------------------------

  @Post('mfa/enroll')
  async enrollMfa(@CurrentUser() user: User) {
    const enrollment = this.mfa.generateEnrollment(user.email);
    await this.prisma.client.user.update({
      where: { id: user.id },
      data: {
        mfaSecretEncrypted: this.encryption.encrypt(enrollment.secret),
        mfaRecoveryCodesEncrypted: this.encryption.encrypt(
          this.mfa.hashRecoveryCodes(enrollment.recoveryCodes),
        ),
      },
    });
    return { otpauthUrl: enrollment.otpauthUrl, recoveryCodes: enrollment.recoveryCodes };
  }

  @Post('mfa/activate')
  async activateMfa(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(verifyMfaSchema)) body: unknown,
  ) {
    const input = body as import('@salesmaster/contracts').VerifyMfaInput;
    const fresh = await this.prisma.client.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!fresh.mfaSecretEncrypted) {
      throw new UnauthorizedException('Call /auth/mfa/enroll first');
    }
    const secret = this.encryption.decrypt(fresh.mfaSecretEncrypted);
    if (!this.mfa.verifyCode(secret, input.code)) {
      throw new UnauthorizedException('Invalid MFA code');
    }
    await this.prisma.client.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    return { mfaEnabled: true };
  }

  @Post('mfa/disable')
  async disableMfa(@CurrentUser() user: User) {
    await this.prisma.client.user.update({
      where: { id: user.id },
      data: { mfaEnabled: false, mfaSecretEncrypted: null, mfaRecoveryCodesEncrypted: null },
    });
    return { mfaEnabled: false };
  }

  @Get('me')
  async me(@CurrentUser() user: User) {
    const memberships = await this.prisma.client.membership.findMany({
      where: { userId: user.id, status: 'ACTIVE' },
      include: { tenant: true, role: true },
    });
    return {
      user: { id: user.id, email: user.email, name: user.name, mfaEnabled: user.mfaEnabled },
      memberships: memberships.map((m) => ({
        tenantId: m.tenantId,
        tenantName: m.tenant.displayName,
        roleKey: m.role.key,
      })),
    };
  }

  // -- Sessions ---------------------------------------------------------------

  @Get('sessions')
  async listSessions(@CurrentUser() user: User) {
    const sessions = await this.prisma.client.session.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        deviceId: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        expiresAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return { sessions };
  }

  @Post('logout')
  async logout(@Req() req: Request & { sessionId?: string }, @Res() res: Response) {
    if (req.sessionId) {
      await this.tokens.revokeSession(req.sessionId);
    }
    res.clearCookie(SESSION_COOKIE_NAME);
    return res.json({ loggedOut: true });
  }

  @Post('sessions/revoke-all')
  async revokeAllOtherSessions(
    @CurrentUser() user: User,
    @Req() req: Request & { sessionId?: string },
  ) {
    await this.tokens.revokeAllSessionsForUser(user.id, req.sessionId);
    return { revoked: true };
  }
}
