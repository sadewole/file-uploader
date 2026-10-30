import { createHash, timingSafeEqual } from 'crypto';

function safeCompare(received, expected) {
  const receivedHash = createHash('sha256').update(received).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(receivedHash, expectedHash);
}

function extractApiKey(request) {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice(7).trim();
  }

  const apiKey = request.headers['x-api-key'];
  if (typeof apiKey === 'string') {
    return apiKey.trim();
  }

  return '';
}

export default async function authPlugin(fastify) {
  const { mode, keys } = fastify.config.auth;

  if (mode === 'none') {
    return;
  }

  fastify.addHook('onRequest', async (request, reply) => {
    const pathname = request.url.split('?')[0];
    if (pathname === '/health') {
      return;
    }

    const provided = extractApiKey(request);
    if (!provided || !keys.some((key) => safeCompare(provided, key))) {
      reply.header('WWW-Authenticate', 'Bearer realm="file-upload"');
      return reply.unauthorized('Missing or invalid API key');
    }
  });
}
