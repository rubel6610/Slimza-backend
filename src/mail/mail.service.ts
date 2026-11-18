import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

export interface OrderEmailItem {
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  sizeLabel?: string | null;
  planLabel?: string | null;
}

export interface OrderEmailPayload {
  id: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  status: string;
  paymentStatus: string;
  subtotal: number;
  discount: number;
  bundleReward?: number;
  promoCode?: string | null;
  shippingFee: number;
  shippingMethod?: string;
  total: number;
  shippingAddress: {
    name?: string;
    line1?: string;
    line2?: string;
    city?: string;
    postcode?: string;
    country?: string;
    phone?: string;
    deliveryNotes?: string;
  };
  items: OrderEmailItem[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatHumanOrderStatus(status: string): string {
  const upper = status.toUpperCase();
  if (upper === 'PENDING') return 'Pending';
  if (upper === 'PROCESSING') return 'Processing';
  if (upper === 'SHIPPED') return 'Shipped';
  if (upper === 'DELIVERED') return 'Delivered';
  if (upper === 'CANCELLED') return 'Cancelled';
  return status;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly fromAddress: string;
  private readonly adminNotificationEmail: string;
  private readonly storeUrl: string;

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

    this.adminNotificationEmail =
      this.config.get<string>('ORDER_NOTIFICATION_EMAIL')?.trim() ||
      this.config.get<string>('ADMIN_EMAIL')?.trim() ||
      user ||
      'admin@slimza.com';

    const rawStoreUrl =
      this.config.get<string>('FRONTEND_URL')?.trim() ||
      this.config.get<string>('CORS_ORIGIN')?.trim() ||
      'https://www.slimza.com';
    this.storeUrl = rawStoreUrl.replace(/\/+$/, '');

    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 10000,
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

  private buildOrderConfirmationHtml(
    order: OrderEmailPayload,
    recipientType: 'admin' | 'customer',
  ): string {
    const statusLabel = formatHumanOrderStatus(order.status);
    const safeName = escapeHtml(order.customerName || 'Customer');
    const safeOrderNumber = escapeHtml(order.orderNumber);
    const logoUrl = `${this.storeUrl}/logo.png`;
    const trackUrl =
      recipientType === 'admin'
        ? `${this.storeUrl}/dashboard/orders/${encodeURIComponent(order.id)}`
        : `${this.storeUrl}/account/orders`;
    const shopUrl = `${this.storeUrl}/shop`;
    const trackButtonLabel =
      recipientType === 'admin' ? 'View Order Details' : 'Track Your Order';

    const introParagraph =
      recipientType === 'admin'
        ? `A new order has been placed on Slimza by <strong>${safeName}</strong> (${escapeHtml(order.customerEmail)}${order.customerPhone ? ` &middot; ${escapeHtml(order.customerPhone)}` : ''}). Below are the complete order details.`
        : `Thank you for shopping with Slimza. Your order has been successfully received and is currently awaiting processing.`;

    const itemsHtml = order.items
      .map((item, idx) => {
        const metaParts = [item.sizeLabel, item.planLabel]
          .filter((v): v is string => Boolean(v && v.trim()))
          .map(escapeHtml);
        const dividerStyle =
          idx > 0
            ? 'border-top: 1px solid #E5E7EB; padding-top: 16px; margin-top: 16px;'
            : '';

        return `
          <div style="${dividerStyle}">
            <div style="font-size: 20px; font-weight: 700; color: #111827; margin: 0 0 12px 0;">
              ${escapeHtml(item.productName)}
            </div>
            ${
              metaParts.length > 0
                ? `<div style="font-size: 13px; color: #6B7280; margin: 0 0 10px 0;">${metaParts.join(' &middot; ')}</div>`
                : ''
            }
            <div style="font-size: 14px; color: #4B5563; line-height: 1.9;">
              <div><strong style="color: #374151;">Order ID:</strong> #${safeOrderNumber}</div>
              <div><strong style="color: #374151;">Price:</strong> &pound; ${item.totalPrice.toFixed(2)}</div>
              <div><strong style="color: #374151;">Quantity:</strong> ${item.quantity}</div>
              <div><strong style="color: #374151;">Status:</strong> ${escapeHtml(statusLabel)}</div>
            </div>
          </div>
        `;
      })
      .join('');

    const showTotalsSummary =
      order.items.length > 1 ||
      order.discount > 0 ||
      (order.bundleReward ?? 0) > 0 ||
      order.shippingFee > 0;

    const totalsHtml = showTotalsSummary
      ? `
        <div style="border-top: 1px solid #E5E7EB; margin-top: 18px; padding-top: 14px; font-size: 14px; color: #4B5563; line-height: 1.8;">
          <div><strong style="color: #374151;">Subtotal:</strong> &pound; ${order.subtotal.toFixed(2)}</div>
          ${
            order.discount > 0
              ? `<div style="color: #065F46;"><strong>Discount${order.promoCode ? ` (${escapeHtml(order.promoCode)})` : ''}:</strong> -&pound; ${order.discount.toFixed(2)}</div>`
              : ''
          }
          ${
            (order.bundleReward ?? 0) > 0
              ? `<div style="color: #065F46;"><strong>Bundle Reward:</strong> -&pound; ${(order.bundleReward ?? 0).toFixed(2)}</div>`
              : ''
          }
          <div><strong style="color: #374151;">Shipping:</strong> ${order.shippingFee === 0 ? 'Free' : `&pound; ${order.shippingFee.toFixed(2)}`}</div>
          <div style="font-size: 16px; color: #111827; margin-top: 6px;"><strong>Total: &pound; ${order.total.toFixed(2)}</strong></div>
        </div>
      `
      : '';

    const addr = order.shippingAddress || {};
    const addressLines = [
      addr.name && addr.name !== order.customerName ? addr.name : null,
      addr.line1,
      addr.line2,
      [addr.city, addr.postcode].filter(Boolean).join(', '),
      addr.country,
      addr.phone || order.customerPhone
        ? `Phone: ${addr.phone || order.customerPhone}`
        : null,
      recipientType === 'admin' ? `Email: ${order.customerEmail}` : null,
      addr.deliveryNotes ? `Notes: ${addr.deliveryNotes}` : null,
    ]
      .filter((line): line is string => Boolean(line && line.trim()))
      .map((line) => `<div>${escapeHtml(line)}</div>`)
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Order Confirmation #${safeOrderNumber}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #FFFFFF; font-family: Arial, Helvetica, sans-serif; color: #111827;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #FFFFFF;">
    <!-- Black Top Header Bar -->
    <tr>
      <td align="center" style="background-color: #000000; padding: 24px 16px;">
        <img
          src="${escapeHtml(logoUrl)}"
          alt="SLIMZA"
          height="42"
          style="display: block; max-height: 42px; width: auto; color: #FFFFFF; font-size: 20px; font-weight: 700; letter-spacing: 2px;"
        />
      </td>
    </tr>

    <!-- Main Content Container -->
    <tr>
      <td align="center" style="padding: 32px 20px 40px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 580px; text-align: left;">
          <tr>
            <td>
              <h1 style="margin: 0 0 18px 0; font-size: 28px; font-weight: 400; color: #111827; letter-spacing: -0.01em;">
                Order Confirmation
              </h1>

              <p style="margin: 0 0 14px 0; font-size: 15px; line-height: 1.6; color: #4B5563;">
                Hello <strong style="color: #374151;">${safeName}</strong>,
              </p>

              <p style="margin: 0 0 22px 0; font-size: 15px; line-height: 1.6; color: #4B5563;">
                ${introParagraph}
              </p>

              <!-- Order Status Banner -->
              <div style="background-color: #FEF7E0; border-left: 4px solid #D4A017; border-radius: 4px; padding: 14px 16px; margin-bottom: 22px; font-size: 14px; font-weight: 700; color: #8A6116;">
                Order Status: ${escapeHtml(statusLabel)}
              </div>

              <!-- Product / Order Details Card -->
              <div style="background-color: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 4px; padding: 22px 20px; margin-bottom: 28px;">
                ${itemsHtml}
                ${totalsHtml}
              </div>

              <!-- Shipping Information -->
              <h2 style="margin: 0 0 12px 0; font-size: 16px; font-weight: 700; color: #111827;">
                Shipping Information
              </h2>
              <div style="background-color: #FAFAFA; border: 1px solid #E5E7EB; border-radius: 10px; padding: 16px 20px; margin-bottom: 34px; font-size: 14px; line-height: 1.8; color: #4B5563;">
                ${addressLines || '<div>Standard UK Shipping</div>'}
              </div>

              <!-- Track Your Order CTA -->
              <div style="text-align: center; margin-bottom: 34px;">
                <a
                  href="${escapeHtml(trackUrl)}"
                  style="display: inline-block; background-color: #000000; color: #FFFFFF; font-size: 14px; font-weight: 700; text-decoration: none; padding: 14px 32px; border-radius: 8px;"
                >
                  ${trackButtonLabel}
                </a>
              </div>

              <!-- Continue Shopping Section -->
              <div style="text-align: center; margin-bottom: 12px;">
                <h3 style="margin: 0 0 10px 0; font-size: 17px; font-weight: 700; color: #111827;">
                  Continue Shopping
                </h3>
                <p style="margin: 0 0 22px 0; font-size: 14px; line-height: 1.6; color: #6B7280;">
                  Discover more premium products and exclusive collections from Slimza.
                </p>
                <a
                  href="${escapeHtml(shopUrl)}"
                  style="display: inline-block; background-color: #C4F000; color: #111827; font-size: 14px; font-weight: 700; text-decoration: none; padding: 13px 32px; border-radius: 8px;"
                >
                  Shop Now
                </a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Black Footer Bar -->
    <tr>
      <td align="center" style="background-color: #000000; padding: 28px 16px;">
        <img
          src="${escapeHtml(logoUrl)}"
          alt="SLIMZA"
          height="38"
          style="display: block; max-height: 38px; width: auto; margin: 0 auto 14px auto; color: #FFFFFF; font-size: 18px; font-weight: 700; letter-spacing: 2px;"
        />
        <p style="margin: 0 0 8px 0; font-size: 13px; color: #D1D5DB;">
          Thank you for choosing Slimza.
        </p>
        <a
          href="https://www.slimza.com"
          style="font-size: 13px; font-weight: 700; color: #C4F000; text-decoration: none;"
        >
          www.slimza.com
        </a>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private buildOrderConfirmationText(order: OrderEmailPayload): string {
    const statusLabel = formatHumanOrderStatus(order.status);
    const itemsText = order.items
      .map(
        (item) =>
          `- ${item.productName} | Qty: ${item.quantity} | Price: £${item.totalPrice.toFixed(2)}`,
      )
      .join('\n');
    const addr = order.shippingAddress || {};
    const addressText = [
      addr.line1,
      addr.line2,
      [addr.city, addr.postcode].filter(Boolean).join(', '),
      addr.country,
    ]
      .filter(Boolean)
      .join('\n');

    return [
      `Order Confirmation — #${order.orderNumber}`,
      `Hello ${order.customerName},`,
      `Order Status: ${statusLabel}`,
      '',
      'Items:',
      itemsText,
      '',
      `Subtotal: £${order.subtotal.toFixed(2)}`,
      order.discount > 0
        ? `Discount${order.promoCode ? ` (${order.promoCode})` : ''}: -£${order.discount.toFixed(2)}`
        : null,
      `Shipping: ${order.shippingFee === 0 ? 'Free' : `£${order.shippingFee.toFixed(2)}`}`,
      `Total: £${order.total.toFixed(2)}`,
      '',
      'Shipping Information:',
      addressText,
      '',
      'Thank you for choosing Slimza — www.slimza.com',
    ]
      .filter((line) => line !== null)
      .join('\n');
  }

  async sendOrderConfirmationEmails(order: OrderEmailPayload): Promise<void> {
    const recipients: Array<{
      to: string;
      subject: string;
      type: 'admin' | 'customer';
    }> = [];

    const adminEmail = this.adminNotificationEmail.trim().toLowerCase();
    const customerEmail = order.customerEmail.trim().toLowerCase();

    if (adminEmail) {
      recipients.push({
        to: adminEmail,
        subject: `New Order Confirmation — #${order.orderNumber} (£${order.total.toFixed(2)})`,
        type: 'admin',
      });
    }

    if (customerEmail && customerEmail !== adminEmail) {
      recipients.push({
        to: customerEmail,
        subject: `Order Confirmation — #${order.orderNumber} | Slimza`,
        type: 'customer',
      });
    }

    const text = this.buildOrderConfirmationText(order);

    for (const recipient of recipients) {
      const html = this.buildOrderConfirmationHtml(order, recipient.type);

      if (!this.transporter) {
        this.logger.log(
          `[DEV ORDER EMAIL] Type=${recipient.type} To=${recipient.to} Order=#${order.orderNumber} Total=£${order.total.toFixed(2)}`,
        );
        continue;
      }

      try {
        await this.transporter.sendMail({
          from: this.fromAddress,
          to: recipient.to,
          subject: recipient.subject,
          text,
          html,
        });
        this.logger.log(
          `Sent ${recipient.type} order confirmation email for #${order.orderNumber} to ${recipient.to}`,
        );
      } catch (err: any) {
        this.logger.error(
          `Failed to send ${recipient.type} order email for #${order.orderNumber} to ${recipient.to}: ${err?.code || err?.message}`,
        );
      }
    }
  }
}
