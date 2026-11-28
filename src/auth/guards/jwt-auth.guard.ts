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
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  ACCOUNT_ACCESS_SELECT,
  accountBlockedException,
  getAccountBlock,
  type AccountBlock,
} from '../../users/account-access.js';
import { ALLOW_BLOCKED_ACCOUNT_KEY } from '../decorators/allow-blocked-account.decorator.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import type { AuthUserPayload } from '../decorators/current-user.decorator.js';

export const ACCESS_COOKIE_NAME = 'slimza_access_token';
export const REFRESH_COOKIE_NAME = 'slimza_refresh_token';

/**
 * Global guard (registered as APP_GUARD in app.module.ts).
 *
 * 1. Verifies the access token (Bearer header or cookie) and sets `request.user`.
 *    `@Public()` routes work without a token.
 * 2. Account status check (src/users/account-access.ts). A token whose user is
 *    suspended or archived:
 *      - protected route          → 403 ACCOUNT_SUSPENDED / ACCOUNT_ARCHIVED
 *      - public non-GET route     → 403 (no buying, paying or other actions)
 *      - public GET route         → allowed, but as a guest (`request.user` unset)
 *    `@AllowBlockedAccount()` routes (sign in / out / up) skip this check.
 *    Access tokens are stateless, so this database check is what makes a
 *    suspension take effect immediately, not when the token expires.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const allowBlocked = this.reflector.getAllAndOverride<boolean>(
      ALLOW_BLOCKED_ACCOUNT_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUserPayload }>();
    const token = this.extractToken(request);

    if (isPublic) {
      if (!token) return true;

      let payload: AuthUserPayload;
      try {
        payload = await this.verifyToken(token);
      } catch {
        // Ignore invalid/expired token on public routes
        return true;
      }

      if (!allowBlocked) {
        const block = await this.findAccountBlock(payload.sub);
        if (block) {
          // Browsing stays possible (as a guest); any action is refused.
          if (request.method === 'GET' || request.method === 'HEAD') return true;
          throw accountBlockedException(block);
        }
      }

      request.user = payload;
      return true;
    }

    if (!token) {
      throw new UnauthorizedException('Authentication required');
    }

    let payload: AuthUserPayload;
    try {
      payload = await this.verifyToken(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    if (!allowBlocked) {
      const block = await this.findAccountBlock(payload.sub);
      if (block) throw accountBlockedException(block);
    }

    request.user = payload;
    return true;
  }

  private verifyToken(token: string): Promise<AuthUserPayload> {
    const rawSecret =
      this.config.get<string>('JWT_ACCESS_SECRET') ||
      'dev-slimza-access-secret-change-in-production';
    const secret = rawSecret.trim().replace(/^["']|["']$/g, '');
    return this.jwtService.verifyAsync<AuthUserPayload>(token, { secret });
  }

  /** `null` = account may act. A deleted user is treated as unauthenticated. */
  private async findAccountBlock(userId: string): Promise<AccountBlock | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: ACCOUNT_ACCESS_SELECT,
    });
    if (!user) throw new UnauthorizedException('Account not found. Please sign in again.');
    return getAccountBlock(user);
  }

  private extractToken(request: Request): string | undefined {
    const authHeader = request.headers.authorization;
    if (authHeader) {
      const [type, token] = authHeader.split(' ');
      if (type?.toLowerCase() === 'bearer' && token) {
        return token;
      }
    }

    const cookieToken = request.cookies?.[ACCESS_COOKIE_NAME] as
      | string
      | undefined;
    if (cookieToken) return cookieToken;

    return undefined;
  }
}
