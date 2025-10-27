import mongoose from 'mongoose';
import argon2 from 'argon2';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },
  password: {
    type: String,
    required: true,
    select: false
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  subscription: {
    plan: {
      type: String,
      enum: ['creator', 'entrepreneur'],
      default: undefined
    },
    status: {
      type: String,
      enum: ['inactive', 'active', 'cancelled', 'past_due', 'trialing'],
      default: 'inactive'
    },
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false
    },
    planChangedAt: Date,
    stripeCustomerId: String,
    stripeSubscriptionId: String,
    currentPeriodStart: Date,
    currentPeriodEnd: Date
  },
  credits: {
    balance: {
      type: Number,
      default: 0,
      min: 0
    },
    lifetime: {
      type: Number,
      default: 0
    }
  },
  tiktokAccounts: [{
    username: String,
    userId: String,
    accessToken: {
      type: String,
      select: false
    },
    refreshToken: {
      type: String,
      select: false
    },
    tokenExpiresAt: Date,
    dailyPostCount: {
      type: Number,
      default: 0
    },
    lastPostDate: Date,
    connectedAt: {
      type: Date,
      default: Date.now
    }
  }],
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationToken: {
    type: String,
    select: false
  },
  passwordResetToken: {
    type: String,
    select: false
  },
  passwordResetExpires: {
    type: Date,
    select: false
  },
  lastLoginAt: Date,
  isActive: {
    type: Boolean,
    default: true
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  refreshTokens: [{
    token: {
      type: String,
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    expiresAt: {
      type: Date,
      required: true
    }
  }]
}, {
  timestamps: true,
  toJSON: {
    transform: (doc, ret) => {
      delete ret.password;
      delete ret.__v;
      return ret;
    }
  }
});

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  try {
    this.password = await argon2.hash(this.password);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  try {
    return await argon2.verify(this.password, candidatePassword);
  } catch (error) {
    return false;
  }
};

// Method to check TikTok account limit based on subscription
userSchema.methods.canAddTikTokAccount = function () {
  if (this.subscription.plan === 'entrepreneur') return true; // unlimited accounts
  if (this.subscription.plan === 'creator') return this.tiktokAccounts.length < 1;
  return false; // free plan: no accounts
};

// Method to get account limit for current plan
userSchema.methods.getTikTokAccountLimit = function () {
  const limits = {
    creator: 1,
    entrepreneur: Infinity // unlimited
  };
  return limits[this.subscription.plan] || 0;
};

// Method to reset daily post count for TikTok accounts
userSchema.methods.resetDailyPostCounts = function () {
  const today = new Date().setHours(0, 0, 0, 0);
  this.tiktokAccounts.forEach((account) => {
    const lastPostDate = account.lastPostDate ? new Date(account.lastPostDate).setHours(0, 0, 0, 0) : null;
    if (!lastPostDate || lastPostDate < today) {
      account.dailyPostCount = 0;
    }
  });
};

// Method to check if user is admin
userSchema.methods.isAdmin = function () {
  return this.role === 'admin';
};

// Index for faster queries
userSchema.index({ 'subscription.stripeCustomerId': 1 });
userSchema.index({ 'tiktokAccounts.userId': 1 });

const User = mongoose.model('User', userSchema);

export default User;
