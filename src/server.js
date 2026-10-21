import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import sensible from '@fastify/sensible'
import { config } from './config/index.js'
import uploadRoutes from './routes/upload.js'
import { checkBucketExists } from './services/gcs.js'

const fastify = Fastify({
  logger: {
    level: config.server.env === 'development' ? 'debug' : 'info',
    transport: config.server.env === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname'
          }
        }
      : undefined
  }
})

fastify.decorate('config', config)

async function registerPlugins () {
  await fastify.register(sensible)
  await fastify.register(multipart, {
    limits: {
      fileSize: config.upload.maxFileSizeBytes,
      files: config.upload.maxFiles
    },
    throwFileSizeLimit: true
  })
}

async function registerRoutes () {
  await fastify.register(uploadRoutes)
}

async function healthCheckBucket () {
  if (!config.gcs.bucketName) {
    fastify.log.warn('GCS bucket not configured, skipping bucket check')
    return
  }
  try {
    const exists = await checkBucketExists()
    if (!exists) {
      fastify.log.warn(`GCS bucket "${config.gcs.bucketName}" does not exist or is not accessible`)
    } else {
      fastify.log.info(`GCS bucket "${config.gcs.bucketName}" is accessible`)
    }
  } catch (error) {
    fastify.log.error(error, 'Failed to check GCS bucket')
  }
}

async function shutdown (signal) {
  fastify.log.info(`Received ${signal}, shutting down gracefully`)
  try {
    await fastify.close()
    process.exit(0)
  } catch (error) {
    fastify.log.error(error, 'Error during shutdown')
    process.exit(1)
  }
}

async function start () {
  try {
    await registerPlugins()
    await registerRoutes()

    const address = await fastify.listen({
      port: config.server.port,
      host: config.server.host
    })

    fastify.log.info(`Server running at ${address}`)
    await healthCheckBucket()
  } catch (error) {
    fastify.log.error(error)
    process.exit(1)
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

start()
