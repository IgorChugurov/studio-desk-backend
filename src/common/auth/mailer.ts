import { Injectable, Logger } from '@nestjs/common';
import { loadEnv } from '../../config/env.js';

export const MAILER = Symbol('MAILER');

export interface Mailer {
  sendSignInCode(email: string, code: string): Promise<void>;
}

/** Sends the sign-in code through Resend. Failures are logged by the caller. */
@Injectable()
export class ResendMailer implements Mailer {
  private readonly logger = new Logger(ResendMailer.name);

  async sendSignInCode(email: string, code: string): Promise<void> {
    const env = loadEnv();
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL,
        to: [email],
        subject: 'Your StudioDesk sign-in code',
        text: `Your sign-in code is ${code}. It expires in 10 minutes.`,
      }),
    });
    if (!response.ok) {
      this.logger.error(
        `Resend rejected the sign-in code (${response.status})`,
      );
      throw new Error('Resend request failed');
    }
  }
}
