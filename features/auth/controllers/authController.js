import authService from '../services/authService.js';
import emailService from '../../../shared/services/emailService.js';

class AuthController {
  /**
   * Register a new user
   * POST /api/auth/register
   */
  async register (req, res) {
    try {
      const { email, password, name } = req.body;

      const { user, emailVerificationToken } = await authService.register({
        email,
        password,
        name
      });

      try {
        await emailService.sendVerificationEmail({
          to: user.email,
          token: emailVerificationToken
        });
      } catch (emailError) {
        req.log.error({ err: emailError, userId: user._id }, 'Failed to send verification email');
        return res.status(500).json({
          success: false,
          message: 'Failed to send verification email'
        });
      }

      // TODO: Remove verification token from response once frontend handles verification flow

      req.log.info({ userId: user._id, email: user.email }, 'User registered successfully');

      res.status(201).json({
        success: true,
        message: 'Registration successful. Please verify your email.',
        data: {
          user,
          verificationToken: emailVerificationToken // Remove in production
        }
      });
    } catch (error) {
      req.log.error({ err: error }, 'Registration failed');
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Login user
   * POST /api/auth/login
   */
  async login (req, res) {
    try {
      const { email, password } = req.body;

      const { user, accessToken, refreshToken } = await authService.login({ email, password });

      // Set refresh token in HTTP-only cookie
      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });

      req.log.info({ userId: user._id, email: user.email }, 'User logged in successfully');

      res.status(200).json({
        success: true,
        message: 'Login successful',
        data: {
          user,
          accessToken
        }
      });
    } catch (error) {
      req.log.error({ err: error }, 'Login failed');
      res.status(401).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Logout user
   * POST /api/auth/logout
   */
  async logout (req, res) {
    try {
      const userId = req.user._id;
      const refreshToken = req.cookies.refreshToken;

      // Remove refresh token from database
      await authService.logout({ userId, refreshToken });

      // Clear refresh token cookie
      res.clearCookie('refreshToken');

      req.log.info({ userId }, 'User logged out successfully');

      res.status(200).json({
        success: true,
        message: 'Logout successful'
      });
    } catch (error) {
      req.log.error({ err: error }, 'Logout failed');
      res.status(500).json({
        success: false,
        message: 'Logout failed'
      });
    }
  }

  /**
   * Refresh access token
   * POST /api/auth/refresh-token
   */
  async refreshToken (req, res) {
    try {
      const refreshToken = req.cookies.refreshToken;

      if (!refreshToken) {
        return res.status(401).json({
          success: false,
          message: 'Refresh token not found'
        });
      }

      const { user, accessToken } = await authService.refreshAccessToken({ refreshToken });

      req.log.info({ userId: user._id }, 'Access token refreshed');

      res.status(200).json({
        success: true,
        message: 'Access token refreshed',
        data: {
          accessToken
        }
      });
    } catch (error) {
      req.log.error({ err: error }, 'Token refresh failed');
      res.status(401).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Verify email
   * POST /api/auth/verify-email
   */
  async verifyEmail (req, res) {
    try {
      const { token } = req.body;

      const user = await authService.verifyEmail({ token });

      req.log.info({ userId: user._id, email: user.email }, 'Email verified successfully');

      res.status(200).json({
        success: true,
        message: 'Email verified successfully',
        data: { user }
      });
    } catch (error) {
      req.log.error({ err: error }, 'Email verification failed');
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Forgot password - send reset email
   * POST /api/auth/forgot-password
   */
  async forgotPassword (req, res) {
    try {
      const { email } = req.body;

      const result = await authService.forgotPassword({ email });

      if (result.resetToken && result.user) {
        try {
          await emailService.sendPasswordResetEmail({
            to: result.user.email,
            token: result.resetToken
          });
        } catch (emailError) {
          req.log.error({ err: emailError, email }, 'Failed to send password reset email');
          return res.status(500).json({
            success: false,
            message: 'Failed to send password reset email'
          });
        }
      }

      req.log.info({ email }, 'Password reset requested');

      res.status(200).json({
        success: true,
        message: 'If the email exists, a reset link has been sent'
      });
    } catch (error) {
      req.log.error({ err: error }, 'Forgot password failed');
      res.status(500).json({
        success: false,
        message: 'Failed to process request'
      });
    }
  }

  /**
   * Reset password with token
   * POST /api/auth/reset-password
   */
  async resetPassword (req, res) {
    try {
      const { token, password } = req.body;

      const user = await authService.resetPassword({ token, password });

      req.log.info({ userId: user._id, email: user.email }, 'Password reset successfully');

      res.status(200).json({
        success: true,
        message: 'Password reset successful. Please login with your new password.'
      });
    } catch (error) {
      req.log.error({ err: error }, 'Password reset failed');
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Redirect to frontend reset page with token (or error)
   * GET /api/auth/reset-redirect?token=xxx
   * User clicks link in email → backend redirects → frontend /reset-password?token=xxx
   */
  async resetRedirect (req, res) {
    try {
      const isDev = process.env.NODE_ENV !== 'production';
      const frontendUrl = process.env.PASSWORD_RESET_URL ?? (isDev ? 'http://localhost:3000/reset-password' : null);
      if (!frontendUrl) {
        req.log.warn('PASSWORD_RESET_URL not configured');
        return res.status(503).json({
          success: false,
          message: 'Password reset redirect is not configured'
        });
      }

      const token = req.query.token ? String(req.query.token).trim() : '';
      const { valid } = await authService.validateResetToken({ token });

      const url = new URL(frontendUrl);
      if (valid && token) {
        url.searchParams.set('token', token);
      } else {
        url.searchParams.set('error', 'expired');
      }

      res.redirect(302, url.toString());
    } catch (error) {
      req.log.error({ err: error }, 'Reset redirect failed');
      res.status(500).json({
        success: false,
        message: 'Redirect failed'
      });
    }
  }

  /**
   * Change password for logged-in user
   * POST /api/auth/change-password
   */
  async changePassword (req, res) {
    try {
      const { currentPassword, newPassword } = req.body;
      const userId = req.user._id;

      await authService.changePassword({
        userId,
        currentPassword,
        newPassword
      });

      req.log.info({ userId }, 'Password changed successfully');

      res.status(200).json({
        success: true,
        message: 'Password changed successfully'
      });
    } catch (error) {
      req.log.error({ err: error, userId: req.user?._id }, 'Password change failed');
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Get current user profile
   * GET /api/auth/me
   */
  async getProfile (req, res) {
    try {
      const userId = req.user._id;

      const user = await authService.getUserById(userId);

      res.status(200).json({
        success: true,
        data: { user }
      });
    } catch (error) {
      req.log.error({ err: error, userId: req.user?._id }, 'Get profile failed');
      res.status(404).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Update user profile
   * PATCH /api/auth/profile
   */
  async updateProfile (req, res) {
    try {
      const userId = req.user._id;
      const updates = req.body;

      const { user, emailVerificationToken } = await authService.updateProfile({
        userId,
        updates
      });

      if (emailVerificationToken) {
        try {
          await emailService.sendVerificationEmail({
            to: user.email,
            token: emailVerificationToken
          });
        } catch (emailError) {
          req.log.error({ err: emailError, userId }, 'Failed to send email change verification email');
          return res.status(500).json({
            success: false,
            message: 'Failed to send verification email'
          });
        }
      }

      req.log.info({ userId, updates }, 'Profile updated successfully');

      res.status(200).json({
        success: true,
        message: emailVerificationToken
          ? 'Profile updated. Please verify your new email address.'
          : 'Profile updated successfully',
        data: {
          user,
          verificationToken: emailVerificationToken // Remove in production
        }
      });
    } catch (error) {
      req.log.error({ err: error, userId: req.user?._id }, 'Profile update failed');
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Resend verification email
   * POST /api/auth/resend-verification
   */
  async resendVerification (req, res) {
    try {
      const { email } = req.body;

      const { user, emailVerificationToken } = await authService.resendVerificationEmail({ email });

      try {
        await emailService.sendVerificationEmail({
          to: email,
          token: emailVerificationToken
        });
      } catch (emailError) {
        req.log.error({ err: emailError, userId: user._id }, 'Failed to resend verification email');
        return res.status(500).json({
          success: false,
          message: 'Failed to send verification email'
        });
      }

      req.log.info({ userId: user._id, email }, 'Verification email resent');

      res.status(200).json({
        success: true,
        message: 'Verification email sent',
        data: {
          verificationToken: emailVerificationToken // Remove in production
        }
      });
    } catch (error) {
      req.log.error({ err: error }, 'Resend verification failed');
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
}

export default new AuthController();
