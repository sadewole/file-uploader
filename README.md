# GCP File Upload with Fastify

A comprehensive Fastify application for uploading files to Google Cloud Storage (GCS) with support for multiple upload methods, validation, and flexible configuration.

## Features

- Single file upload to GCS
- Multiple file uploads to GCS
- Local disk upload (for testing)
- File type validation (MIME type based)
- File size limits (configurable)
- Support for GCS service account authentication (JSON file or base64)
- Application Default Credentials (ADC) support
- Bucket accessibility check on startup
- Public access URLs for uploaded files
- Proper error handling and logging
- Docker support

## Prerequisites

- Node.js 18+ (tested with v24.13.1)
- Google Cloud Storage bucket
- Service account with Storage Object Admin permissions (or appropriate roles)
- Google Cloud SDK (optional, for local development with ADC)

## Installation

1. Clone the repository and navigate to the project directory:
```bash
cd docker-gcp
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
```

4. Edit `.env` with your GCS configuration.

## Configuration

The application supports multiple authentication methods for GCS:

### Method 1: Service Account Key File (Recommended for local dev)
```bash
GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json
GCS_BUCKET_NAME=your-bucket-name
```

### Method 2: Base64 Encoded Service Account Key (Recommended for containers)
```bash
GOOGLE_APPLICATION_CREDENTIALS_BASE64=eyJ0eXBlIjoic2VydmljZV9hY2NvdW50Ii4uLg==
GCS_BUCKET_NAME=your-bucket-name
```

### Method 3: Application Default Credentials (GCP environments like GCE, Cloud Run, GKE)
Leave the credential variables empty and ensure ADC is configured. This is automatic in GCP environments.

## Google Cloud Setup

1. Create a GCS bucket in your Google Cloud project
2. Create a service account with the role "Storage Object Admin" (or minimal required permissions)
3. Download the service account JSON key file and place it in the project root as `service-account-key.json`
4. Ensure the bucket allows public access if you want public URLs (or configure IAM permissions)

## Usage

### Start the server

Development mode (with auto-reload):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

### API Endpoints

| Method | Endpoint | Description | Content-Type |
|---|---|---|---|
| GET | `/health` | Health check | application/json |
| POST | `/upload` | Upload single file to GCS | multipart/form-data |
| POST | `/upload/multiple` | Upload multiple files to GCS | multipart/form-data |
| POST | `/upload/disk` | Upload to local disk (testing) | multipart/form-data |
| DELETE | `/upload/:filename` | Delete file from GCS | application/json |

### Example: Single File Upload

Using cURL:
```bash
curl -X POST \
  http://localhost:3000/upload \
  -F "file=@/path/to/your/image.jpg"
```

Response:
```json
{
  "success": true,
  "message": "File uploaded successfully",
  "fileName": "1234567890-image.jpg",
  "bucket": "your-bucket-name",
  "url": "https://storage.googleapis.com/your-bucket-name/1234567890-image.jpg",
  "publicUrl": "https://storage.googleapis.com/your-bucket-name/1234567890-image.jpg",
  "gcsUri": "gs://your-bucket-name/1234567890-image.jpg",
  "size": "12345",
  "contentType": "image/jpeg"
}
```

### Example: Multiple Files Upload

```bash
curl -X POST \
  http://localhost:3000/upload/multiple \
  -F "file=@/path/to/file1.pdf" \
  -F "file=@/path/to/file2.jpg"
```

### Example: Delete File

```bash
curl -X DELETE http://localhost:3000/upload/1234567890-image.jpg
```

## File Validation

- **Max file size**: Default 50MB (configurable via `MAX_FILE_SIZE_BYTES`)
- **Allowed MIME types**: Configurable via `ALLOWED_MIME_TYPES` (comma-separated, supports wildcards like `image/*`)
- Default allowed: `image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.*,text/plain`

## Testing

Run tests:
```bash
npm test
```

## Docker

Build the image:
```bash
docker build -t fastify-gcs-upload .
```

Run the container:
```bash
docker run -p 3000:3000 \
  -e GCS_BUCKET_NAME=your-bucket-name \
  -e GOOGLE_APPLICATION_CREDENTIALS_BASE64=your_base64_key \
  fastify-gcs-upload
```
