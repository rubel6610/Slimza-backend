import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import type { AuthUserPayload } from '../decorators/current-user.decorator.js';

export const ACCESS_COOKIE_NAME = 'slimza_access_token';
export const REFRESH_COOKIE_NAME = 'slimza_refresh_token';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUserPayload }>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Authentication required');
    }

    try {
      const rawSecret =
        this.config.get<string>('JWT_ACCESS_SECRET') ||
        'dev-slimza-access-secret-change-in-production';
      const secret = rawSecret.trim().replace(/^["']|["']$/g, '');
      const payload = await this.jwtService.verifyAsync<AuthUserPayload>(token, {
        secret,
      });
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }

  private extractToken(request: Request): string | undefined {
    const cookieToken = request.cookies?.[ACCESS_COOKIE_NAME] as
      | string
      | undefined;
    if (cookieToken) return cookieToken;

    const authHeader = request.headers.authorization;
    if (!authHeader) return undefined;
    const [type, token] = authHeader.split(' ');
    return type?.toLowerCase() === 'bearer' && token ? token : undefined;
  }
}
