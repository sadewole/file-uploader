import { test, describe } from 'node:test';
import assert from 'node:assert';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import uploadRoutes from '../src/routes/upload.js';
import { config } from '../src/config/index.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const UUID = '123e4567-e89b-42d3-a456-426614174000';

function testConfig(overrides = {}) {
  return {
    ...config,
    server: { ...config.server, env: 'test' },
    upload: {
      ...config.upload,
      maxFileSizeBytes: 1024 * 1024,
      maxSignedFileSizeBytes: 1024 * 1024,
      allowedMimeTypes: ['image/*', 'text/plain', 'application/pdf'],
      prefix: 'uploads',
      quarantinePrefix: 'quarantine',
      strictTypeCheck: true,
    },
    rateLimit: { max: 1000, windowMs: 60000, uploadMax: 1000 },
    signedUrl: { expiresSeconds: 900 },
    ...overrides,
  };
}

async function buildApp({ configOverrides = {}, storageOverrides = {} } = {}) {
  const app = Fastify();
  const cfg = testConfig(configOverrides);
  const calls = [];

  app.decorate('config', cfg);
  app.decorate('storage', {
    uploadStreamToGCS: async ({ stream, objectName, contentType, originalName }) => {
      let size = 0;
      for await (const chunk of stream) size += chunk.length;
      return {
        fileName: objectName,
        bucket: 'test-bucket',
        gcsUri: `gs://test-bucket/${objectName}`,
        size,
        contentType,
        sha256: 'a'.repeat(64),
        originalName,
      };
    },
    getSignedUploadUrl: async ({ objectName, contentType, maxSize }) => ({
      url: `https://storage.example/${objectName}`,
      headers: {
        'Content-Type': contentType,
        'x-goog-content-length-range': `0,${maxSize}`,
      },
      expiresAt: '2026-10-21T00:15:00.000Z',
    }),
    getSignedDownloadUrl: async ({ objectName }) => ({
      url: `https://storage.example/download/${objectName}`,
      expiresAt: '2026-10-21T00:15:00.000Z',
    }),
    getObjectMetadata: async () => null,
    readObjectHead: async () => Buffer.alloc(0),
    copyObject: async (_source, destination) => ({ fileName: destination }),
    setObjectMetadata: async () => {},
    deleteFileFromGCS: async (key) => {
      calls.push(['delete', key]);
      return { success: true, fileName: key };
    },
    ...storageOverrides,
  });

  await app.register(sensible);
  await app.register(rateLimit, {
    global: true,
    max: cfg.rateLimit.max,
    timeWindow: cfg.rateLimit.windowMs,
  });
  await app.register(multipart, {
    limits: { fileSize: cfg.upload.maxFileSizeBytes, files: cfg.upload.maxFiles },
  });
  await app.register(uploadRoutes);

  return { app, calls };
}

function multipartPayload({ filename, contentType, content }) {
  const boundary = '----opencode-test-boundary';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);

  return {
    payload: Buffer.concat([head, Buffer.from(content), tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

describe('upload routes', () => {
  test('GET /health is public', async () => {
    const { app } = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.json().status, 'ok');
    await app.close();
  });

  test('server-side upload accepts a valid file', async () => {
    const { app } = await buildApp();
    const { payload, headers } = multipartPayload({
      filename: 'photo.png',
      contentType: 'image/png',
      content: PNG,
    });

    const response = await app.inject({ method: 'POST', url: '/upload', payload, headers });
    assert.strictEqual(response.statusCode, 201);

    const body = response.json();
    assert.match(body.fileName, /^uploads\/\d{4}\/\d{2}\/[0-9a-f-]+\.png$/);
    assert.strictEqual(body.contentType, 'image/png');
    assert.strictEqual(body.size, PNG.length);
    await app.close();
  });

  test('server-side upload rejects spoofed content', async () => {
    const { app } = await buildApp();
    const { payload, headers } = multipartPayload({
      filename: 'photo.png',
      contentType: 'image/png',
      content: Buffer.from('this is definitely not a png'),
    });

    const response = await app.inject({ method: 'POST', url: '/upload', payload, headers });
    assert.strictEqual(response.statusCode, 415);
    await app.close();
  });

  test('server-side upload accepts undetectable text files', async () => {
    const { app } = await buildApp();
    const { payload, headers } = multipartPayload({
      filename: 'notes.txt',
      contentType: 'text/plain',
      content: Buffer.from('hello world'),
    });

    const response = await app.inject({ method: 'POST', url: '/upload', payload, headers });
    assert.strictEqual(response.statusCode, 201);
    assert.strictEqual(response.json().contentType, 'text/plain');
    await app.close();
  });

  test('creates a signed upload URL in the quarantine prefix', async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/upload/signed-url',
      payload: { filename: 'photo.png', contentType: 'image/png' },
    });

    assert.strictEqual(response.statusCode, 201);
    const body = response.json();
    assert.match(body.fileName, /^quarantine\/[0-9a-f-]+\.png$/);
    assert.strictEqual(body.method, 'PUT');
    assert.strictEqual(body.headers['Content-Type'], 'image/png');
    assert.match(body.headers['x-goog-content-length-range'], /^0,\d+$/);
    assert.strictEqual(body.verify.path, '/upload/verify');
    await app.close();
  });

  test('rejects signed uploads for disallowed content types', async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/upload/signed-url',
      payload: { filename: 'payload.exe', contentType: 'application/x-msdownload' },
    });

    assert.strictEqual(response.statusCode, 415);
    await app.close();
  });

  test('rejects signed download requests for unmanaged keys', async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/upload/signed-url?key=../secrets.txt',
    });
    assert.strictEqual(response.statusCode, 400);
    await app.close();
  });

  test('verify promotes a valid quarantine object', async () => {
    const key = `quarantine/${UUID}.png`;
    const { app, calls } = await buildApp({
      storageOverrides: {
        getObjectMetadata: async () => ({
          size: PNG.length,
          contentType: 'image/png',
          md5Hash: 'md5-hash',
          crc32c: 'crc32c-hash',
        }),
        readObjectHead: async () => PNG,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/upload/verify',
      payload: { key, filename: 'photo.png' },
    });

    assert.strictEqual(response.statusCode, 201);
    const body = response.json();
    assert.match(body.fileName, /^uploads\/\d{4}\/\d{2}\/[0-9a-f-]+\.png$/);
    assert.strictEqual(body.contentType, 'image/png');
    assert.ok(calls.some(([action, deletedKey]) => action === 'delete' && deletedKey === key));
    await app.close();
  });

  test('verify deletes quarantine objects with spoofed contents', async () => {
    const key = `quarantine/${UUID}.png`;
    const { app, calls } = await buildApp({
      storageOverrides: {
        getObjectMetadata: async () => ({
          size: 20,
          contentType: 'image/png',
          md5Hash: '',
          crc32c: '',
        }),
        readObjectHead: async () => Buffer.from('not a png at all'),
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/upload/verify',
      payload: { key, filename: 'photo.png' },
    });

    assert.strictEqual(response.statusCode, 415);
    assert.ok(calls.some(([action, deletedKey]) => action === 'delete' && deletedKey === key));
    await app.close();
  });

  test('applies a stricter rate limit to upload routes', async () => {
    const { app } = await buildApp({
      configOverrides: {
        rateLimit: { max: 1000, windowMs: 60000, uploadMax: 2 },
      },
    });

    const request = () =>
      app.inject({
        method: 'POST',
        url: '/upload/signed-url',
        payload: { filename: 'photo.png', contentType: 'image/png' },
      });

    assert.strictEqual((await request()).statusCode, 201);
    assert.strictEqual((await request()).statusCode, 201);
    assert.strictEqual((await request()).statusCode, 429);
    await app.close();
  });
});
