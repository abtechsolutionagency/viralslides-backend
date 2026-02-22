import TikTokAccount from '../models/TikTokAccount.js';
import User from '../../auth/models/User.js';
import { getPlanById } from '../../subscription/constants/plans.js';
import {
  TIKTOK_ACCOUNT_STATUS,
  TIKTOK_DAILY_POST_LIMIT
} from '../constants/tiktokConstants.js';

class TikTokAccountService {
  async assertPlanAllowsNewAccount ({ userId }) {
    const user = await User.findById(userId).select('subscription.plan subscription.status');
    if (!user) {
      throw new Error('User not found');
    }

    const allowedStatuses = ['active', 'trialing'];
    if (!allowedStatuses.includes(user.subscription?.status)) {
      throw new Error('Active subscription required to connect TikTok accounts');
    }

    const plan = getPlanById(user.subscription?.plan);
    const maxAccounts = plan?.maxTikTokAccounts ?? 0;
    if (!Number.isFinite(maxAccounts)) {
      return;
    }

    const linkedCount = await TikTokAccount.countDocuments({ user: userId });
    if (linkedCount >= maxAccounts) {
      const suffix = maxAccounts === 1 ? '' : 's';
      throw new Error(
        `Your ${plan?.name || user.subscription?.plan || 'current'} plan allows ${maxAccounts} TikTok account${suffix}.`
      );
    }
  }

  getTargetAccountId (target) {
    if (!target || typeof target !== 'object') return null;

    const value = target.account || target.accountId || target.tiktokAccountId;
    if (!value) return null;

    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null && value._id) return value._id.toString();
    if (typeof value?.toString === 'function') return value.toString();
    return null;
  }

  async validateScenarioTargets ({
    userId,
    targets = [],
    postsPerRun = 1,
    isAutoPostEnabled = true
  }) {
    const normalizedTargets = Array.isArray(targets) ? targets : [];
    if (normalizedTargets.length === 0) return;

    const uniqueIds = [...new Set(
      normalizedTargets
        .map((target) => this.getTargetAccountId(target))
        .filter(Boolean)
    )];

    if (uniqueIds.length === 0) return;

    const accounts = await TikTokAccount.find({
      user: userId,
      _id: { $in: uniqueIds }
    });

    const accountMap = new Map(accounts.map((account) => [account._id.toString(), account]));
    const missingAccountId = uniqueIds.find((id) => !accountMap.has(id));
    if (missingAccountId) {
      throw new Error(`TikTok account not found for this user: ${missingAccountId}`);
    }

    const inactiveAccount = accounts.find((account) => account.status !== TIKTOK_ACCOUNT_STATUS.ACTIVE);
    if (inactiveAccount) {
      throw new Error(
        `TikTok account @${inactiveAccount.username || inactiveAccount._id} is not active. Reconnect it before using it in a scenario.`
      );
    }

    if (!isAutoPostEnabled) return;

    const requestedPosts = Number.isFinite(postsPerRun) && postsPerRun > 0
      ? Math.floor(postsPerRun)
      : 1;

    const autoPostTargetIds = [...new Set(
      normalizedTargets
        .filter((target) => target?.autoPost !== false)
        .map((target) => this.getTargetAccountId(target))
        .filter(Boolean)
    )];

    for (const accountId of autoPostTargetIds) {
      const account = accountMap.get(accountId);
      await this.resetDailyQuotaIfNeeded(account);

      const limit = account.dailyPostLimit || TIKTOK_DAILY_POST_LIMIT;
      const current = account.dailyPostCount || 0;
      const projected = current + requestedPosts;

      if (projected > limit) {
        throw new Error(
          `Posting limit would be exceeded for @${account.username} (${current}/${limit} today).`
        );
      }
    }
  }

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
    const existing = await TikTokAccount.findOne({
      user: userId,
      tiktokUserId: profile.user_id
    });

    if (!existing) {
      await this.assertPlanAllowsNewAccount({ userId });
    }

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
    const metadata = doc.metadata;
    const hasRefreshToken = Boolean(doc.refreshToken);

    const account = { ...doc };
    delete account.accessToken;
    delete account.refreshToken;
    delete account.metadata;

    return {
      ...account,
      metadata: {
        hasRefreshToken,
        ...((metadata && typeof metadata === 'object') ? metadata : {})
      }
    };
  }
}

export default new TikTokAccountService();
