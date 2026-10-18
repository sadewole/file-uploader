import { test, describe } from 'node:test'
import assert from 'node:assert'
import { config } from '../src/config/index.js'

describe('Config', () => {
  test('config loads with env vars', () => {
    assert.strictEqual(config.gcs.bucketName, 'test-bucket')
    assert.strictEqual(config.server.host, '0.0.0.0')
  })
})
