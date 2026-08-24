import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EmailModule } from '../notifications/email/email.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { MfaService } from './mfa.service';
import { GoogleOAuthService } from './strategies/google-oauth.service';
import { AppleOAuthService } from './strategies/apple-oauth.service';
import { OAuthHandshakeService } from './oauth-handshake.service';

@Module({
  imports: [AuditModule, EmailModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    MfaService,
    GoogleOAuthService,
    AppleOAuthService,
    OAuthHandshakeService,
  ],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
