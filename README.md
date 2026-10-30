# GCP File Upload with Fastify

A comprehensive Fastify application for uploading files to Google Cloud Storage (GCS) with support for multiple upload methods, validation, and flexible configuration.

## Features

- Server-side multipart uploads (single and multiple files)
- Direct-to-GCS signed uploads with a quarantine + verification step
- Signed download URLs for private objects
- Magic-byte content validation (not just the client-provided `Content-Type`)
- Filename sanitization, UUID object names, and SHA-256/CRC checksums
- Optional API-key authentication and per-IP rate limiting
- CORS support for browser clients
- Cloud Run deployment via GitHub Actions and Workload Identity Federation

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

### Application environment variables

| Variable                     | Default                              | Description                                                               |
| ---------------------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| `PORT`                       | `3000` (`8080` in the container)     | HTTP port                                                                 |
| `HOST`                       | `0.0.0.0`                            | Bind address                                                              |
| `NODE_ENV`                   | `development`                        | `production` disables `/upload/disk`                                      |
| `GCS_BUCKET_NAME`            | —                                    | Bucket for uploads (required)                                             |
| `GCS_PROJECT_ID`             | from credentials                     | Google Cloud project                                                      |
| `MAX_FILE_SIZE_BYTES`        | `52428800` (50 MiB)                  | Server-side multipart limit; Cloud Run caps requests at ~32 MiB           |
| `MAX_SIGNED_UPLOAD_BYTES`    | `1073741824` (1 GiB)                 | Maximum size for a direct signed upload                                   |
| `MAX_FILES`                  | `10`                                 | Maximum files in `/upload/multiple`                                       |
| `ALLOWED_MIME_TYPES`         | `image/*,application/pdf,text/plain` | Comma-separated MIME types/patterns; wildcards like `image/*` are allowed |
| `UPLOAD_DIR`                 | `./uploads`                          | Local directory for `/upload/disk`                                        |
| `UPLOAD_PREFIX`              | `uploads`                            | GCS prefix for managed objects                                            |
| `QUARANTINE_PREFIX`          | `quarantine`                         | GCS prefix for direct-upload staging                                      |
| `STRICT_TYPE_CHECK`          | `true`                               | Set `false` to skip magic-byte validation                                 |
| `AUTH_MODE`                  | `none`                               | `none` or `api-key`                                                       |
| `API_KEYS`                   | —                                    | Comma-separated API keys; required when `AUTH_MODE=api-key`               |
| `CORS_ORIGINS`               | —                                    | Comma-separated browser origins; empty disables CORS                      |
| `RATE_LIMIT_MAX`             | `100`                                | Global requests per window, per instance                                  |
| `RATE_LIMIT_WINDOW_MS`       | `60000`                              | Rate-limit window in milliseconds                                         |
| `RATE_LIMIT_UPLOAD_MAX`      | `20`                                 | Upload-route requests per window, per instance                            |
| `SIGNED_URL_EXPIRES_SECONDS` | `900`                                | Signed upload/download URL lifetime                                       |

## Google Cloud Setup

1. Create a GCS bucket in your Google Cloud project
2. Create a service account with the role "Storage Object Admin" (or minimal required permissions)
3. Download the service account JSON key file and place it in the project root as `service-account-key.json`
4. Keep the bucket private. Downloads use signed URLs, which require the service account to
   have `roles/iam.serviceAccountTokenCreator` on itself so it can sign URLs with
   `signBlob`. Public bucket access is not required.

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

| Method | Endpoint             | Description                                      | Content-Type        |
| ------ | -------------------- | ------------------------------------------------ | ------------------- |
| GET    | `/health`            | Health check (always public)                     | application/json    |
| POST   | `/upload`            | Upload one file to GCS through the server        | multipart/form-data |
| POST   | `/upload/multiple`   | Upload multiple files to GCS through the server  | multipart/form-data |
| POST   | `/upload/disk`       | Save to local disk (development only)            | multipart/form-data |
| POST   | `/upload/signed-url` | Create a signed GCS URL for a quarantine upload  | application/json    |
| POST   | `/upload/verify`     | Validate a quarantine upload and promote it      | application/json    |
| GET    | `/upload/signed-url` | Create a signed download URL for a stored object | application/json    |
| DELETE | `/upload/*`          | Delete a managed object from GCS                 | application/json    |

Object keys are generated by the server (`uploads/<yyyy>/<mm>/<uuid>.<ext>` by default) and
quarantine uploads use `quarantine/<uuid>.<ext>`. Client-provided filenames are only kept
as metadata (`originalName`) and in the `Content-Disposition` header.

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
  "fileName": "uploads/2026/10/6f1c2b9e-2a4d-4f0e-9a7c-1b2c3d4e5f60.jpg",
  "bucket": "your-bucket-name",
  "gcsUri": "gs://your-bucket-name/uploads/2026/10/6f1c2b9e-2a4d-4f0e-9a7c-1b2c3d4e5f60.jpg",
  "size": 12345,
  "contentType": "image/jpeg",
  "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "originalName": "image.jpg"
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

The delete route accepts the full managed object key. Keys outside the configured upload
prefix are rejected, so it cannot be used to delete arbitrary bucket objects.

```bash
curl -X DELETE \
  "http://localhost:3000/upload/uploads/2026/10/6f1c2b9e-2a4d-4f0e-9a7c-1b2c3d4e5f60.jpg"
```

### Authentication

Authentication is disabled by default (`AUTH_MODE=none`). To require an API key:

```bash
AUTH_MODE=api-key
API_KEYS=key-one,key-two
```

When enabled, the service fails to start if `API_KEYS` is empty. Send the key with either
header:

```bash
curl -H "x-api-key: ${API_KEY}" ...
curl -H "Authorization: Bearer ${API_KEY}" ...
```

`GET /health` is always public so Cloud Run health checks keep working. All other routes,
including signed URL creation, verification, and deletion, require a key. The signed GCS
URLs themselves are bearer capabilities and do not require the API key.

For Cloud Run, store the keys in Secret Manager rather than in plain environment
variables:

```bash
printf '%s' "${API_KEYS}" | gcloud secrets create file-upload-api-keys --data-file=-

gcloud secrets add-iam-policy-binding file-upload-api-keys \
  --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"

gcloud run services update "${CLOUD_RUN_SERVICE}" \
  --region="${REGION}" \
  --update-env-vars="AUTH_MODE=api-key" \
  --update-secrets="API_KEYS=file-upload-api-keys:latest"
```

The deploy workflow uses `--update-env-vars`, which preserves existing variables and
secret bindings, so this only needs to be configured once.

### Rate limiting

Rate limiting is enabled per Cloud Run instance and keyed by the client IP
(`trustProxy` is on so `X-Forwarded-For` from the Google front end is used). Upload routes
have a stricter limit than the rest of the API.

```bash
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_UPLOAD_MAX=20
```

`RATE_LIMIT_WINDOW_MS` applies to both the global and upload-route limits.
Limits are per instance, not global. With multiple Cloud Run instances the effective
limit is `instances × limit`. For a global limit, use Memorystore/Redis as the rate-limit
store.

### Direct uploads with signed URLs

Cloud Run rejects HTTP requests larger than about 32 MiB. For larger files, upload
directly to GCS with a signed URL, then ask the service to verify the object before it is
promoted into the managed upload prefix.

1. Create a signed upload URL:

```bash
curl -X POST "https://your-service.run.app/upload/signed-url" \
  -H "x-api-key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"filename":"video.mp4","contentType":"video/mp4"}'
```

```json
{
  "success": true,
  "fileName": "quarantine/6f1c2b9e-2a4d-4f0e-9a7c-1b2c3d4e5f60.mp4",
  "originalName": "video.mp4",
  "contentType": "video/mp4",
  "maxSize": 1073741824,
  "method": "PUT",
  "uploadUrl": "https://storage.googleapis.com/...",
  "headers": {
    "Content-Type": "video/mp4",
    "x-goog-content-length-range": "0,1073741824"
  },
  "expiresAt": "2026-10-23T12:30:00.000Z",
  "verify": {
    "method": "POST",
    "path": "/upload/verify",
    "body": {
      "key": "quarantine/6f1c2b9e-2a4d-4f0e-9a7c-1b2c3d4e5f60.mp4",
      "filename": "video.mp4"
    }
  }
}
```

2. Upload the file directly to GCS with the returned URL and headers:

```bash
curl -X PUT "${UPLOAD_URL}" \
  -H "Content-Type: video/mp4" \
  -H "x-goog-content-length-range: 0,1073741824" \
  --data-binary @video.mp4
```

The `x-goog-content-length-range` header is enforced by GCS; the client must send the same
value that the API returned.

3. Verify and promote the object:

```bash
curl -X POST "https://your-service.run.app/upload/verify" \
  -H "x-api-key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"key":"quarantine/6f1c2b9e-2a4d-4f0e-9a7c-1b2c3d4e5f60.mp4","filename":"video.mp4"}'
```

Verification reads the first bytes of the object, checks the detected type against the
allowlist, checks the size, copies the object to
`uploads/<yyyy>/<mm>/<uuid>.<ext>`, copies the checksum metadata, and deletes the
quarantine object. Invalid objects are deleted. Abandoned quarantine uploads are removed
by the GCS lifecycle rule described below.

4. Create a signed download URL for a managed object:

```bash
curl "https://your-service.run.app/upload/signed-url?key=uploads/2026/10/6f1c2b9e-2a4d-4f0e-9a7c-1b2c3d4e5f60.mp4" \
  -H "x-api-key: ${API_KEY}"
```

Signed URLs require the runtime service account to have
`roles/iam.serviceAccountTokenCreator` on itself so it can call `signBlob`:

```bash
gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_SA_EMAIL}" \
  --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
  --role="roles/iam.serviceAccountTokenCreator"
```

For browser uploads, configure CORS on the bucket (edit the origin first):

```bash
gcloud storage buckets update "gs://${BUCKET_NAME}" \
  --cors-file=docs/gcs-cors.json
```

Add a lifecycle rule to clean up abandoned quarantine objects after one day:

```bash
gcloud storage buckets update "gs://${BUCKET_NAME}" \
  --lifecycle-file=docs/gcs-lifecycle.json
```

### Upload validation and hardening

- Uploads are validated by magic bytes with `file-type`, not only by the declared
  `Content-Type`. A detected type must be in `ALLOWED_MIME_TYPES` and must match the
  declared type, unless the client sends `application/octet-stream`.
- Text-like formats that cannot be detected (`text/*`, JSON, XML, CSV, NDJSON) are allowed
  when they are in the allowlist. Other undetectable binary content is rejected with 415.
- Filenames are sanitized for use in `Content-Disposition`. Object keys are generated from
  UUIDs; the original name is stored as metadata only.
- Streamed uploads compute SHA-256, and GCS also stores `md5Hash`/`crc32c`. Failed uploads
  delete the partial object.
- Set `STRICT_TYPE_CHECK=false` only if you intentionally need to skip magic-byte
  validation.

## Docker

Build the image:

```bash
docker build -t fastify-gcs-upload .
```

Run the container:

```bash
docker run -p 8080:8080 \
  -e GCS_BUCKET_NAME=your-bucket-name \
  -e GOOGLE_APPLICATION_CREDENTIALS_BASE64=your_base64_key \
  fastify-gcs-upload
```

The image is a multi-stage build that runs as the non-root `node` user and listens on
`PORT` (defaults to `8080`, which Cloud Run sets automatically).

## CI/CD

Two GitHub Actions workflows are included:

| Workflow | File                           | Trigger                                                     | Purpose                                                                         |
| -------- | ------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| CI       | `.github/workflows/ci.yml`     | Pull requests to `main` (and called by the deploy workflow) | Installs dependencies, runs lint and tests, validates the Docker build          |
| Deploy   | `.github/workflows/deploy.yml` | Pushes to `main`, manual dispatch                           | Runs CI, builds and pushes the image to Artifact Registry, deploys to Cloud Run |

The deploy workflow authenticates with **Workload Identity Federation (WIF)**. No
long-lived service account keys are stored in GitHub.

On every push to `main`, the image is tagged with the commit SHA and deployed. You can
also run the workflow manually (`workflow_dispatch`) and optionally pass an existing
`image_tag` to redeploy a previously built image without rebuilding.

### 1. Enable APIs

```bash
export PROJECT_ID="your-project-id"
export REGION="us-central1"

gcloud config set project "${PROJECT_ID}"

gcloud services enable \
  run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  iamcredentials.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com
```

### 3. Create the runtime service account

This is the identity the Cloud Run service uses at runtime. It needs access to the bucket.

```bash
export RUNTIME_SA="file-upload-runtime"
export RUNTIME_SA_EMAIL="${RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
export BUCKET_NAME="your-bucket-name"

gcloud iam service-accounts create "${RUNTIME_SA}" \
  --display-name="Cloud Run file upload runtime"

# Create the bucket if it does not exist yet
gcloud storage buckets create "gs://${BUCKET_NAME}" \
  --location="${REGION}" \
  --uniform-bucket-level-access

# Allow the runtime service account to manage objects in the bucket
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET_NAME}" \
  --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
  --role="roles/storage.objectAdmin"

# Allows the startup bucket accessibility check (bucket.exists) to succeed
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET_NAME}" \
  --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
  --role="roles/storage.bucketViewer"

# Required for V4 signed URL generation (signBlob) when running without a key file
gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_SA_EMAIL}" \
  --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
  --role="roles/iam.serviceAccountTokenCreator"

# Allow Cloud Run to pull the image from Artifact Registry
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
  --role="roles/artifactregistry.reader"
```

The application uses Application Default Credentials inside Cloud Run, so do **not**
set `GOOGLE_APPLICATION_CREDENTIALS` there. The runtime service account is attached
to the Cloud Run service by the deploy workflow.

### 4. Create the deployer service account

This is the identity GitHub Actions impersonates to push images and deploy Cloud Run.

```bash
export DEPLOYER_SA="github-deployer"
export DEPLOYER_SA_EMAIL="${DEPLOYER_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts create "${DEPLOYER_SA}" \
  --display-name="GitHub Actions deployer"

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${DEPLOYER_SA_EMAIL}" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${DEPLOYER_SA_EMAIL}" \
  --role="roles/run.admin"

# Required to deploy a service that runs as the runtime service account
gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_SA_EMAIL}" \
  --member="serviceAccount:${DEPLOYER_SA_EMAIL}" \
  --role="roles/iam.serviceAccountUser"
```

### 5. Deploy to Cloud Run

```bash
export CLOUD_RUN_SERVICE="file-uploader"
```

METHOD 1: deploy from source (GCS)

```bash
## 1. Allow the deployer to read Cloud Run source uploads
gcloud storage buckets add-iam-policy-binding "gs://run-sources-${PROJECT_ID}-${REGION}" \
  --member="serviceAccount:${DEPLOYER_SA_EMAIL}" \
  --role="roles/storage.objectViewer"

## 2. Allow Cloud Run builds (run.admin already covers this)
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${DEPLOYER_SA_EMAIL}" \
  --role="roles/run.builder"

## 3. Deploy
gcloud run deploy "${CLOUD_RUN_SERVICE}" --source . --region="${REGION}" \
  --service-account="${RUNTIME_SA_EMAIL}" \
  --build-service-account="projects/${PROJECT_ID}/serviceAccounts/${DEPLOYER_SA_EMAIL}" \
  --set-env-vars "NODE_ENV=production,GCS_BUCKET_NAME=YOUR_BUCKET,GCS_PROJECT_ID=YOUR_PROJECT_ID" \
  --allow-unauthenticated --min-instances=0 --max-instances=10 --memory=512Mi
```

METHOD 2 (Alternative): deploy from build/push container image

```bash
export REPO="cloud-run-container-deploy"

gcloud artifacts repositories create "${REPO}" \
  --repository-format=docker \
  --location="${REGION}" \
  --description="Container images for the file upload service"

gcloud auth configure-docker "${REGION}-docker.pkg.dev"

docker build -t "${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${CLOUD_RUN_SERVICE}:latest" .
docker push "${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${CLOUD_RUN_SERVICE}:latest"

gcloud run deploy "${CLOUD_RUN_SERVICE}" --image "${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${CLOUD_RUN_SERVICE}:latest" \
  --region "${REGION}" --service-account "${RUNTIME_SA_EMAIL}" \
  --set-env-vars "NODE_ENV=production,GCS_BUCKET_NAME=YOUR_BUCKET"
```

### 6. Configure Workload Identity Federation for GitHub

```bash
export GITHUB_ORG="your-github-org"
export GITHUB_REPO="your-repo-name"
export POOL="github-pool"
export PROVIDER="github-provider"

gcloud iam workload-identity-pools create "${POOL}" \
  --location="global" \
  --display-name="GitHub Actions pool"

gcloud iam workload-identity-pools providers create-oidc "${PROVIDER}" \
  --location="global" \
  --workload-identity-pool="${POOL}" \
  --display-name="GitHub OIDC" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository == '${GITHUB_ORG}/${GITHUB_REPO}'"

export PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"

gcloud iam service-accounts add-iam-policy-binding "${DEPLOYER_SA_EMAIL}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${GITHUB_ORG}/${GITHUB_REPO}"
```

Get the provider resource name for the workflow secret:

```bash
gcloud iam workload-identity-pools providers describe "${PROVIDER}" \
  --location="global" \
  --workload-identity-pool="${POOL}" \
  --format='value(name)'
```

### 7. Configure GitHub repository secrets and variables

Create these **secrets** (`Settings → Secrets and variables → Actions → Secrets`):

| Secret                           | Description                                            |
| -------------------------------- | ------------------------------------------------------ |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Full provider resource name from step 5                |
| `GCP_DEPLOY_SERVICE_ACCOUNT`     | Deployer service account email (`github-deployer@...`) |

Create these **variables** (`Settings → Secrets and variables → Actions → Variables`):

| Variable                    | Required | Description                                                                                              |
| --------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `GCP_PROJECT_ID`            | Yes      | Google Cloud project ID                                                                                  |
| `GCP_REGION`                | Yes      | Cloud Run region, e.g. `us-central1`                                                                     |
| `ARTIFACT_REGISTRY_REPO`    | Yes      | Name of the **existing** Artifact Registry repository                                                    |
| `CLOUD_RUN_SERVICE`         | Yes      | Name of the **existing** Cloud Run service                                                               |
| `GCS_BUCKET_NAME`           | Yes      | Bucket where uploads are stored                                                                          |
| `ARTIFACT_REGISTRY_REGION`  | No       | Registry region if different from `GCP_REGION` (defaults to `GCP_REGION`)                                |
| `ARTIFACT_REGISTRY_IMAGE`   | No       | Image name inside the repository if different from `CLOUD_RUN_SERVICE` (defaults to `CLOUD_RUN_SERVICE`) |
| `CLOUD_RUN_SERVICE_ACCOUNT` | No       | Runtime service account email. If unset, the existing service identity is preserved                      |
| `RUN_ALLOW_UNAUTHENTICATED` | No       | `true`/`false` to force public access; leave unset to preserve the existing setting                      |
| `MAX_FILE_SIZE_BYTES`       | No       | Upload size limit (defaults to the app default, `52428800`)                                              |
| `ALLOWED_MIME_TYPES`        | No       | Comma-separated MIME patterns (defaults to the app default)                                              |
| `CLOUD_RUN_MEMORY`          | No       | Override memory (e.g. `512Mi`); unset preserves the existing setting                                     |
| `CLOUD_RUN_CPU`             | No       | Override CPU; unset preserves the existing setting                                                       |
| `CLOUD_RUN_MIN_INSTANCES`   | No       | Override min instances; unset preserves the existing setting                                             |
| `CLOUD_RUN_MAX_INSTANCES`   | No       | Override max instances; unset preserves the existing setting                                             |
| `CLOUD_RUN_TIMEOUT`         | No       | Override request timeout in seconds; unset preserves the existing setting                                |
| `CLOUD_RUN_PORT`            | No       | Override container port; unset preserves the existing setting                                            |

### 8. Existing Cloud Run deployments

The workflow is designed to update an **existing** service in place; it does not create
a parallel service or registry. To reuse what you already have:

- Set `CLOUD_RUN_SERVICE`, `GCP_PROJECT_ID`, and `GCP_REGION` to the values of the
  service you already deployed.
- Set `ARTIFACT_REGISTRY_REPO` to the existing repository name. If the image inside the
  repository is not named after the service, also set `ARTIFACT_REGISTRY_IMAGE`.
  The resulting image path is
  `${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${IMAGE}:${COMMIT_SHA}`.
- If the registry lives in a different region than Cloud Run, set
  `ARTIFACT_REGISTRY_REGION`.
- If you already configured Workload Identity Federation and a deployer service
  account, skip step 5 and just add the existing provider and service account as the
  two GitHub secrets.
- Leave `CLOUD_RUN_SERVICE_ACCOUNT`, memory/CPU/scaling/timeout/port, and
  `RUN_ALLOW_UNAUTHENTICATED` unset to preserve the values already configured on the
  service. Set them only when you want the workflow to change those settings.
- The workflow uses `--update-env-vars`, so other environment variables already on the
  service are preserved. Only `NODE_ENV`, `GCS_PROJECT_ID`, `GCS_BUCKET_NAME`, and
  optionally `MAX_FILE_SIZE_BYTES` / `ALLOWED_MIME_TYPES` are updated.
- Disable any other pipeline (for example an existing Cloud Build trigger) that deploys
  the same service, otherwise the two pipelines will race.

> **Note:** Objects are stored as private GCS objects. Generate a short-lived signed
> download URL with `GET /upload/signed-url` instead of making the bucket public. The
> runtime service account needs `roles/iam.serviceAccountTokenCreator` on itself (see
> step 3) for signing to work on Cloud Run.

### Manual deploy

The workflows are the recommended path, but the equivalent manual deploy is:

```bash
gcloud run deploy file-upload \
  --image="${REGION}-docker.pkg.dev/${PROJECT_ID}/docker-gcp/file-upload:<commit-sha>" \
  --region="${REGION}" \
  --service-account="${RUNTIME_SA_EMAIL}" \
  --update-env-vars="GCS_BUCKET_NAME=${BUCKET_NAME},GCS_PROJECT_ID=${PROJECT_ID}" \
  --allow-unauthenticated
```

Use `--set-env-vars` only if you intentionally want to replace all existing plain
environment variables.
