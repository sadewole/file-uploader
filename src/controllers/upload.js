import { uploadFileToGCS, deleteFileFromGCS } from '../services/gcs.js';
import { config } from '../config/index.js';
import { promises as fs } from 'fs';
import path from 'path';

function isMimeTypeAllowed(mimetype, filename) {
  if (!mimetype) return false;
  const allowed = config.upload.allowedMimeTypes;

  for (const pattern of allowed) {
    if (pattern === '*') return true;
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      if (mimetype.startsWith(prefix)) return true;
    } else if (pattern === mimetype) {
      return true;
    }
  }
  return false;
}

export async function uploadSingleFile(request, reply) {
  try {
    if (!request.isMultipart()) {
      return reply.badRequest('Request must be multipart/form-data');
    }

    const data = await request.file({
      limits: {
        fileSize: config.upload.maxFileSizeBytes,
      },
    });

    if (!data) {
      return reply.badRequest('No file provided');
    }

    const isAllowed = isMimeTypeAllowed(data.mimetype, data.filename);
    if (!isAllowed) {
      return reply.forbidden(`File type not allowed: ${data.mimetype}`);
    }

    const result = await uploadFileToGCS(data);

    return reply.code(201).send({
      success: true,
      message: 'File uploaded successfully',
      ...result,
    });
  } catch (error) {
    request.log.error(error, 'Upload failed');
    if (error.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.payloadTooLarge('File size exceeds limit');
    }
    if (error.code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') {
      return reply.badRequest('Request must be multipart/form-data');
    }
    return reply.internalServerError('File upload failed');
  }
}

export async function uploadMultipleFiles(request, reply) {
  try {
    if (!request.isMultipart()) {
      return reply.badRequest('Request must be multipart/form-data');
    }

    const parts = request.files({
      limits: {
        fileSize: config.upload.maxFileSizeBytes,
      },
    });

    const uploads = [];
    for await (const part of parts) {
      if (!part.mimetype) continue;

      const isAllowed = isMimeTypeAllowed(part.mimetype, part.filename);
      if (!isAllowed) {
        return reply.forbidden(
          `File type not allowed: ${part.mimetype} for ${part.filename}`,
        );
      }

      const result = await uploadFileToGCS(part);
      uploads.push(result);
    }

    if (uploads.length === 0) {
      return reply.badRequest('No valid files provided');
    }

    return reply.code(201).send({
      success: true,
      message: `${uploads.length} file(s) uploaded successfully`,
      files: uploads,
    });
  } catch (error) {
    request.log.error(error, 'Multi-upload failed');
    if (error.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.payloadTooLarge('File size exceeds limit');
    }
    if (error.code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') {
      return reply.badRequest('Request must be multipart/form-data');
    }
    return reply.internalServerError('File upload failed');
  }
}

export async function uploadToDisk(request, reply) {
  try {
    if (!request.isMultipart()) {
      return reply.badRequest('Request must be multipart/form-data');
    }

    const data = await request.file({
      limits: {
        fileSize: config.upload.maxFileSizeBytes,
      },
      dest: path.resolve(config.upload.uploadDir),
    });

    if (!data) {
      return reply.badRequest('No file provided');
    }

    const isAllowed = isMimeTypeAllowed(data.mimetype, data.filename);
    if (!isAllowed) {
      return reply.forbidden(`File type not allowed: ${data.mimetype}`);
    }

    const finalPath = path.join(
      path.resolve(config.upload.uploadDir),
      data.filename,
    );
    await fs.rename(data.filepath, finalPath);

    return reply.code(201).send({
      success: true,
      message: 'File saved to disk',
      filename: data.filename,
      path: finalPath,
      mimetype: data.mimetype,
      size: data.file.bytesRead,
    });
  } catch (error) {
    request.log.error(error, 'Disk upload failed');
    if (error.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.payloadTooLarge('File size exceeds limit');
    }
    if (error.code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') {
      return reply.badRequest('Request must be multipart/form-data');
    }
    return reply.internalServerError('File upload failed');
  }
}

export async function deleteFile(request, reply) {
  try {
    const { filename } = request.params;
    await deleteFileFromGCS(filename);
    return reply.send({
      success: true,
      message: 'File deleted successfully',
      filename,
    });
  } catch (error) {
    request.log.error(error, 'Delete failed');
    return reply.internalServerError('File deletion failed');
  }
}
