import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/User.js';

class AuthService {
  /**
   * Register a new user
   */
  async register ({ email, password, name }) {
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw new Error('User with this email already exists');
    }

    // Create email verification token
    const emailVerificationToken = crypto.randomBytes(32).toString('hex');

    // Create new user
    const user = await User.create({
      email,
      password,
      name,
      emailVerificationToken,
      isEmailVerified: false
    });

    return {
      user,
      emailVerificationToken
    };
  }

  /**
   * Login user
   */
  async login ({ email, password }) {
    // Find user with password field
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      throw new Error('Invalid email or password');
    }

    // Check if user is active
    if (!user.isActive) {
      throw new Error('Account has been deactivated');
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      throw new Error('Invalid email or password');
    }

    // Generate access and refresh tokens
    const accessToken = this.generateAccessToken(user);
    const refreshToken = this.generateRefreshToken(user);

    // Store refresh token in database
    const refreshTokenExpiry = this.getRefreshTokenExpiry();
    user.refreshTokens.push({
      token: refreshToken,
      expiresAt: refreshTokenExpiry
    });

    // Clean up expired refresh tokens
    user.refreshTokens = user.refreshTokens.filter(rt => rt.expiresAt > new Date());

    // Update last login
    user.lastLoginAt = new Date();
    await user.save();

    // Remove password from user object
    const userObject = user.toJSON();

    return {
      user: userObject,
      accessToken,
      refreshToken
    };
  }

  /**
   * Verify email with token
   */
  async verifyEmail ({ token }) {
    const user = await User.findOne({ emailVerificationToken: token });
    if (!user) {
      throw new Error('Invalid or expired verification token');
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    await user.save();

    return user;
  }

  /**
   * Request password reset
   */
  async forgotPassword ({ email }) {
    const user = await User.findOne({ email });
    if (!user) {
      // Don't reveal if user exists for security
      return { message: 'Reset link has been sent to email' };
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour

    user.passwordResetToken = resetToken;
    user.passwordResetExpires = resetTokenExpiry;
    await user.save();

    return {
      resetToken,
      user
    };
  }

  /**
   * Check if password reset token is valid (exists and not expired).
   * Used by reset-redirect to decide where to send the user.
   */
  async validateResetToken ({ token }) {
    if (!token || typeof token !== 'string') return { valid: false };
    const user = await User.findOne({
      passwordResetToken: token.trim(),
      passwordResetExpires: { $gt: Date.now() }
    }).select('_id').lean();
    return { valid: !!user };
  }

  /**
   * Reset password with token
   */
  async resetPassword ({ token, password }) {
    const user = await User.findOne({
      passwordResetToken: token,
      passwordResetExpires: { $gt: Date.now() }
    });

    if (!user) {
      throw new Error('Invalid or expired reset token');
    }

    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    return user;
  }

  /**
   * Change password for logged-in user
   */
  async changePassword ({ userId, currentPassword, newPassword }) {
    const user = await User.findById(userId).select('+password');
    if (!user) {
      throw new Error('User not found');
    }

    // Verify current password
    const isPasswordValid = await user.comparePassword(currentPassword);
    if (!isPasswordValid) {
      throw new Error('Current password is incorrect');
    }

    user.password = newPassword;
    await user.save();

    return user;
  }

  /**
   * Update user profile
   */
  async updateProfile ({ userId, updates }) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // If email is being changed, require re-verification
    if (updates.email && updates.email !== user.email) {
      const existingUser = await User.findOne({ email: updates.email });
      if (existingUser) {
        throw new Error('Email already in use');
      }
      user.isEmailVerified = false;
      user.emailVerificationToken = crypto.randomBytes(32).toString('hex');
    }

    // Update allowed fields
    if (updates.name) user.name = updates.name;
    if (updates.email) user.email = updates.email;

    await user.save();

    return {
      user,
      emailVerificationToken: user.emailVerificationToken
    };
  }

  /**
   * Get user by ID
   */
  async getUserById (userId) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    return user;
  }

  /**
   * Generate access token (short-lived)
   */
  generateAccessToken (user) {
    const payload = {
      userId: user._id,
      email: user.email,
      role: user.role
    };

    const secret = process.env.ACCESS_TOKEN_SECRET || 'your-access-token-secret';
    const expiresIn = process.env.ACCESS_TOKEN_EXPIRES_IN || '15m';

    return jwt.sign(payload, secret, { expiresIn });
  }

  /**
   * Generate refresh token (long-lived)
   */
  generateRefreshToken (user) {
    const payload = {
      userId: user._id,
      type: 'refresh'
    };

    const secret = process.env.REFRESH_TOKEN_SECRET || 'your-refresh-token-secret';
    const expiresIn = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';

    return jwt.sign(payload, secret, { expiresIn });
  }

  /**
   * Verify access token
   */
  verifyAccessToken (token) {
    try {
      const secret = process.env.ACCESS_TOKEN_SECRET || 'your-access-token-secret';
      return jwt.verify(token, secret);
    } catch (error) {
      throw new Error('Invalid or expired access token');
    }
  }

  /**
   * Verify refresh token
   */
  verifyRefreshToken (token) {
    try {
      const secret = process.env.REFRESH_TOKEN_SECRET || 'your-refresh-token-secret';
      const decoded = jwt.verify(token, secret);
      if (decoded.type !== 'refresh') {
        throw new Error('Invalid token type');
      }
      return decoded;
    } catch (error) {
      throw new Error('Invalid or expired refresh token');
    }
  }

  /**
   * Calculate refresh token expiry date
   */
  getRefreshTokenExpiry () {
    const expiresIn = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';
    const match = expiresIn.match(/^(\d+)([dhm])$/);
    if (!match) return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // Default 7 days

    const value = parseInt(match[1]);
    const unit = match[2];

    const multipliers = { m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
    return new Date(Date.now() + value * multipliers[unit]);
  }

  /**
   * Resend verification email
   */
  async resendVerificationEmail ({ email }) {
    const user = await User.findOne({ email });
    if (!user) {
      throw new Error('User not found');
    }

    if (user.isEmailVerified) {
      throw new Error('Email already verified');
    }

    // Generate new verification token
    const emailVerificationToken = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = emailVerificationToken;
    await user.save();

    return {
      user,
      emailVerificationToken
    };
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken ({ refreshToken }) {
    // Verify refresh token
    const decoded = this.verifyRefreshToken(refreshToken);

    // Find user and check if refresh token exists in database
    const user = await User.findById(decoded.userId);
    if (!user) {
      throw new Error('User not found');
    }

    if (!user.isActive) {
      throw new Error('Account has been deactivated');
    }

    // Check if refresh token exists in user's refresh tokens
    const tokenExists = user.refreshTokens.some(
      rt => rt.token === refreshToken && rt.expiresAt > new Date()
    );

    if (!tokenExists) {
      throw new Error('Invalid or expired refresh token');
    }

    // Generate new access token
    const accessToken = this.generateAccessToken(user);

    return {
      user,
      accessToken
    };
  }

  /**
   * Logout user by removing refresh token
   */
  async logout ({ userId, refreshToken }) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Remove the specific refresh token
    if (refreshToken) {
      user.refreshTokens = user.refreshTokens.filter(rt => rt.token !== refreshToken);
    } else {
      // If no specific token provided, clear all refresh tokens
      user.refreshTokens = [];
    }

    await user.save();

    return { success: true };
  }
}

export default new AuthService();
