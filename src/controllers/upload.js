import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { fileTypeFromBuffer } from 'file-type';
import {
  SNIFF_BYTES,
  buildContentDisposition,
  buildObjectName,
  buildQuarantineName,
  isManagedObjectName,
  isQuarantineObjectName,
  peekStream,
  resolveContentType,
  resolveDeclaredContentType,
  sanitizeFilename,
} from '../lib/files.js';

function sendError(request, reply, error, context, fallbackMessage) {
  request.log.error({ err: error }, `${context} failed`);

  if (error.statusCode === 415) {
    return reply.unsupportedMediaType(error.message);
  }
  if (error.statusCode === 404 || error.code === 404) {
    return reply.notFound('Object not found');
  }
  if (error.code === 'FST_REQ_FILE_TOO_LARGE' || error.code === 'LIMIT_FILE_SIZE') {
    return reply.payloadTooLarge('File size exceeds limit');
  }
  if (error.code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') {
    return reply.badRequest('Request must be multipart/form-data');
  }

  return reply.internalServerError(fallbackMessage);
}

async function readFileHead(filePath, bytes) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function storeMultipartFile(request, part) {
  const { config, storage } = request.server;
  const originalName = sanitizeFilename(part.filename);

  if (!config.upload.strictTypeCheck) {
    const resolved = resolveDeclaredContentType({
      declared: part.mimetype,
      filename: originalName,
      allowedMimeTypes: config.upload.allowedMimeTypes,
    });
    const objectName = buildObjectName({
      prefix: config.upload.prefix,
      extension: resolved.extension,
    });
    const result = await storage.uploadStreamToGCS({
      stream: part.file,
      objectName,
      contentType: resolved.contentType,
      originalName,
    });
    return { ...result, originalName };
  }

  const { head, stream } = await peekStream(part.file);
  const detected = await fileTypeFromBuffer(head);
  const resolved = resolveContentType({
    detected,
    declared: part.mimetype,
    filename: originalName,
    allowedMimeTypes: config.upload.allowedMimeTypes,
    strict: true,
  });

  const objectName = buildObjectName({
    prefix: config.upload.prefix,
    extension: resolved.extension,
  });
  const result = await storage.uploadStreamToGCS({
    stream,
    objectName,
    contentType: resolved.contentType,
    originalName,
  });

  return { ...result, originalName };
}

export async function uploadSingleFile(request, reply) {
  try {
    if (!request.isMultipart()) {
      return reply.badRequest('Request must be multipart/form-data');
    }

    const part = await request.file({
      limits: { fileSize: request.server.config.upload.maxFileSizeBytes },
    });
    if (!part) {
      return reply.badRequest('No file provided');
    }

    const result = await storeMultipartFile(request, part);
    return reply.code(201).send({
      success: true,
      message: 'File uploaded successfully',
      ...result,
    });
  } catch (error) {
    return sendError(request, reply, error, 'Upload', 'File upload failed');
  }
}

export async function uploadMultipleFiles(request, reply) {
  try {
    if (!request.isMultipart()) {
      return reply.badRequest('Request must be multipart/form-data');
    }

    const parts = request.files({
      limits: { fileSize: request.server.config.upload.maxFileSizeBytes },
    });

    const uploads = [];
    for await (const part of parts) {
      if (part.type !== 'file' || !part.file) {
        part.file?.resume();
        continue;
      }
      uploads.push(await storeMultipartFile(request, part));
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
    return sendError(request, reply, error, 'Multi-upload', 'File upload failed');
  }
}

export async function uploadToDisk(request, reply) {
  let tempPath = null;
  try {
    if (!request.isMultipart()) {
      return reply.badRequest('Request must be multipart/form-data');
    }

    const { config } = request.server;
    const part = await request.file({
      limits: { fileSize: config.upload.maxFileSizeBytes },
      dest: path.resolve(config.upload.uploadDir),
    });
    if (!part) {
      return reply.badRequest('No file provided');
    }
    tempPath = part.filepath;

    const originalName = sanitizeFilename(part.filename);
    const head = await readFileHead(tempPath, SNIFF_BYTES);
    const detected = await fileTypeFromBuffer(head);
    const resolved = resolveContentType({
      detected,
      declared: part.mimetype,
      filename: originalName,
      allowedMimeTypes: config.upload.allowedMimeTypes,
      strict: config.upload.strictTypeCheck,
    });

    const fileName = `${randomUUID()}${resolved.extension}`;
    const finalPath = path.join(path.resolve(config.upload.uploadDir), fileName);
    await fs.rename(tempPath, finalPath);
    tempPath = null;

    return reply.code(201).send({
      success: true,
      message: 'File saved to disk',
      fileName,
      originalName,
      path: finalPath,
      contentType: resolved.contentType,
      size: part.file.bytesRead,
    });
  } catch (error) {
    return sendError(request, reply, error, 'Disk upload', 'File upload failed');
  } finally {
    if (tempPath) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
    }
  }
}

export async function createSignedUpload(request, reply) {
  try {
    const { config, storage } = request.server;
    const body = request.body || {};

    if (typeof body.filename !== 'string' || body.filename.trim() === '') {
      return reply.badRequest('filename is required');
    }
    if (typeof body.contentType !== 'string' || body.contentType.trim() === '') {
      return reply.badRequest('contentType is required');
    }

    const originalName = sanitizeFilename(body.filename);
    const resolved = resolveDeclaredContentType({
      declared: body.contentType,
      filename: originalName,
      allowedMimeTypes: config.upload.allowedMimeTypes,
    });
    const objectName = buildQuarantineName({
      prefix: config.upload.quarantinePrefix,
      extension: resolved.extension,
    });

    const signed = await storage.getSignedUploadUrl({
      objectName,
      contentType: resolved.contentType,
      maxSize: config.upload.maxSignedFileSizeBytes,
      expiresInSeconds: config.signedUrl.expiresSeconds,
    });

    return reply.code(201).send({
      success: true,
      fileName: objectName,
      originalName,
      contentType: resolved.contentType,
      maxSize: config.upload.maxSignedFileSizeBytes,
      method: 'PUT',
      uploadUrl: signed.url,
      headers: signed.headers,
      expiresAt: signed.expiresAt,
      verify: {
        method: 'POST',
        path: '/upload/verify',
        body: { key: objectName, filename: originalName },
      },
    });
  } catch (error) {
    return sendError(request, reply, error, 'Signed upload', 'Could not create signed upload URL');
  }
}

export async function verifySignedUpload(request, reply) {
  const { config, storage } = request.server;
  const body = request.body || {};
  let quarantineKey = null;

  try {
    if (
      typeof body.key !== 'string' ||
      !isQuarantineObjectName(body.key, config.upload.quarantinePrefix)
    ) {
      return reply.badRequest('Invalid quarantine key');
    }
    quarantineKey = body.key;

    const metadata = await storage.getObjectMetadata(quarantineKey);
    if (!metadata) {
      quarantineKey = null;
      return reply.notFound('Uploaded object not found');
    }

    const size = Number(metadata.size || 0);
    if (size <= 0 || size > config.upload.maxSignedFileSizeBytes) {
      await storage.deleteFileFromGCS(quarantineKey, { ignoreNotFound: true });
      quarantineKey = null;
      return reply.unsupportedMediaType('Uploaded file is empty or exceeds the size limit');
    }

    let detected = null;
    if (config.upload.strictTypeCheck) {
      const head = await storage.readObjectHead(quarantineKey, SNIFF_BYTES);
      detected = await fileTypeFromBuffer(head);
    }
    const originalName = sanitizeFilename(body.filename || quarantineKey.split('/').pop());
    const resolved = resolveContentType({
      detected,
      declared: metadata.contentType,
      filename: originalName,
      allowedMimeTypes: config.upload.allowedMimeTypes,
      strict: config.upload.strictTypeCheck,
    });

    const destination = buildObjectName({
      prefix: config.upload.prefix,
      extension: resolved.extension,
    });

    await storage.copyObject(quarantineKey, destination);
    await storage.setObjectMetadata(destination, {
      contentType: resolved.contentType,
      cacheControl: 'private, max-age=0',
      contentDisposition: buildContentDisposition(originalName),
      metadata: {
        originalName,
        md5Hash: metadata.md5Hash || '',
        crc32c: metadata.crc32c || '',
        uploadedAt: new Date().toISOString(),
        source: 'signed-url',
      },
    });
    await storage.deleteFileFromGCS(quarantineKey, { ignoreNotFound: true });
    quarantineKey = null;

    return reply.code(201).send({
      success: true,
      message: 'Upload verified',
      fileName: destination,
      bucket: config.gcs.bucketName,
      gcsUri: `gs://${config.gcs.bucketName}/${destination}`,
      size,
      contentType: resolved.contentType,
      originalName,
      md5Hash: metadata.md5Hash || null,
      crc32c: metadata.crc32c || null,
    });
  } catch (error) {
    if (quarantineKey && error.statusCode === 415) {
      await storage.deleteFileFromGCS(quarantineKey, { ignoreNotFound: true }).catch(() => {});
    }
    return sendError(
      request,
      reply,
      error,
      'Signed upload verification',
      'Could not verify upload',
    );
  }
}

export async function createSignedDownload(request, reply) {
  try {
    const { config, storage } = request.server;
    const key = typeof request.query.key === 'string' ? request.query.key : '';

    if (!isManagedObjectName(key, config.upload.prefix)) {
      return reply.badRequest('Invalid object key');
    }

    const metadata = await storage.getObjectMetadata(key);
    if (!metadata) {
      return reply.notFound('Object not found');
    }

    const signed = await storage.getSignedDownloadUrl({
      objectName: key,
      expiresInSeconds: config.signedUrl.expiresSeconds,
      filename: metadata.metadata?.originalName,
      responseType: metadata.contentType,
    });

    return reply.send({
      success: true,
      fileName: key,
      contentType: metadata.contentType,
      size: metadata.size,
      expiresAt: signed.expiresAt,
      downloadUrl: signed.url,
    });
  } catch (error) {
    return sendError(
      request,
      reply,
      error,
      'Signed download',
      'Could not create signed download URL',
    );
  }
}

export async function deleteFile(request, reply) {
  try {
    const { config, storage } = request.server;
    const key = request.params['*'];

    if (!isManagedObjectName(key, config.upload.prefix)) {
      return reply.badRequest('Invalid object key');
    }

    await storage.deleteFileFromGCS(key);
    return reply.send({
      success: true,
      message: 'File deleted successfully',
      fileName: key,
    });
  } catch (error) {
    return sendError(request, reply, error, 'Delete', 'File deletion failed');
  }
}
