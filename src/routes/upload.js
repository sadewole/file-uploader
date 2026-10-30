import {
  createSignedDownload,
  createSignedUpload,
  deleteFile,
  uploadMultipleFiles,
  uploadSingleFile,
  uploadToDisk,
  verifySignedUpload,
} from '../controllers/upload.js';

export default async function uploadRoutes(fastify) {
  const { config } = fastify;
  const uploadRateLimit = {
    max: config.rateLimit.uploadMax,
    timeWindow: config.rateLimit.windowMs,
  };

  fastify.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      env: config.server.env,
    };
  });

  fastify.post(
    '/upload',
    {
      config: { rateLimit: uploadRateLimit },
      schema: {
        description: 'Upload a single file to Google Cloud Storage',
        tags: ['upload'],
        consumes: ['multipart/form-data'],
      },
    },
    uploadSingleFile,
  );

  fastify.post(
    '/upload/multiple',
    {
      config: { rateLimit: uploadRateLimit },
      schema: {
        description: 'Upload multiple files to Google Cloud Storage',
        tags: ['upload'],
        consumes: ['multipart/form-data'],
      },
    },
    uploadMultipleFiles,
  );

  if (config.server.env !== 'production') {
    fastify.post(
      '/upload/disk',
      {
        config: { rateLimit: uploadRateLimit },
        schema: {
          description: 'Upload a file to local disk (development only)',
          tags: ['upload'],
          consumes: ['multipart/form-data'],
        },
      },
      uploadToDisk,
    );
  }

  fastify.post(
    '/upload/signed-url',
    {
      config: { rateLimit: uploadRateLimit },
      schema: {
        description: 'Create a signed URL for direct upload to Google Cloud Storage',
        tags: ['upload'],
        body: {
          type: 'object',
          required: ['filename', 'contentType'],
          additionalProperties: false,
          properties: {
            filename: { type: 'string', minLength: 1, maxLength: 255 },
            contentType: { type: 'string', minLength: 1, maxLength: 255 },
          },
        },
      },
    },
    createSignedUpload,
  );

  fastify.post(
    '/upload/verify',
    {
      config: { rateLimit: uploadRateLimit },
      schema: {
        description: 'Verify and promote a direct upload from quarantine',
        tags: ['upload'],
        body: {
          type: 'object',
          required: ['key'],
          additionalProperties: false,
          properties: {
            key: { type: 'string', minLength: 1, maxLength: 1024 },
            filename: { type: 'string', minLength: 1, maxLength: 255 },
          },
        },
      },
    },
    verifySignedUpload,
  );

  fastify.get(
    '/upload/signed-url',
    {
      schema: {
        description: 'Create a signed URL to download an object',
        tags: ['upload'],
        querystring: {
          type: 'object',
          required: ['key'],
          additionalProperties: false,
          properties: {
            key: { type: 'string', minLength: 1, maxLength: 1024 },
          },
        },
      },
    },
    createSignedDownload,
  );

  fastify.delete(
    '/upload/*',
    {
      config: { rateLimit: uploadRateLimit },
      schema: {
        description: 'Delete an object from Google Cloud Storage',
        tags: ['upload'],
      },
    },
    deleteFile,
  );
}
