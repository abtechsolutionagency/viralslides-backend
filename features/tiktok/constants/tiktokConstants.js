export const TIKTOK_DAILY_POST_LIMIT = 15;

export const TIKTOK_OAUTH_SCOPES = [
  'user.info.basic',
  'user.info.profile',
  'video.dataset.read',
  'video.list',
  'video.upload',
  'video.publish'
];

export const TIKTOK_TOKEN_GRACE_PERIOD_SECONDS = 300;

export const TIKTOK_ACCOUNT_STATUS = {
  ACTIVE: 'active',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
  ERROR: 'error'
};

export const TIKTOK_ACCOUNT_STATUSES = Object.values(TIKTOK_ACCOUNT_STATUS);
