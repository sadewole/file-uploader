import 'dotenv/config';
import { readFileSync } from 'fs';
import path from 'path';

function decodeServiceAccount() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
    try {
      const decoded = Buffer.from(
        process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64,
        'base64',
      ).toString('utf8');
      return JSON.parse(decoded);
    } catch (error) {
      throw new Error(`Failed to decode GOOGLE_APPLICATION_CREDENTIALS_BASE64: ${error.message}`, {
        cause: error,
      });
    }
  }
  return null;
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePrefix(value) {
  return value.replace(/^\/+|\/+$/g, '');
}

const serviceAccount = decodeServiceAccount();

let credentials = null;
if (serviceAccount) {
  credentials = serviceAccount;
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  try {
    const keyPath = path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    const keyFile = readFileSync(keyPath, 'utf8');
    credentials = JSON.parse(keyFile);
  } catch (error) {
    console.warn(
      `Warning: Could not load service account key from ${process.env.GOOGLE_APPLICATION_CREDENTIALS}: ${error.message}`,
    );
  }
}

const authMode = process.env.AUTH_MODE || 'none';
if (!['none', 'api-key'].includes(authMode)) {
  throw new Error(`Invalid AUTH_MODE "${authMode}". Use "none" or "api-key".`);
}

const apiKeys = (process.env.API_KEYS || '')
  .split(',')
  .map((key) => key.trim())
  .filter(Boolean);

if (authMode === 'api-key' && apiKeys.length === 0) {
  throw new Error('AUTH_MODE=api-key requires API_KEYS to be set.');
}

export const config = {
  server: {
    port: parseInteger(process.env.PORT, 3000),
    host: process.env.HOST || '0.0.0.0',
    env: process.env.NODE_ENV || 'development',
  },
  gcs: {
    bucketName: process.env.GCS_BUCKET_NAME || '',
    projectId: process.env.GCS_PROJECT_ID || credentials?.project_id,
    credentials,
    keyFilename: credentials ? undefined : process.env.GOOGLE_APPLICATION_CREDENTIALS,
  },
  upload: {
    maxFileSizeBytes: parseInteger(process.env.MAX_FILE_SIZE_BYTES, 52428800),
    maxSignedFileSizeBytes: parseInteger(process.env.MAX_SIGNED_UPLOAD_BYTES, 1073741824),
    maxFiles: parseInteger(process.env.MAX_FILES, 10),
    allowedMimeTypes: (process.env.ALLOWED_MIME_TYPES || 'image/*,application/pdf,text/plain')
      .split(',')
      .map((type) => type.trim())
      .filter(Boolean),
    uploadDir: process.env.UPLOAD_DIR || './uploads',
    prefix: normalizePrefix(process.env.UPLOAD_PREFIX || 'uploads'),
    quarantinePrefix: normalizePrefix(process.env.QUARANTINE_PREFIX || 'quarantine'),
    strictTypeCheck: process.env.STRICT_TYPE_CHECK !== 'false',
  },
  auth: {
    mode: authMode,
    keys: apiKeys,
  },
  cors: {
    origins: (process.env.CORS_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  },
  rateLimit: {
    max: parseInteger(process.env.RATE_LIMIT_MAX, 100),
    windowMs: parseInteger(process.env.RATE_LIMIT_WINDOW_MS, 60000),
    uploadMax: parseInteger(process.env.RATE_LIMIT_UPLOAD_MAX, 20),
  },
  signedUrl: {
    expiresSeconds: parseInteger(process.env.SIGNED_URL_EXPIRES_SECONDS, 900),
  },
};

if (!config.gcs.bucketName) {
  console.warn('Warning: GCS_BUCKET_NAME is not set. File uploads will fail until configured.');
}

if (config.auth.mode === 'none') {
  console.warn('Warning: AUTH_MODE is "none"; the upload API is unauthenticated.');
}

if (config.upload.maxFileSizeBytes > 30 * 1024 * 1024) {
  console.warn(
    'Warning: MAX_FILE_SIZE_BYTES exceeds 30 MiB. Server-side uploads will be rejected by Cloud Run, which limits HTTP requests to ~32 MiB. Use signed upload URLs for larger files.',
  );
}
