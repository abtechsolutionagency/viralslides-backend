import express from 'express';
import authController from '../controllers/authController.js';
import { authenticate, requireVerifiedEmail } from '../middleware/authMiddleware.js';
import {
  registerValidator,
  loginValidator,
  verifyEmailValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
  changePasswordValidator,
  updateProfileValidator
} from '../validators/authValidator.js';
import { validate } from '../../../shared/middleware/validate.js';

const router = express.Router();

/**
 * Public routes - no authentication required
 */

// Register new user
router.post(
  '/register',
  validate(registerValidator),
  authController.register
);

// Login user
router.post(
  '/login',
  validate(loginValidator),
  authController.login
);

// Verify email with token
router.post(
  '/verify-email',
  validate(verifyEmailValidator),
  authController.verifyEmail
);

// Request password reset
router.post(
  '/forgot-password',
  validate(forgotPasswordValidator),
  authController.forgotPassword
);

// Reset password with token
router.post(
  '/reset-password',
  validate(resetPasswordValidator),
  authController.resetPassword
);

// Resend verification email
router.post(
  '/resend-verification',
  validate(forgotPasswordValidator), // Uses same validator (just email)
  authController.resendVerification
);

// Refresh access token
router.post(
  '/refresh-token',
  authController.refreshToken
);

/**
 * Protected routes - authentication required
 */

// Logout user
router.post(
  '/logout',
  authenticate,
  authController.logout
);

// Get current user profile
router.get(
  '/me',
  authenticate,
  authController.getProfile
);

// Update user profile
router.patch(
  '/profile',
  authenticate,
  validate(updateProfileValidator),
  authController.updateProfile
);

// Change password
router.post(
  '/change-password',
  authenticate,
  validate(changePasswordValidator),
  authController.changePassword
);

export default router;
