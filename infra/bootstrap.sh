#!/usr/bin/env bash
# Creates a project (if missing), links billing and makes the Terraform state bucket.
# Run in Google Cloud Shell, once per environment:
#   ./infra/bootstrap.sh <project-id> <billing-account-id>
set -euo pipefail
PROJECT="${1:?project id}"
BILLING="${2:?billing account id, see: gcloud billing accounts list}"
BUCKET="${PROJECT}-tfstate"
REGION="asia-south1"

if ! gcloud projects describe "$PROJECT" >/dev/null 2>&1; then
  echo "Creating project $PROJECT"
  gcloud projects create "$PROJECT" --name="Black Notebook" --labels=firebase=enabled
fi
gcloud billing projects link "$PROJECT" --billing-account="$BILLING" >/dev/null
gcloud services enable serviceusage.googleapis.com cloudresourcemanager.googleapis.com storage.googleapis.com \
  firebase.googleapis.com billingbudgets.googleapis.com --project "$PROJECT"

if ! gcloud storage buckets describe "gs://${BUCKET}" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${BUCKET}" --project "$PROJECT" --location "$REGION" \
    --uniform-bucket-level-access --public-access-prevention
  gcloud storage buckets update "gs://${BUCKET}" --versioning
fi

cat <<NEXT

Project $PROJECT is ready. Next, from the infra folder:

  terraform init -reconfigure -backend-config="bucket=${BUCKET}"
  export GITHUB_TOKEN=<fine-grained token: this repo, Variables read and write>
  terraform apply -var-file=envs/<dev|prod>.tfvars

NEXT
