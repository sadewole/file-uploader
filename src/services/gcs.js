import { Storage } from '@google-cloud/storage';
import { createHash } from 'crypto';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { config } from '../config/index.js';
import { buildContentDisposition } from '../lib/files.js';

const storage = new Storage({
  projectId: config.gcs.projectId,
  credentials: config.gcs.credentials,
  keyFilename: config.gcs.keyFilename,
});

const bucket = storage.bucket(config.gcs.bucketName);

export async function uploadStreamToGCS({ stream, objectName, contentType, originalName }) {
  const gcsFile = bucket.file(objectName);
  const hash = createHash('sha256');
  let size = 0;

  const hashStream = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      size += chunk.length;
      callback(null, chunk);
    },
  });

  const writeStream = gcsFile.createWriteStream({
    resumable: false,
    metadata: {
      contentType,
      cacheControl: 'private, max-age=0',
      contentDisposition: buildContentDisposition(originalName),
    },
  });

  try {
    await pipeline(stream, hashStream, writeStream);

    const sha256 = hash.digest('hex');
    await gcsFile.setMetadata({
      metadata: {
        originalName,
        sha256,
        uploadedAt: new Date().toISOString(),
        source: 'server',
      },
    });

    return {
      fileName: objectName,
      bucket: config.gcs.bucketName,
      gcsUri: `gs://${config.gcs.bucketName}/${objectName}`,
      size,
      contentType,
      sha256,
    };
  } catch (error) {
    await gcsFile.delete({ ignoreNotFound: true }).catch(() => {});
    throw error;
  }
}

export async function getSignedUploadUrl({ objectName, contentType, maxSize, expiresInSeconds }) {
  const expires = Date.now() + expiresInSeconds * 1000;
  const headers = {
    'Content-Type': contentType,
    'x-goog-content-length-range': `0,${maxSize}`,
  };

  const [url] = await bucket.file(objectName).getSignedUrl({
    version: 'v4',
    action: 'write',
    expires,
    contentType,
    extensionHeaders: {
      'x-goog-content-length-range': headers['x-goog-content-length-range'],
    },
  });

  return {
    url,
    headers,
    expiresAt: new Date(expires).toISOString(),
  };
}

export async function getSignedDownloadUrl({
  objectName,
  expiresInSeconds,
  filename,
  responseType,
}) {
  const expires = Date.now() + expiresInSeconds * 1000;

  const [url] = await bucket.file(objectName).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires,
    responseDisposition: buildContentDisposition(filename || objectName.split('/').pop()),
    responseType,
  });

  return {
    url,
    expiresAt: new Date(expires).toISOString(),
  };
}

export async function getObjectMetadata(objectName) {
  try {
    const [metadata] = await bucket.file(objectName).getMetadata();
    return metadata;
  } catch (error) {
    if (error.code === 404) return null;
    throw error;
  }
}

export async function readObjectHead(objectName, bytes = 4100) {
  const chunks = [];
  const readable = bucket.file(objectName).createReadStream({ start: 0, end: bytes - 1 });
  for await (const chunk of readable) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function copyObject(sourceName, destinationName) {
  await bucket.file(sourceName).copy(bucket.file(destinationName));
  return { fileName: destinationName };
}

export async function setObjectMetadata(objectName, metadata) {
  await bucket.file(objectName).setMetadata(metadata);
}

export async function deleteFileFromGCS(objectName, { ignoreNotFound = false } = {}) {
  await bucket.file(objectName).delete({ ignoreNotFound });
  return { success: true, fileName: objectName };
}

export async function checkBucketExists() {
  const [exists] = await bucket.exists();
  return exists;
}
