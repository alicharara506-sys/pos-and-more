import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../crypto/encryption.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

export const SESSION_COOKIE_NAME = 'sm_session';

/**
 * Validates the opaque session token (cookie for web, Bearer header for
 * mobile/API clients) against the Session table. Sessions are revocable
 * (remote sign-out) unlike stateless JWTs, satisfying the spec's
 * session/device management requirement.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const rawToken: string | undefined =
      request.cookies?.[SESSION_COOKIE_NAME] ?? extractBearerToken(request.headers.authorization);

    if (!rawToken) {
      throw new UnauthorizedException('Missing session credentials');
    }

    const tokenHash = EncryptionService.sha256Hex(rawToken);
    const session = await this.prisma.client.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expired or revoked');
    }

    request.user = session.user;
    request.sessionId = session.id;
    return true;
  }
}

function extractBearerToken(header?: string): string | undefined {
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length);
}
