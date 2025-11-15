import mongoose from 'mongoose';
import {
  TIKTOK_ACCOUNT_STATUSES,
  TIKTOK_ACCOUNT_STATUS,
  TIKTOK_DAILY_POST_LIMIT
} from '../constants/tiktokConstants.js';

const { Schema } = mongoose;

const TikTokAccountSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    tiktokUserId: {
      type: String,
      required: true
    },
    username: {
      type: String,
      required: true
    },
    displayName: {
      type: String
    },
    avatarUrl: {
      type: String
    },
    accessToken: {
      type: String,
      required: true
    },
    refreshToken: {
      type: String,
      required: true
    },
    scopes: {
      type: [String],
      default: []
    },
    expiresAt: {
      type: Date,
      required: true
    },
    status: {
      type: String,
      enum: TIKTOK_ACCOUNT_STATUSES,
      default: TIKTOK_ACCOUNT_STATUS.ACTIVE
    },
    dailyPostCount: {
      type: Number,
      default: 0,
      min: 0
    },
    dailyPostLimit: {
      type: Number,
      default: TIKTOK_DAILY_POST_LIMIT,
      min: 1
    },
    dailyPostResetAt: {
      type: Date
    },
    lastPostedAt: {
      type: Date
    },
    lastSyncAt: {
      type: Date
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {}
    },
    lastError: {
      type: String
    }
  },
  {
    timestamps: true
  }
);

TikTokAccountSchema.index({ user: 1, tiktokUserId: 1 }, { unique: true });
TikTokAccountSchema.index({ user: 1, status: 1 });

export default mongoose.model('TikTokAccount', TikTokAccountSchema);
