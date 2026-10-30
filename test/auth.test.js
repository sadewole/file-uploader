import { test, describe } from 'node:test';
import assert from 'node:assert';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import authPlugin from '../src/plugins/auth.js';

async function buildApp(auth) {
  const app = Fastify();
  app.decorate('config', { auth });
  await app.register(sensible);
  await authPlugin(app);
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/private', async () => ({ ok: true }));
  return app;
}

describe('API key authentication', () => {
  test('allows requests when auth is disabled', async () => {
    const app = await buildApp({ mode: 'none', keys: [] });
    const response = await app.inject({ method: 'GET', url: '/private' });
    assert.strictEqual(response.statusCode, 200);
    await app.close();
  });

  test('rejects requests without a key', async () => {
    const app = await buildApp({ mode: 'api-key', keys: ['secret-key'] });
    const response = await app.inject({ method: 'GET', url: '/private' });
    assert.strictEqual(response.statusCode, 401);
    assert.strictEqual(response.headers['www-authenticate'], 'Bearer realm="file-upload"');
    await app.close();
  });

  test('rejects an incorrect key', async () => {
    const app = await buildApp({ mode: 'api-key', keys: ['secret-key'] });
    const response = await app.inject({
      method: 'GET',
      url: '/private',
      headers: { 'x-api-key': 'wrong-key' },
    });
    assert.strictEqual(response.statusCode, 401);
    await app.close();
  });

  test('accepts x-api-key and bearer tokens', async () => {
    const app = await buildApp({ mode: 'api-key', keys: ['secret-key', 'rotated-key'] });

    const withApiKey = await app.inject({
      method: 'GET',
      url: '/private',
      headers: { 'x-api-key': 'rotated-key' },
    });
    assert.strictEqual(withApiKey.statusCode, 200);

    const withBearer = await app.inject({
      method: 'GET',
      url: '/private',
      headers: { authorization: 'Bearer secret-key' },
    });
    assert.strictEqual(withBearer.statusCode, 200);

    await app.close();
  });

  test('leaves the health endpoint public', async () => {
    const app = await buildApp({ mode: 'api-key', keys: ['secret-key'] });
    const response = await app.inject({ method: 'GET', url: '/health' });
    assert.strictEqual(response.statusCode, 200);
    await app.close();
  });
});
