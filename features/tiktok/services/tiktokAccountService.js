import TikTokAccount from '../models/TikTokAccount.js';
import {
  TIKTOK_ACCOUNT_STATUS,
  TIKTOK_DAILY_POST_LIMIT
} from '../constants/tiktokConstants.js';

class TikTokAccountService {
  async listAccountsForUser (userId) {
    const accounts = await TikTokAccount.find({ user: userId }).sort({ username: 1 });
    await Promise.all(accounts.map((account) => this.resetDailyQuotaIfNeeded(account)));
    return accounts.map((account) => this.serializeAccount(account));
  }

  async getAccountForUser ({ userId, accountId }) {
    const account = await TikTokAccount.findOne({ _id: accountId, user: userId });
    if (!account) {
      return null;
    }

    await this.resetDailyQuotaIfNeeded(account);
    return this.serializeAccount(account);
  }

  async upsertAccountFromOAuth ({ userId, profile, tokens }) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + tokens.expiresIn * 1000);

    const account = await TikTokAccount.findOneAndUpdate(
      {
        user: userId,
        tiktokUserId: profile.user_id
      },
      {
        user: userId,
        tiktokUserId: profile.user_id,
        username: profile.username,
        displayName: profile.display_name,
        avatarUrl: profile.avatar_url,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        scopes: tokens.scopes || [],
        expiresAt,
        status: TIKTOK_ACCOUNT_STATUS.ACTIVE,
        lastSyncAt: now,
        metadata: {
          rawProfile: profile
        }
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true
      }
    );

    await this.resetDailyQuotaIfNeeded(account);
    return this.serializeAccount(account);
  }

  async disconnectAccount ({ userId, accountId }) {
    const account = await TikTokAccount.findOneAndDelete({
      _id: accountId,
      user: userId
    });

    return account ? this.serializeAccount(account) : null;
  }

  async markAccountStatus ({ accountId, userId, status, error }) {
    const account = await TikTokAccount.findOne({
      _id: accountId,
      user: userId
    });

    if (!account) {
      return null;
    }

    account.status = status;
    account.lastError = error || null;
    account.lastSyncAt = new Date();
    await account.save();

    return this.serializeAccount(account);
  }

  async recordPostUsage ({ accountId, userId, count = 1 }) {
    const account = await TikTokAccount.findOne({
      _id: accountId,
      user: userId
    });

    if (!account) {
      throw new Error('TikTok account not found');
    }

    await this.resetDailyQuotaIfNeeded(account);

    if (account.dailyPostCount + count > account.dailyPostLimit) {
      throw new Error('Daily posting limit reached for this TikTok account');
    }

    account.dailyPostCount += count;
    account.lastPostedAt = new Date();
    await account.save();

    return this.serializeAccount(account);
  }

  async resetDailyQuota ({ accountId, userId }) {
    const account = await TikTokAccount.findOne({
      _id: accountId,
      user: userId
    });

    if (!account) {
      throw new Error('TikTok account not found');
    }

    account.dailyPostCount = 0;
    account.dailyPostLimit = account.dailyPostLimit || TIKTOK_DAILY_POST_LIMIT;
    account.dailyPostResetAt = this.calculateNextReset(new Date());
    await account.save();

    return this.serializeAccount(account);
  }

  async resetDailyQuotaIfNeeded (account) {
    const now = new Date();

    if (!account.dailyPostResetAt || account.dailyPostResetAt <= now) {
      account.dailyPostCount = 0;
      account.dailyPostLimit = account.dailyPostLimit || TIKTOK_DAILY_POST_LIMIT;
      account.dailyPostResetAt = this.calculateNextReset(now);
      await account.save();
    }
  }

  calculateNextReset (date) {
    const next = new Date(date);
    next.setUTCHours(0, 0, 0, 0);
    next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }

  serializeAccount (accountDoc) {
    if (!accountDoc) return null;

    const doc = accountDoc.toObject ? accountDoc.toObject() : accountDoc;
    const {
      accessToken,
      refreshToken,
      metadata,
      ...account
    } = doc;

    return {
      ...account,
      metadata: {
        hasRefreshToken: Boolean(refreshToken),
        ...((metadata && typeof metadata === 'object') ? metadata : {})
      }
    };
  }
}

export default new TikTokAccountService();
