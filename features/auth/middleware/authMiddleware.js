import authService from '../services/authService.js';
import User from '../models/User.js';

/**
 * Authenticate user via access token
 * Checks Authorization header for access token
 */
export const authenticate = async (req, res, next) => {
  try {
    // Get access token from Authorization header
    let accessToken = null;

    // Check Authorization header (Bearer token)
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      accessToken = req.headers.authorization.split(' ')[1];
    }

    if (!accessToken) {
      return res.status(401).json({
        success: false,
        message: 'Access token required. Please provide a valid access token.'
      });
    }

    // Verify access token
    const decoded = authService.verifyAccessToken(accessToken);

    // Get user from database
    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found. Please login again.'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account has been deactivated. Please contact support.'
      });
    }

    // Attach user to request
    req.user = user;

    next();
  } catch (error) {
    req.log?.error({ err: error }, 'Authentication failed');
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired access token. Please refresh your token.'
    });
  }
};

/**
 * Check if user is admin
 * Must be used after authenticate middleware
 */
export const requireAdmin = (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!req.user.isAdmin()) {
      req.log?.warn({ userId: req.user._id }, 'Unauthorized admin access attempt');
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.'
      });
    }

    next();
  } catch (error) {
    req.log?.error({ err: error }, 'Admin check failed');
    return res.status(500).json({
      success: false,
      message: 'Authorization check failed'
    });
  }
};

/**
 * Check if user has verified email
 * Must be used after authenticate middleware
 */
export const requireVerifiedEmail = (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!req.user.isEmailVerified) {
      return res.status(403).json({
        success: false,
        message: 'Email verification required. Please verify your email to continue.'
      });
    }

    next();
  } catch (error) {
    req.log?.error({ err: error }, 'Email verification check failed');
    return res.status(500).json({
      success: false,
      message: 'Verification check failed'
    });
  }
};

/**
 * Check if user has an active subscription
 * Must be used after authenticate middleware
 */
export const requireActiveSubscription = (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const allowedStatuses = ['active', 'trialing'];
    if (!allowedStatuses.includes(req.user.subscription.status)) {
      return res.status(403).json({
        success: false,
        message: 'Active subscription required. Please upgrade your plan.'
      });
    }

    next();
  } catch (error) {
    req.log?.error({ err: error }, 'Subscription check failed');
    return res.status(500).json({
      success: false,
      message: 'Subscription check failed'
    });
  }
};

/**
 * Check if user has a specific subscription plan
 * Must be used after authenticate middleware
 */
export const requirePlan = (...plans) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      if (!plans.includes(req.user.subscription.plan)) {
        return res.status(403).json({
          success: false,
          message: `This feature requires one of the following plans: ${plans.join(', ')}`
        });
      }

      next();
    } catch (error) {
      req.log?.error({ err: error }, 'Plan check failed');
      return res.status(500).json({
        success: false,
        message: 'Plan check failed'
      });
    }
  };
};

/**
 * Optional authentication - attaches user if access token exists but doesn't require it
 */
export const optionalAuth = async (req, res, next) => {
  try {
    // Get access token from Authorization header
    let accessToken = null;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      accessToken = req.headers.authorization.split(' ')[1];
    }

    if (accessToken) {
      try {
        const decoded = authService.verifyAccessToken(accessToken);
        const user = await User.findById(decoded.userId);
        if (user && user.isActive) {
          req.user = user;
        }
      } catch (error) {
        // Token invalid, but that's okay for optional auth
        req.log?.debug({ err: error }, 'Optional auth access token invalid');
      }
    }

    next();
  } catch (error) {
    req.log?.error({ err: error }, 'Optional auth failed');
    next(); // Continue even if there's an error
  }
};
