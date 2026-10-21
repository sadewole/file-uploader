import { test, describe } from 'node:test'
import assert from 'node:assert'
import { config } from '../src/config/index.js'

describe('Config', () => {
  test('config exposes the expected structure', () => {
    assert.strictEqual(typeof config.server.port, 'number')
    assert.strictEqual(config.server.host, '0.0.0.0')
    assert.strictEqual(typeof config.gcs.bucketName, 'string')
    assert.strictEqual(typeof config.upload.maxFileSizeBytes, 'number')
    assert.ok(Array.isArray(config.upload.allowedMimeTypes))
  })
})
