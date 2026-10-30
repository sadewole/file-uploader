import path from 'path';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';

export const SNIFF_BYTES = 4100;

const TEXT_LIKE_TYPES = [/^text\//, /^application\/(json|xml|csv|x-ndjson)$/];

const MIME_EXTENSIONS = {
  'application/pdf': '.pdf',
  'application/json': '.json',
  'application/xml': '.xml',
  'application/zip': '.zip',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

function fileTypeError(message) {
  const error = new Error(message);
  error.statusCode = 415;
  error.code = 'UNSUPPORTED_FILE_TYPE';
  return error;
}

export function normalizeMimeType(mimeType) {
  return String(mimeType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

export function isMimeTypeAllowed(mimeType, patterns) {
  const value = normalizeMimeType(mimeType);
  if (!value) return false;

  return patterns.some((pattern) => {
    const candidate = pattern.trim().toLowerCase();
    if (candidate === '*') return true;
    if (candidate.endsWith('*')) return value.startsWith(candidate.slice(0, -1));
    return value === candidate;
  });
}

export function isTextLikeMimeType(mimeType) {
  const value = normalizeMimeType(mimeType);
  return TEXT_LIKE_TYPES.some((pattern) => pattern.test(value));
}

function stripControlCharacters(value) {
  let result = '';
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code >= 32 && code !== 127) {
      result += character;
    }
  }
  return result;
}

export function sanitizeFilename(filename) {
  const normalized = String(filename || 'file').replace(/\\/g, '/');
  const base = stripControlCharacters(path.basename(normalized)).trim();
  return base.slice(0, 255) || 'file';
}

export function extensionFromFilename(filename) {
  const extension = path.extname(sanitizeFilename(filename)).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '';
}

function normalizeExtension(extension) {
  if (!extension) return '';
  const value = extension.startsWith('.') ? extension : `.${extension}`;
  return /^\.[a-z0-9]{1,10}$/i.test(value) ? value.toLowerCase() : '';
}

function extensionForDeclaredType(mimeType, filename) {
  return extensionFromFilename(filename) || MIME_EXTENSIONS[normalizeMimeType(mimeType)] || '';
}

export function buildContentDisposition(filename) {
  const safeName = sanitizeFilename(filename);
  const asciiName = safeName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

async function* iteratorToStream(iterator, head, remainder) {
  try {
    if (head.length > 0) yield head;
    if (remainder.length > 0) yield remainder;
    for (;;) {
      const { value, done } = await iterator.next();
      if (done) return;
      if (value && value.length > 0) yield value;
    }
  } finally {
    if (typeof iterator.return === 'function') {
      await iterator.return();
    }
  }
}

export async function peekStream(readable, size = SNIFF_BYTES) {
  const iterator = readable[Symbol.asyncIterator]();
  const chunks = [];
  let length = 0;

  while (length < size) {
    const { value, done } = await iterator.next();
    if (done) break;
    if (!value || value.length === 0) continue;
    chunks.push(value);
    length += value.length;
  }

  const buffered = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
  const head = buffered.subarray(0, Math.min(size, buffered.length));
  const remainder = buffered.subarray(head.length);

  return {
    head,
    stream: Readable.from(iteratorToStream(iterator, head, remainder)),
  };
}

export function resolveContentType({
  detected,
  declared,
  filename,
  allowedMimeTypes,
  strict = true,
}) {
  const declaredType = normalizeMimeType(declared);

  if (!strict) {
    if (!isMimeTypeAllowed(declaredType, allowedMimeTypes)) {
      throw fileTypeError(`File type not allowed: ${declaredType || 'unknown'}`);
    }
    return {
      contentType: declaredType,
      extension: extensionForDeclaredType(declaredType, filename),
    };
  }

  if (detected) {
    if (!isMimeTypeAllowed(detected.mime, allowedMimeTypes)) {
      throw fileTypeError(`Detected file type is not allowed: ${detected.mime}`);
    }
    if (
      declaredType &&
      declaredType !== 'application/octet-stream' &&
      declaredType !== detected.mime
    ) {
      throw fileTypeError(
        `Declared content type ${declaredType} does not match the detected type ${detected.mime}`,
      );
    }
    return {
      contentType: detected.mime,
      extension: normalizeExtension(`.${detected.ext}`),
    };
  }

  if (
    declaredType &&
    isMimeTypeAllowed(declaredType, allowedMimeTypes) &&
    isTextLikeMimeType(declaredType)
  ) {
    return {
      contentType: declaredType,
      extension: extensionForDeclaredType(declaredType, filename),
    };
  }

  throw fileTypeError('The file type could not be verified from its contents');
}

export function resolveDeclaredContentType({ declared, filename, allowedMimeTypes }) {
  const declaredType = normalizeMimeType(declared);
  if (!isMimeTypeAllowed(declaredType, allowedMimeTypes)) {
    throw fileTypeError(`File type not allowed: ${declaredType || 'unknown'}`);
  }
  return {
    contentType: declaredType,
    extension: extensionForDeclaredType(declaredType, filename),
  };
}

export function buildObjectName({ prefix, extension, date = new Date(), id = randomUUID() }) {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const suffix = `${id}${normalizeExtension(extension)}`;
  return [prefix, year, month, suffix].filter(Boolean).join('/');
}

export function buildQuarantineName({ prefix, extension, id = randomUUID() }) {
  return [prefix, `${id}${normalizeExtension(extension)}`].filter(Boolean).join('/');
}

export function isManagedObjectName(name, prefix) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 1024) {
    return false;
  }
  if (name.startsWith('/') || name.includes('..') || name.includes('\\') || name.includes('\0')) {
    return false;
  }
  if (prefix && !name.startsWith(`${prefix}/`)) {
    return false;
  }
  return /^[A-Za-z0-9/_.-]+$/.test(name);
}

export function isQuarantineObjectName(name, prefix) {
  if (!isManagedObjectName(name, prefix)) return false;
  const remainder = name.slice(prefix.length + 1);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,10})?$/.test(
    remainder,
  );
}
