import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { UserRole } from '../../generated/prisma/enums.js';

export interface AuthUserPayload {
  sub: string;
  email: string;
  role: UserRole;
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthUserPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthUserPayload }>();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
