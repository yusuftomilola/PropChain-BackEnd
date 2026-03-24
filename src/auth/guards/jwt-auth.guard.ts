import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from '../auth.service';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly authService: AuthService) {
    super();
  }

  override async canActivate(context: any): Promise<boolean> {
    const result = (await super.canActivate(context)) as boolean;

    if (result) {
      const request = context.switchToHttp().getRequest();
      const user = request.user;

      // Check if token is blacklisted
      if (user && user.jti) {
        const isBlacklisted = await this.authService.isTokenBlacklisted(user.jti);
        if (isBlacklisted) {
          throw new UnauthorizedException('Token has been revoked');
        }
      }

      if (user?.id && user?.jti && user?.sid) {
        request.session = await this.authService.validateActiveSession(user.id, user.jti, user.sid, {
          ip: request.ip || request.socket?.remoteAddress || 'unknown',
          userAgent: request.headers['user-agent'] || 'unknown',
        });
      } else {
        throw new UnauthorizedException('Invalid session context');
      }
    }

    return result;
  }
}
