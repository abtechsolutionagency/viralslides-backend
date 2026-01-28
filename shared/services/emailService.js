import { Resend } from 'resend';

class EmailService {
  constructor () {
    const apiKey = process.env.RESEND_API;
    if (!apiKey) {
      console.warn('[EmailService] RESEND_API key is not configured');
      this.client = null;
      return;
    }

    this.client = new Resend(apiKey);
    this.fromEmail = process.env.RESEND_FROM_EMAIL || 'wze@viralslides.ai';
    this.verificationUrl = process.env.EMAIL_VERIFICATION_URL;
    const port = process.env.PORT || 4000;
    const isDev = process.env.NODE_ENV !== 'production';
    this.apiBaseUrl = process.env.API_BASE_URL ?? (isDev ? `http://localhost:${port}` : null);
    this.passwordResetUrl = process.env.PASSWORD_RESET_URL ?? (isDev ? 'http://localhost:3000/reset-password' : null);
  }

  /**
   * Build clickable link for password reset email.
   * Prefer backend redirect: API_BASE_URL → /api/auth/reset-redirect?token=xxx → redirect to frontend.
   * Fallback: PASSWORD_RESET_URL → direct frontend link with ?token=xxx.
   */
  buildPasswordResetUrl (token) {
    if (!token) return null;
    try {
      if (this.apiBaseUrl) {
        const base = this.apiBaseUrl.replace(/\/$/, '');
        const url = new URL(`${base}/api/auth/reset-redirect`);
        url.searchParams.set('token', token);
        return url.toString();
      }
      if (this.passwordResetUrl) {
        const url = new URL(this.passwordResetUrl);
        url.searchParams.set('token', token);
        return url.toString();
      }
      return null;
    } catch (error) {
      console.warn('[EmailService] Invalid API_BASE_URL or PASSWORD_RESET_URL', error);
      return null;
    }
  }

  buildVerificationUrl (token) {
    if (!this.verificationUrl) return null;

    try {
      const url = new URL(this.verificationUrl);
      url.searchParams.set('token', token);
      return url.toString();
    } catch (error) {
      console.warn('[EmailService] Invalid EMAIL_VERIFICATION_URL configured', error);
      return null;
    }
  }

  async sendVerificationEmail ({ to, token }) {
    if (!this.client) {
      throw new Error('Email client is not configured');
    }

    const verifyUrl = this.buildVerificationUrl(token);
    const htmlBody = `
      <p>Hi,</p>
      <p>Thanks for joining ViralSlides! To finish setting up your account, please confirm your email address.</p>
      ${verifyUrl
        ? `<p><a href="${verifyUrl}">Verify your email</a></p>`
        : `<p>Your verification token is: <strong>${token}</strong></p>`}
      <p>If you did not create an account, you can safely ignore this email.</p>
      <p>— The ViralSlides Team</p>
    `;

    const textBody = verifyUrl
      ? `Hi,\n\nThanks for joining ViralSlides! Confirm your email by visiting: ${verifyUrl}\n\nIf you did not create an account, ignore this email.\n\n— The ViralSlides Team`
      : `Hi,\n\nThanks for joining ViralSlides! Your verification token is: ${token}\n\nIf you did not create an account, ignore this email.\n\n— The ViralSlides Team`;

    await this.client.emails.send({
      from: this.fromEmail,
      to,
      subject: 'Verify your ViralSlides account',
      html: htmlBody,
      text: textBody
    });
  }

  async sendPasswordResetEmail ({ to, token }) {
    if (!this.client) {
      throw new Error('Email client is not configured');
    }

    const resetUrl = this.buildPasswordResetUrl(token);
    if (!resetUrl) {
      throw new Error(
        'API_BASE_URL or PASSWORD_RESET_URL must be set to send password reset emails with a link'
      );
    }

    const htmlBody = `
      <p>Hi,</p>
      <p>You requested a password reset for your ViralSlides account. To choose a new password, please click the link below.</p>
      <p><a href="${resetUrl}">Reset your password</a></p>
      <p>If you did not request this, you can safely ignore this email.</p>
      <p>— The ViralSlides Team</p>
    `;

    const textBody = `Hi,\n\nYou requested a password reset for your ViralSlides account. To choose a new password, visit: ${resetUrl}\n\nIf you did not request this, ignore this email.\n\n— The ViralSlides Team`;

    await this.client.emails.send({
      from: this.fromEmail,
      to,
      subject: 'Reset your ViralSlides password',
      html: htmlBody,
      text: textBody
    });
  }
}

export default new EmailService();
