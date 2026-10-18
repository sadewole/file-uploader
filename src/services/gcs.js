import { Storage } from '@google-cloud/storage'
import { config } from '../config/index.js'
import path from 'path'

const storage = new Storage({
  projectId: config.gcs.projectId,
  credentials: config.gcs.credentials,
  keyFilename: config.gcs.keyFilename
})

const bucket = storage.bucket(config.gcs.bucketName)

export async function uploadFileToGCS (file, destination) {
  const fileName = destination || `${Date.now()}-${file.filename}`
  const gcsFile = bucket.file(fileName)

  const writeStream = gcsFile.createWriteStream({
    resumable: false,
    contentType: file.mimetype,
    predefinedAcl: 'publicRead'
  })

  const uploadPromise = new Promise((resolve, reject) => {
    writeStream.on('error', reject)
    writeStream.on('finish', async () => {
      try {
        await gcsFile.makePublic()
        const [metadata] = await gcsFile.getMetadata()
        resolve({
          success: true,
          fileName,
          bucket: config.gcs.bucketName,
          url: `https://storage.googleapis.com/${config.gcs.bucketName}/${fileName}`,
          publicUrl: `https://storage.googleapis.com/${config.gcs.bucketName}/${fileName}`,
          gcsUri: `gs://${config.gcs.bucketName}/${fileName}`,
          size: metadata.size,
          contentType: metadata.contentType
        })
      } catch (error) {
        reject(error)
      }
    })
    file.file.pipe(writeStream)
  })

  return uploadPromise
}

export async function uploadFileFromDisk (filePath, destination, options = {}) {
  const fileName = destination || path.basename(filePath)
  await bucket.upload(filePath, {
    destination: fileName,
    contentType: options.contentType,
    resumable: false,
    ...options
  })
  const gcsFile = bucket.file(fileName)
  await gcsFile.makePublic()
  return {
    success: true,
    fileName,
    url: `https://storage.googleapis.com/${config.gcs.bucketName}/${fileName}`,
    gcsUri: `gs://${config.gcs.bucketName}/${fileName}`
  }
}

export async function deleteFileFromGCS (fileName) {
  await bucket.file(fileName).delete()
  return { success: true, fileName }
}

export async function checkBucketExists () {
  const [exists] = await bucket.exists()
  return exists
}
