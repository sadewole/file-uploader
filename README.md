# GCP File Upload with Fastify

A comprehensive Fastify application for uploading files to Google Cloud Storage (GCS) with support for multiple upload methods, validation, and flexible configuration.

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

| Method | Endpoint            | Description                    | Content-Type        |
| ------ | ------------------- | ------------------------------ | ------------------- |
| GET    | `/health`           | Health check                   | application/json    |
| POST   | `/upload`           | Upload single file to GCS      | multipart/form-data |
| POST   | `/upload/multiple`  | Upload multiple files to GCS   | multipart/form-data |
| POST   | `/upload/disk`      | Upload to local disk (testing) | multipart/form-data |
| DELETE | `/upload/:filename` | Delete file from GCS           | application/json    |

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

```
export CLOUD_RUN_SERVICE = "file-uploader"
```

METHOD 1: deploy from source (gcs)

```bash
## 1.
gcloud storage buckets add-iam-policy-binding "gs://run-sources-${PROJECT_ID}-${REGION}" \
  --member="serviceAccount:${DEPLOYER_SA_EMAIL}" \
  --role="roles/storage.objectViewer"

## 2. Allow cloud run build permission on SA. (we already added 'run.admin' so adding this is not necessary)
gcloud iam service-accounts add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${DEPLOYER_SA_EMAIL}" \
  --role="roles/run.builder"

## 3. Deploy
gcloud run deploy ${CLOUD_RUN_SERVICE} source . --region="${REGION}" \
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

docker build -t "${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${CLOUD_RUN_SERVICE}$:latest" .
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

> **Note:** The application currently stores uploaded objects as private GCS objects.
> The returned `url` is a standard Cloud Storage URL and requires authentication unless
> you grant public access on the bucket/objects. For public downloads, either grant
> `roles/storage.objectViewer` to `allUsers` at the bucket level (only if your
> organization policy allows it) or switch the service to generate signed URLs.

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
