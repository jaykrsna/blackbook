terraform {
  required_version = ">= 1.6"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.0, < 8.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = ">= 6.0, < 8.0"
    }
    github = {
      source  = "integrations/github"
      version = ">= 6.0, < 7.0"
    }
  }
  # Bucket is passed at init: terraform init -backend-config="bucket=<project-id>-tfstate"
  backend "gcs" {
    prefix = "blackbook"
  }
}

# Everything inside the project. Quota and billing checks run against the project itself.
provider "google-beta" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}

provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}

# Only for enabling APIs (before the project can bill quota to itself).
provider "google-beta" {
  alias                 = "bootstrap"
  project               = var.project_id
  user_project_override = false
}

# Optional: writes the GitHub Actions variables. Reads GITHUB_TOKEN from the environment.
provider "github" {
  owner = var.github_owner
}
