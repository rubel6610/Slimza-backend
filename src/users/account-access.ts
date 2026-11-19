/**
 * ============================================================================
 *  ACCOUNT ACCESS — who may use their account
 * ============================================================================
 *
 * A user account is in one of these states (admins change it from the
 * dashboard's Users page):
 *
 *   ACTIVE      normal account.
 *   SUSPENDED   `status = SUSPENDED`. Reversible (Activate).
 *   ARCHIVED    `archivedAt` set. Reversible (Restore), or deleted forever.
 *
 * A SUSPENDED or ARCHIVED account cannot do anything with the account:
 *   - sign in, or refresh an existing session    → 403 (AuthService)
 *   - call any authenticated endpoint            → 403 (JwtAuthGuard)
 *   - make any non-GET request while signed in   → 403 (JwtAuthGuard)
 *     (it may still browse public pages, as a guest)
 *   - buy or pay, even as a "guest" using the account's email → 403 (CheckoutService)
 *
 * Every 403 carries a machine-readable `code` (`ACCOUNT_SUSPENDED` or
 * `ACCOUNT_ARCHIVED`). The frontend uses it to sign the user out and explain why.
 *
 * Suspending or archiving also revokes every refresh token, so other devices
 * are signed out as soon as their access token expires. Meanwhile the guard
 * blocks them on every request.
 *
 * Admin accounts can't be suspended or archived (so the shop can't be locked out),
 * and an admin can't act on their own account.
 */
import { ForbiddenException } from '@nestjs/common';
import { UserStatus } from '../generated/prisma/enums.js';

export const ACCOUNT_SUSPENDED = 'ACCOUNT_SUSPENDED';
export const ACCOUNT_ARCHIVED = 'ACCOUNT_ARCHIVED';
export type AccountBlockCode = typeof ACCOUNT_SUSPENDED | typeof ACCOUNT_ARCHIVED;

export interface AccountAccessFields {
  status: UserStatus;
  archivedAt: Date | null;
  suspensionReason?: string | null;
}

/** The minimal `select` needed for `getAccountBlock`. */
export const ACCOUNT_ACCESS_SELECT = {
  status: true,
  archivedAt: true,
  suspensionReason: true,
} as const;

export interface AccountBlock {
  code: AccountBlockCode;
  message: string;
}

const SUPPORT = 'Please contact support at info@slimza.com.';

/** Returns why this account is blocked, or `null` if it may be used. */
export function getAccountBlock(user: AccountAccessFields): AccountBlock | null {
  if (user.archivedAt) {
    return {
      code: ACCOUNT_ARCHIVED,
      message: `This account is no longer active. ${SUPPORT}`,
    };
  }
  if (user.status === UserStatus.SUSPENDED) {
    const reason = user.suspensionReason?.trim();
    return {
      code: ACCOUNT_SUSPENDED,
      message: `Your account has been suspended${reason ? `: ${reason}` : ''}. ${SUPPORT}`,
    };
  }
  return null;
}

/** 403 with `{ message, code }` — the shape the frontend checks for. */
export function accountBlockedException(block: AccountBlock): ForbiddenException {
  return new ForbiddenException({ message: block.message, code: block.code });
}

/** Throws 403 if the account is suspended or archived. */
export function assertAccountUsable(user: AccountAccessFields): void {
  const block = getAccountBlock(user);
  if (block) throw accountBlockedException(block);
}
