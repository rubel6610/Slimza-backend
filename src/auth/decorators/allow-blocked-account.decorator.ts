import { SetMetadata } from '@nestjs/common';

export const ALLOW_BLOCKED_ACCOUNT_KEY = 'allowBlockedAccount';

/**
 * Lets a request through even when its token belongs to a suspended or
 * archived account (see src/users/account-access.ts).
 *
 * Only for the sign-in / sign-out / sign-up endpoints: a blocked user must
 * still be able to log out, or log in with a different account. Those
 * endpoints check the account status themselves where it matters.
 */
export const AllowBlockedAccount = () => SetMetadata(ALLOW_BLOCKED_ACCOUNT_KEY, true);
