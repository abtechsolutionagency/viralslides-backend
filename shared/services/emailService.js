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
}

export default new EmailService();
