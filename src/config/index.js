import 'dotenv/config'
import { readFileSync } from 'fs'
import path from 'path'

function decodeServiceAccount () {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
    try {
      const decoded = Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf8')
      return JSON.parse(decoded)
    } catch (error) {
      throw new Error(`Failed to decode GOOGLE_APPLICATION_CREDENTIALS_BASE64: ${error.message}`)
    }
  }
  return null
}

const serviceAccount = decodeServiceAccount()

let credentials = null
if (serviceAccount) {
  credentials = serviceAccount
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  try {
    const keyPath = path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS)
    const keyFile = readFileSync(keyPath, 'utf8')
    credentials = JSON.parse(keyFile)
  } catch (error) {
    console.warn(`Warning: Could not load service account key from ${process.env.GOOGLE_APPLICATION_CREDENTIALS}: ${error.message}`)
  }
}

export const config = {
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    host: process.env.HOST || '0.0.0.0',
    env: process.env.NODE_ENV || 'development'
  },
  gcs: {
    bucketName: process.env.GCS_BUCKET_NAME || '',
    projectId: process.env.GCS_PROJECT_ID || credentials?.project_id,
    credentials,
    keyFilename: credentials ? undefined : process.env.GOOGLE_APPLICATION_CREDENTIALS
  },
  upload: {
    maxFileSizeBytes: parseInt(process.env.MAX_FILE_SIZE_BYTES, 10) || 52428800,
    maxFiles: parseInt(process.env.MAX_FILES, 10) || 10,
    allowedMimeTypes: (process.env.ALLOWED_MIME_TYPES || 'image/*,application/pdf,text/plain').split(',').map(t => t.trim()),
    uploadDir: process.env.UPLOAD_DIR || './uploads'
  }
}

if (!config.gcs.bucketName) {
  console.warn('Warning: GCS_BUCKET_NAME is not set. File uploads will fail until configured.')
}
