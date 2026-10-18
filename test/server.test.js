import { test, describe } from 'node:test'
import assert from 'node:assert'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import sensible from '@fastify/sensible'
import uploadRoutes from '../src/routes/upload.js'
import { config } from '../src/config/index.js'

describe('Server routes', () => {
  test('GET /health returns ok', async () => {
    const fastify = Fastify()
    fastify.decorate('config', config)
    await fastify.register(sensible)
    await fastify.register(uploadRoutes)
    await fastify.ready()

    const response = await fastify.inject({
      method: 'GET',
      url: '/health'
    })

    assert.strictEqual(response.statusCode, 200)
    const body = JSON.parse(response.body)
    assert.strictEqual(body.status, 'ok')
    await fastify.close()
  })

  test('POST /upload without file returns 400', async () => {
    const fastify = Fastify()
    fastify.decorate('config', config)
    await fastify.register(sensible)
    await fastify.register(multipart)
    await fastify.register(uploadRoutes)
    await fastify.ready()

    const response = await fastify.inject({
      method: 'POST',
      url: '/upload'
    })

    assert.strictEqual(response.statusCode, 400)
    await fastify.close()
  })
})
