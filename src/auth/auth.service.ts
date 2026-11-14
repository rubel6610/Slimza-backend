import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OtpPurpose, type Address, type User } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  RegisterInput,
  ResendCodeInput,
  ResetPasswordInput,
  SignInInput,
  VerifyCodeInput,
} from './auth.schemas.js';
import {
  generateOpaqueToken,
  generateOtpCode,
  hashPassword,
  hashToken,
  verifyPassword,
} from './crypto.util.js';
import type { AuthUserPayload } from './decorators/current-user.decorator.js';

const OTP_TTL_MS = 10 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

export interface SessionMeta {
  userAgent?: string;
  ipAddress?: string;
}

export type SafeUser = ReturnType<typeof serializeUser>;

export function splitFullName(fullName: string): {
  firstName: string;
  lastName: string;
} {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

export function serializeUser(user: User & { addresses?: Address[] }) {
  return {
    id: user.id,
    name: user.name,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    birthday: user.birthday,
    avatarUrl: user.avatarUrl,
    role: user.role,
    isEmailVerified: user.isEmailVerified,
    deletionRequestedAt: user.deletionRequestedAt,
    createdAt: user.createdAt,
    addresses: (user.addresses ?? []).map((a) => ({
      id: a.id,
      label: a.label,
      name: a.name,
      line1: a.line1,
      line2: a.line2 ?? '',
      city: a.city,
      postcode: a.postcode,
      country: a.country,
      phone: a.phone,
      isDefault: a.isDefault,
    })),
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly mailService: MailService,
  ) {}

  async register(input: RegisterInput) {
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
    });

    if (existing && existing.isEmailVerified) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await hashPassword(input.password);
    const { firstName, lastName } = splitFullName(input.name);

    const user = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            name: input.name,
            firstName,
            lastName,
            passwordHash,
          },
        })
      : await this.prisma.user.create({
          data: {
            name: input.name,
            firstName,
            lastName,
            email: input.email,
            passwordHash,
          },
        });

    await this.issueAndSendOtp(user.id, user.email, user.name, OtpPurpose.SIGNUP);
    this.logger.log(`Registered user ${user.email} (verification OTP issued)`);

    return {
      ok: true as const,
      email: user.email,
      message: 'Verification code sent to your email',
    };
  }

  async verifyCode(input: VerifyCodeInput) {
    const purpose =
      input.purpose === 'reset' ? OtpPurpose.RESET : OtpPurpose.SIGNUP;

    const otp = await this.prisma.otpCode.findFirst({
      where: {
        email: input.email,
        purpose,
        consumedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      throw new BadRequestException(
        'No active verification code found. Please request a new one.',
      );
    }

    if (otp.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'This verification code has expired. Please request a new one.',
      );
    }

    if (otp.attempts >= MAX_OTP_ATTEMPTS) {
      throw new BadRequestException(
        'Too many incorrect attempts. Please request a new verification code.',
      );
    }

    if (hashToken(input.code) !== otp.codeHash) {
      await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Invalid verification code');
    }

    if (purpose === OtpPurpose.SIGNUP) {
      await this.prisma.$transaction([
        this.prisma.otpCode.update({
          where: { id: otp.id },
          data: { consumedAt: new Date(), verifiedAt: new Date() },
        }),
        this.prisma.user.update({
          where: { id: otp.userId },
          data: { isEmailVerified: true, emailVerifiedAt: new Date() },
        }),
      ]);

      return {
        ok: true as const,
        message: 'Email verified successfully',
      };
    }

    const resetToken = generateOpaqueToken();
    await this.prisma.otpCode.update({
      where: { id: otp.id },
      data: {
        verifiedAt: new Date(),
        resetTokenHash: hashToken(resetToken),
        resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    return {
      ok: true as const,
      resetToken,
      message: 'Verification code confirmed',
    };
  }

  async resendCode(input: ResendCodeInput) {
    const purpose =
      input.purpose === 'reset' ? OtpPurpose.RESET : OtpPurpose.SIGNUP;

    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
    });

    if (!user) {
      if (purpose === OtpPurpose.RESET) {
        return {
          ok: true as const,
          message: 'If an account exists for that email, a new code has been sent.',
        };
      }
      throw new NotFoundException('No account found with this email');
    }

    if (purpose === OtpPurpose.SIGNUP && user.isEmailVerified) {
      throw new BadRequestException('This email is already verified');
    }

    await this.issueAndSendOtp(user.id, user.email, user.name, purpose);

    return {
      ok: true as const,
      message: 'We have sent you a new verification code.',
    };
  }

  async forgotPassword(input: ForgotPasswordInput) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
    });

    if (user) {
      await this.issueAndSendOtp(user.id, user.email, user.name, OtpPurpose.RESET);
    }

    return {
      ok: true as const,
      message: 'If an account exists for that email, a verification code has been sent.',
    };
  }

  async resetPassword(input: ResetPasswordInput) {
    const otp = await this.prisma.otpCode.findFirst({
      where: {
        email: input.email,
        purpose: OtpPurpose.RESET,
        consumedAt: null,
        verifiedAt: { not: null },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (
      !otp ||
      !otp.resetTokenHash ||
      !otp.resetTokenExpiresAt ||
      otp.resetTokenExpiresAt.getTime() <= Date.now() ||
      hashToken(input.resetToken) !== otp.resetTokenHash
    ) {
      throw new BadRequestException(
        'Password reset session is invalid or expired. Please request a new code.',
      );
    }

    const passwordHash = await hashPassword(input.password);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: otp.userId },
        data: { passwordHash },
      }),
      this.prisma.otpCode.update({
        where: { id: otp.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: otp.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return {
      ok: true as const,
      message: 'Password updated successfully',
    };
  }

  async changePassword(userId: string, input: ChangePasswordInput) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const matches = await verifyPassword(input.currentPassword, user.passwordHash);
    if (!matches) {
      throw new BadRequestException('Current password is incorrect');
    }

    const passwordHash = await hashPassword(input.newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return {
      ok: true as const,
      message: 'Password updated successfully',
    };
  }

  async signIn(input: SignInInput, meta: SessionMeta) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] } },
    });

    if (!user) {
      this.logger.warn(`Failed sign-in attempt (unknown email): ${input.email}`);
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordValid = await verifyPassword(input.password, user.passwordHash);
    if (!passwordValid) {
      this.logger.warn(`Failed sign-in attempt (bad password): ${input.email}`);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isEmailVerified) {
      this.logger.warn(`Blocked sign-in for unverified email: ${input.email}`);
      throw new ForbiddenException({
        message: 'Please verify your email before signing in.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    const rememberMe = input.remember ?? true;
    const tokens = await this.issueSessionTokens(user, rememberMe, meta);
    this.logger.log(`User signed in: ${user.email} (remember=${rememberMe})`);

    return {
      ok: true as const,
      user: serializeUser(user),
      ...tokens,
      rememberMe,
    };
  }

  async refresh(rawRefreshToken: string | undefined, meta: SessionMeta) {
    if (!rawRefreshToken) {
      throw new UnauthorizedException('Refresh token is missing');
    }

    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawRefreshToken) },
      include: {
        user: {
          include: {
            addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
          },
        },
      },
    });

    if (
      !existing ||
      existing.revokedAt ||
      existing.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });

    const tokens = await this.issueSessionTokens(
      existing.user,
      existing.rememberMe,
      meta,
    );

    return {
      ok: true as const,
      user: serializeUser(existing.user),
      ...tokens,
      rememberMe: existing.rememberMe,
    };
  }

  async logout(rawRefreshToken?: string) {
    if (rawRefreshToken) {
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash: hashToken(rawRefreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    return { ok: true as const };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
      },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      ok: true as const,
      user: serializeUser(user),
    };
  }

  private async issueAndSendOtp(
    userId: string,
    email: string,
    name: string,
    purpose: OtpPurpose,
  ) {
    const code = generateOtpCode();

    await this.prisma.$transaction([
      this.prisma.otpCode.updateMany({
        where: { userId, purpose, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.otpCode.create({
        data: {
          userId,
          email,
          purpose,
          codeHash: hashToken(code),
          expiresAt: new Date(Date.now() + OTP_TTL_MS),
        },
      }),
    ]);

    await this.mailService.sendOtpEmail({
      to: email,
      name,
      code,
      purpose: purpose === OtpPurpose.RESET ? 'reset' : 'signup',
    });
  }

  private async issueSessionTokens(
    user: User,
    rememberMe: boolean,
    meta: SessionMeta,
  ) {
    const payload: AuthUserPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const rawSecret =
      this.config.get<string>('JWT_ACCESS_SECRET') ||
      'dev-slimza-access-secret-change-in-production';
    const accessSecret = rawSecret.trim().replace(/^["']|["']$/g, '');

    const rawExpiresIn =
      this.config.get<string>('JWT_ACCESS_EXPIRES_IN') || '15m';
    const accessExpiresIn = rawExpiresIn.trim().replace(/^["']|["']$/g, '');

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: accessSecret,
      expiresIn: accessExpiresIn as `${number}${'s' | 'm' | 'h' | 'd'}`,
    });

    const longDays = Number(
      this.config.get<string>('JWT_REFRESH_EXPIRES_DAYS') ?? 30,
    );
    const shortDays = Number(
      this.config.get<string>('JWT_SHORT_REFRESH_EXPIRES_DAYS') ?? 1,
    );
    const ttlDays = rememberMe ? longDays : shortDays;
    const refreshExpiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

    const refreshToken = generateOpaqueToken();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        rememberMe,
        expiresAt: refreshExpiresAt,
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      },
    });

    return { accessToken, refreshToken };
  }
}
