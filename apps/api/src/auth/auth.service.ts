import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { loadEnv } from '@salesmaster/config';
import { IdentityProvider, type User } from '@salesmaster/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { MfaService } from './mfa.service';
import { EncryptionService } from '../common/crypto/encryption.service';
import { EMAIL_ADAPTER, type EmailAdapter } from '../notifications/email/email-adapter.interface';
import type { VerifiedGoogleIdentity } from './strategies/google-oauth.service';
import type { VerifiedAppleIdentity } from './strategies/apple-oauth.service';

export interface IssuedSession {
  rawToken: string;
  sessionId: string;
  expiresAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly mfa: MfaService,
    private readonly encryption: EncryptionService,
    private readonly audit: AuditService,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
  ) {}

  // ---------------------------------------------------------------------
  // Email + password
  // ---------------------------------------------------------------------

  async register(input: { email: string; password: string; name: string }): Promise<User> {
    const existing = await this.prisma.client.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new BadRequestException('An account with this email already exists');
    }

    const passwordHash = await this.passwords.hash(input.password);
    const user = await this.prisma.client.user.create({
      data: { email: input.email, passwordHash, name: input.name },
    });

    await this.sendEmailVerification(user);
    await this.audit.record({
      tenantId: null,
      actorUserId: user.id,
      action: 'auth.register',
      entityType: 'User',
      entityId: user.id,
    });

    return user;
  }

  async sendEmailVerification(user: User): Promise<void> {
    const token = await this.tokens.signOneTimeToken(
      'email_verification',
      { userId: user.id },
      24 * 60,
    );
    const env = loadEnv();
    const verifyUrl = `${env.APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
    await this.email.send({
      to: user.email,
      subject: 'Verify your SalesMaster Pro email',
      text: `Verify your email: ${verifyUrl}`,
    });
  }

  async verifyEmail(token: string): Promise<void> {
    const { userId } = await this.tokens.verifyOneTimeToken<{ userId: string }>(
      'email_verification',
      token,
    );
    await this.prisma.client.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });
  }

  async loginWithPassword(input: {
    email: string;
    password: string;
  }): Promise<
    { status: 'mfa_required'; mfaChallengeToken: string } | { status: 'ok'; user: User }
  > {
    const user = await this.prisma.client.user.findUnique({ where: { email: input.email } });
    if (!user?.passwordHash || !(await this.passwords.verify(user.passwordHash, input.password))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.mfaEnabled) {
      const mfaChallengeToken = await this.tokens.signOneTimeToken(
        'mfa_challenge',
        { userId: user.id },
        10,
      );
      return { status: 'mfa_required', mfaChallengeToken };
    }

    return { status: 'ok', user };
  }

  async completeMfaChallenge(mfaChallengeToken: string, code: string): Promise<User> {
    const { userId } = await this.tokens.verifyOneTimeToken<{ userId: string }>(
      'mfa_challenge',
      mfaChallengeToken,
    );

    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } });
    const validTotp =
      user.mfaSecretEncrypted &&
      this.mfa.verifyCode(this.encryption.decrypt(user.mfaSecretEncrypted), code);

    if (!validTotp) {
      if (!user.mfaRecoveryCodesEncrypted) throw new UnauthorizedException('Invalid MFA code');
      const stored = this.encryption.decrypt(user.mfaRecoveryCodesEncrypted);
      const { valid, remaining } = this.mfa.verifyRecoveryCode(stored, code);
      if (!valid) throw new UnauthorizedException('Invalid MFA code');
      await this.prisma.client.user.update({
        where: { id: user.id },
        data: { mfaRecoveryCodesEncrypted: this.encryption.encrypt(remaining) },
      });
    }

    return user;
  }

  // ---------------------------------------------------------------------
  // Magic link
  // ---------------------------------------------------------------------

  async requestMagicLink(email: string): Promise<void> {
    const env = loadEnv();
    const token = await this.tokens.signOneTimeToken(
      'magic_link',
      { email },
      env.AUTH_MAGIC_LINK_TTL_MINUTES,
    );
    const link = `${env.APP_URL}/auth/magic-link?token=${encodeURIComponent(token)}`;
    // Always attempt to send — never reveal via timing/response whether the address has an account.
    await this.email.send({
      to: email,
      subject: 'Your SalesMaster Pro sign-in link',
      text: `Sign in: ${link}\nThis link expires in ${env.AUTH_MAGIC_LINK_TTL_MINUTES} minutes.`,
    });
  }

  async consumeMagicLink(token: string): Promise<User> {
    const { email } = await this.tokens.verifyOneTimeToken<{ email: string }>('magic_link', token);

    let user = await this.prisma.client.user.findUnique({ where: { email } });
    if (!user) {
      user = await this.prisma.client.user.create({ data: { email, emailVerifiedAt: new Date() } });
    } else if (!user.emailVerifiedAt) {
      user = await this.prisma.client.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      });
    }
    return user;
  }

  // ---------------------------------------------------------------------
  // OAuth account linking — see docs/security.md §Account linking.
  // Durable key is always the provider `subject`, never the provider email.
  // ---------------------------------------------------------------------

  async linkOrCreateUserForGoogleIdentity(identity: VerifiedGoogleIdentity): Promise<User> {
    return this.linkOrCreateUserForIdentity(IdentityProvider.GOOGLE, {
      subject: identity.subject,
      email: identity.email,
      emailVerified: identity.emailVerified,
      name: identity.name,
      isPrivateRelayEmail: false,
      rawAccessToken: identity.rawAccessToken,
      rawRefreshToken: identity.rawRefreshToken,
      tokenExpiresAt: identity.tokenExpiresAt,
    });
  }

  async linkOrCreateUserForAppleIdentity(identity: VerifiedAppleIdentity): Promise<User> {
    return this.linkOrCreateUserForIdentity(IdentityProvider.APPLE, {
      subject: identity.subject,
      email: identity.email,
      emailVerified: identity.emailVerified,
      name: null,
      isPrivateRelayEmail: identity.isPrivateRelayEmail,
      rawAccessToken: identity.rawAccessToken,
      rawRefreshToken: identity.rawRefreshToken,
      tokenExpiresAt: identity.tokenExpiresAt,
    });
  }

  private async linkOrCreateUserForIdentity(
    provider: IdentityProvider,
    identity: {
      subject: string;
      email: string | null;
      emailVerified: boolean;
      name: string | null;
      isPrivateRelayEmail: boolean;
      rawAccessToken?: string;
      rawRefreshToken?: string;
      tokenExpiresAt?: Date;
    },
  ): Promise<User> {
    const existingAccount = await this.prisma.client.identityProviderAccount.findUnique({
      where: { provider_providerSubject: { provider, providerSubject: identity.subject } },
      include: { user: true },
    });

    const tokenFields = {
      accessTokenEncrypted: identity.rawAccessToken
        ? this.encryption.encrypt(identity.rawAccessToken)
        : undefined,
      refreshTokenEncrypted: identity.rawRefreshToken
        ? this.encryption.encrypt(identity.rawRefreshToken)
        : undefined,
      tokenExpiresAt: identity.tokenExpiresAt,
    };

    if (existingAccount) {
      await this.prisma.client.identityProviderAccount.update({
        where: { id: existingAccount.id },
        data: { providerEmail: identity.email, ...tokenFields },
      });
      return existingAccount.user;
    }

    // Safe linking: only attach to an existing User if BOTH the provider and
    // our own record already consider the email verified. Two unverified
    // strings matching is never sufficient (spec §3.2).
    let user: User | null = null;
    if (identity.email && identity.emailVerified) {
      const candidate = await this.prisma.client.user.findUnique({
        where: { email: identity.email },
      });
      if (candidate?.emailVerifiedAt) {
        user = candidate;
      }
    }

    if (!user) {
      user = await this.prisma.client.user.create({
        data: {
          email:
            identity.email ??
            `${provider.toLowerCase()}-${identity.subject}@no-email.salesmasterpro.invalid`,
          name: identity.name,
          emailVerifiedAt: identity.emailVerified ? new Date() : null,
        },
      });
    }

    await this.prisma.client.identityProviderAccount.create({
      data: {
        userId: user.id,
        provider,
        providerSubject: identity.subject,
        providerEmail: identity.email,
        isPrivateRelayEmail: identity.isPrivateRelayEmail,
        ...tokenFields,
      },
    });

    await this.audit.record({
      tenantId: null,
      actorUserId: user.id,
      action: `auth.oauth_link.${provider.toLowerCase()}`,
      entityType: 'User',
      entityId: user.id,
    });

    return user;
  }

  // ---------------------------------------------------------------------
  // Password reset
  // ---------------------------------------------------------------------

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.client.user.findUnique({ where: { email } });
    if (!user) return; // do not reveal existence
    const token = await this.tokens.signOneTimeToken('password_reset', { userId: user.id }, 30);
    const env = loadEnv();
    const resetUrl = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
    await this.email.send({
      to: email,
      subject: 'Reset your SalesMaster Pro password',
      text: resetUrl,
    });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const { userId } = await this.tokens.verifyOneTimeToken<{ userId: string }>(
      'password_reset',
      token,
    );
    const passwordHash = await this.passwords.hash(newPassword);
    await this.prisma.client.user.update({ where: { id: userId }, data: { passwordHash } });
    // Privilege-relevant change: rotate every session (spec §3.2).
    await this.tokens.revokeAllSessionsForUser(userId);
  }

  // ---------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------

  async issueSession(
    user: User,
    meta: { deviceId?: string; ipAddress?: string; userAgent?: string },
  ): Promise<IssuedSession> {
    const env = loadEnv();
    return this.tokens.createSession({
      userId: user.id,
      deviceId: meta.deviceId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      ttlMinutes: env.AUTH_SESSION_TTL_MINUTES,
    });
  }
}
