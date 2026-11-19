import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  refreshTokenSchema,
  registerSchema,
  resendCodeSchema,
  resetPasswordSchema,
  signInSchema,
  verifyCodeSchema,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type RefreshTokenInput,
  type RegisterInput,
  type ResendCodeInput,
  type ResetPasswordInput,
  type SignInInput,
  type VerifyCodeInput,
} from './auth.schemas.js';
import { AuthService } from './auth.service.js';
import {
  CurrentUser,
  type AuthUserPayload,
} from './decorators/current-user.decorator.js';
import { AllowBlockedAccount } from './decorators/allow-blocked-account.decorator.js';
import { Public } from './decorators/public.decorator.js';
import {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
} from './guards/jwt-auth.guard.js';

const ACCESS_COOKIE_MAX_AGE_MS = 15 * 60 * 1000;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @AllowBlockedAccount()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body({ schema: registerSchema }) body: RegisterInput) {
    return this.authService.register(body);
  }

  @Public()
  @AllowBlockedAccount()
  @Post('verify-code')
  @HttpCode(HttpStatus.OK)
  verifyCode(@Body({ schema: verifyCodeSchema }) body: VerifyCodeInput) {
    return this.authService.verifyCode(body);
  }

  @Public()
  @AllowBlockedAccount()
  @Post('resend-code')
  @HttpCode(HttpStatus.OK)
  resendCode(@Body({ schema: resendCodeSchema }) body: ResendCodeInput) {
    return this.authService.resendCode(body);
  }

  @Public()
  @AllowBlockedAccount()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async signIn(
    @Body({ schema: signInSchema }) body: SignInInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.signIn(body, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    this.setAuthCookies(
      res,
      result.accessToken,
      result.refreshToken,
      result.rememberMe,
    );

    return {
      ok: result.ok,
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
  }

  @Public()
  @AllowBlockedAccount()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(
    @Body({ schema: forgotPasswordSchema }) body: ForgotPasswordInput,
  ) {
    return this.authService.forgotPassword(body);
  }

  @Public()
  @AllowBlockedAccount()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(
    @Body({ schema: resetPasswordSchema }) body: ResetPasswordInput,
  ) {
    return this.authService.resetPassword(body);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  changePassword(
    @CurrentUser() user: AuthUserPayload,
    @Body({ schema: changePasswordSchema }) body: ChangePasswordInput,
  ) {
    return this.authService.changePassword(user.sub, body);
  }

  @Public()
  @AllowBlockedAccount()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body({ schema: refreshTokenSchema }) body: RefreshTokenInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookieToken = req.cookies?.[REFRESH_COOKIE_NAME] as
      | string
      | undefined;
    const result = await this.authService.refresh(
      body?.refreshToken || cookieToken,
      {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
      },
    );

    this.setAuthCookies(
      res,
      result.accessToken,
      result.refreshToken,
      result.rememberMe,
    );

    return {
      ok: result.ok,
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
  }

  @Public()
  @AllowBlockedAccount()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  @Header('Pragma', 'no-cache')
  @Header('Expires', '0')
  async logout(
    @Body({ schema: refreshTokenSchema }) body: RefreshTokenInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookieToken = req.cookies?.[REFRESH_COOKIE_NAME] as
      | string
      | undefined;
    const tokenToRevoke = body?.refreshToken || cookieToken;
    const result = await this.authService.logout(tokenToRevoke);
    this.clearAuthCookies(res);
    return result;
  }

  @Get('me')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  @Header('Pragma', 'no-cache')
  @Header('Expires', '0')
  getMe(@CurrentUser() user: AuthUserPayload) {
    return this.authService.getMe(user.sub);
  }

  private getBaseCookieOptions(): CookieOptions {
    const secure = this.config.get<string>('COOKIE_SECURE') === 'true';
    const sameSiteRaw = (
      this.config.get<string>('COOKIE_SAME_SITE') || 'lax'
    ).toLowerCase();
    const sameSite: CookieOptions['sameSite'] =
      sameSiteRaw === 'none' || sameSiteRaw === 'strict'
        ? sameSiteRaw
        : 'lax';

    return {
      httpOnly: true,
      secure,
      sameSite,
      path: '/',
    };
  }

  private setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
    rememberMe: boolean,
  ) {
    const base = this.getBaseCookieOptions();
    res.cookie(ACCESS_COOKIE_NAME, accessToken, {
      ...base,
      maxAge: ACCESS_COOKIE_MAX_AGE_MS,
    });

    const longDays = Number(
      this.config.get<string>('JWT_REFRESH_EXPIRES_DAYS') ?? 30,
    );
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
      ...base,
      ...(rememberMe ? { maxAge: longDays * 24 * 60 * 60 * 1000 } : {}),
    });
  }

  private clearAuthCookies(res: Response) {
    const base = this.getBaseCookieOptions();
    const expireOptions = {
      ...base,
      maxAge: 0,
      expires: new Date(0),
    };
    res.clearCookie(ACCESS_COOKIE_NAME, expireOptions);
    res.clearCookie(REFRESH_COOKIE_NAME, expireOptions);
  }
}
