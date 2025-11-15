import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.TIKTOK_TOKEN_ENCRYPTION_KEY;

let cachedKey = null;
let encryptionAvailable = false;

if (ENCRYPTION_KEY) {
  try {
    cachedKey = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
    encryptionAvailable = true;
  } catch (error) {
    console.warn('[TikTokSecretUtils] Failed to derive encryption key, falling back to plaintext storage', error);
    cachedKey = null;
    encryptionAvailable = false;
  }
}

const IV_LENGTH = 12; // AES-256-GCM recommended IV length
const TAG_LENGTH = 16;

export function isEncryptionEnabled () {
  return encryptionAvailable;
}

export function encryptSecret (value) {
  if (!value || !encryptionAvailable) {
    return value;
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', cachedKey, iv);

  const cipherText = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `enc:${Buffer.concat([iv, authTag, cipherText]).toString('base64')}`;
}

export function decryptSecret (value) {
  if (!value || !encryptionAvailable) {
    return value;
  }

  if (!value.startsWith('enc:')) {
    // Legacy plaintext value
    return value;
  }

  const buffer = Buffer.from(value.slice(4), 'base64');

  const iv = buffer.subarray(0, IV_LENGTH);
  const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const payload = buffer.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv('aes-256-gcm', cachedKey, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);
  return decrypted.toString('utf8');
}
