import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly fromAddress: string;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST')?.trim();
    const user = this.config.get<string>('SMTP_USER')?.trim();
    const pass = this.config.get<string>('SMTP_PASS')?.trim();
    const rawPort = this.config.get<string>('SMTP_PORT')?.trim();
    const secure = this.config.get<string>('SMTP_SECURE') === 'true';

    // Port is optional: defaults to 25 for shared hosting (or 465 if SMTP_SECURE is true)
    const port = rawPort ? Number.parseInt(rawPort, 10) : (secure ? 465 : 25);

    this.fromAddress =
      this.config.get<string>('SMTP_FROM')?.trim() ||
      'Slimza <no-reply@slimza.com>';

    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        ...(user && pass ? { auth: { user, pass } } : {}),
        tls: {
          rejectUnauthorized: false,
        },
      } as any);

      this.logger.log(
        `SMTP configured: host=${host}, port=${port}, secure=${secure}, auth=${Boolean(user && pass)}`,
      );
    } else {
      this.transporter = null;
      this.logger.warn(
        'SMTP_HOST is not configured; OTP codes will be logged to the console.',
      );
    }
  }

  async sendOtpEmail(params: {
    to: string;
    name?: string;
    code: string;
    purpose: 'signup' | 'reset';
  }): Promise<void> {
    const isReset = params.purpose === 'reset';
    const subject = isReset
      ? 'Slimza — Your Password Reset Code'
      : 'Slimza — Verify Your Email Address';
    const heading = isReset ? 'Reset your password' : 'Verify your email';
    const intro = isReset
      ? 'Use the 6-digit verification code below to reset your Slimza password.'
      : 'Welcome to Slimza! Enter the 6-digit verification code below to activate your account.';
    const greeting = params.name ? `Hi ${params.name},` : 'Hi there,';

    const text = `${greeting}\n\n${intro}\n\nYour code: ${params.code}\n\nThis code expires in 10 minutes. If you did not request this, you can safely ignore this email.`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; color: #182513;">
        <h2 style="color: #1C3D2B; margin-bottom: 12px;">${heading}</h2>
        <p>${greeting}</p>
        <p>${intro}</p>
        <div style="margin: 24px 0; padding: 16px; background: #F4F8EF; border: 1px solid #335246; border-radius: 12px; text-align: center;">
          <span style="font-size: 28px; font-weight: 700; letter-spacing: 6px; color: #1C3D2B;">${params.code}</span>
        </div>
        <p style="font-size: 13px; color: #4B5563;">This code expires in 10 minutes. If you did not request this, you can safely ignore this email.</p>
      </div>
    `;

    if (!this.transporter) {
      this.logger.log(
        `[DEV OTP] Purpose=${params.purpose} To=${params.to} Code=${params.code}`,
      );
      return;
    }

    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to: params.to,
        subject,
        text,
        html,
      });
      this.logger.log(`Sent ${params.purpose} OTP email to ${params.to}`);
    } catch (err: any) {
      this.logger.error(
        `Failed to send email via SMTP to ${params.to}: ${err.code || err.message}`,
      );
      this.logger.warn(
        `[FALLBACK OTP CODE] Purpose=${params.purpose} To=${params.to} Code=${params.code} (SMTP failed: ${err.message})`,
      );
    }
  }
}
