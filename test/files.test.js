import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Readable } from 'node:stream';
import {
  buildContentDisposition,
  buildObjectName,
  buildQuarantineName,
  isManagedObjectName,
  isMimeTypeAllowed,
  isQuarantineObjectName,
  peekStream,
  resolveContentType,
  sanitizeFilename,
} from '../src/lib/files.js';

const PNG_HEAD = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('file helpers', () => {
  test('matches exact and wildcard MIME types', () => {
    const patterns = [
      'image/*',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.*',
    ];
    assert.strictEqual(isMimeTypeAllowed('image/png', patterns), true);
    assert.strictEqual(isMimeTypeAllowed('application/pdf', patterns), true);
    assert.strictEqual(
      isMimeTypeAllowed(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        patterns,
      ),
      true,
    );
    assert.strictEqual(isMimeTypeAllowed('text/html', patterns), false);
  });

  test('sanitizes traversal filenames', () => {
    assert.strictEqual(sanitizeFilename('../../etc/passwd'), 'passwd');
    assert.strictEqual(sanitizeFilename('..\\..\\evil.txt'), 'evil.txt');
    assert.strictEqual(sanitizeFilename(''), 'file');
  });

  test('builds managed object names', () => {
    const name = buildObjectName({
      prefix: 'uploads',
      extension: '.png',
      date: new Date('2026-10-21T00:00:00Z'),
      id: UUID,
    });
    assert.strictEqual(name, `uploads/2026/10/${UUID}.png`);
    assert.strictEqual(isManagedObjectName(name, 'uploads'), true);
  });

  test('rejects traversal and foreign object names', () => {
    assert.strictEqual(isManagedObjectName('uploads/2026/10/../../secret', 'uploads'), false);
    assert.strictEqual(isManagedObjectName('other/2026/10/file.png', 'uploads'), false);
    assert.strictEqual(isManagedObjectName('/uploads/file.png', 'uploads'), false);
  });

  test('validates quarantine keys', () => {
    const name = buildQuarantineName({ prefix: 'quarantine', extension: '.png', id: UUID });
    assert.strictEqual(name, `quarantine/${UUID}.png`);
    assert.strictEqual(isQuarantineObjectName(name, 'quarantine'), true);
    assert.strictEqual(isQuarantineObjectName('quarantine/not-a-uuid.png', 'quarantine'), false);
  });

  test('peekStream returns the head and preserves the full stream', async () => {
    const { head, stream } = await peekStream(Readable.from([Buffer.from('abcdefghij')]), 4);
    assert.strictEqual(head.toString(), 'abcd');

    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    assert.strictEqual(Buffer.concat(chunks).toString(), 'abcdefghij');
  });

  test('peekStream preserves bytes beyond the sniff window exactly once', async () => {
    const payload = Buffer.alloc(10_000, 7);
    payload[0] = 0x89;
    const { head, stream } = await peekStream(
      Readable.from([payload.subarray(0, 4000), payload.subarray(4000)]),
      4096,
    );
    assert.strictEqual(head.length, 4096);

    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    assert.deepStrictEqual(Buffer.concat(chunks), payload);
  });

  test('accepts detected types that match the allowlist', () => {
    const result = resolveContentType({
      detected: { mime: 'image/png', ext: 'png' },
      declared: 'image/png',
      filename: 'photo.png',
      allowedMimeTypes: ['image/*'],
      strict: true,
    });
    assert.deepStrictEqual(result, { contentType: 'image/png', extension: '.png' });
  });

  test('rejects declared types that do not match detected contents', () => {
    assert.throws(
      () =>
        resolveContentType({
          detected: { mime: 'text/plain', ext: 'txt' },
          declared: 'image/png',
          filename: 'photo.png',
          allowedMimeTypes: ['image/*', 'text/plain'],
          strict: true,
        }),
      (error) => error.statusCode === 415,
    );
  });

  test('allows text-like files that cannot be detected', () => {
    const result = resolveContentType({
      detected: undefined,
      declared: 'text/plain',
      filename: 'notes.txt',
      allowedMimeTypes: ['text/plain'],
      strict: true,
    });
    assert.deepStrictEqual(result, { contentType: 'text/plain', extension: '.txt' });
  });

  test('rejects undetectable binary-looking uploads', () => {
    assert.throws(
      () =>
        resolveContentType({
          detected: undefined,
          declared: 'application/pdf',
          filename: 'document.pdf',
          allowedMimeTypes: ['application/pdf'],
          strict: true,
        }),
      (error) => error.statusCode === 415,
    );
  });

  test('builds a safe content disposition', () => {
    const value = buildContentDisposition('../../my "file".pdf');
    assert.match(value, /^attachment; filename="my _file_\.pdf"/);
    assert.match(value, /filename\*=UTF-8''/);
  });

  test('detected PNG content resolves to image/png', async () => {
    const { fileTypeFromBuffer } = await import('file-type');
    const detected = await fileTypeFromBuffer(PNG_HEAD);
    assert.strictEqual(detected?.mime, 'image/png');
  });
});
