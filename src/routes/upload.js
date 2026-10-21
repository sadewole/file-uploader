import {
  uploadSingleFile,
  uploadMultipleFiles,
  uploadToDisk,
  deleteFile,
} from '../controllers/upload.js';

export default async function uploadRoutes(fastify, opts) {
  fastify.get('/health', async (request, reply) => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      env: fastify.config.server.env,
    };
  });

  fastify.post(
    '/upload',
    {
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
      schema: {
        description: 'Upload multiple files to Google Cloud Storage',
        tags: ['upload'],
        consumes: ['multipart/form-data'],
      },
    },
    uploadMultipleFiles,
  );

  fastify.post(
    '/upload/disk',
    {
      schema: {
        description: 'Upload a file to local disk (for testing)',
        tags: ['upload'],
        consumes: ['multipart/form-data'],
      },
    },
    uploadToDisk,
  );

  fastify.delete(
    '/upload/:filename',
    {
      schema: {
        description: 'Delete a file from Google Cloud Storage',
        tags: ['upload'],
        params: {
          type: 'object',
          properties: {
            filename: { type: 'string' },
          },
          required: ['filename'],
        },
      },
    },
    deleteFile,
  );
}
