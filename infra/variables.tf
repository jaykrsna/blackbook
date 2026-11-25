variable "env" {
  description = "dev or prod"
  type        = string
  validation {
    condition     = contains(["dev", "prod"], var.env)
    error_message = "env must be dev or prod."
  }
}

variable "project_id" {
  description = "Firebase / Google Cloud project id (created by infra/bootstrap.sh)"
  type        = string
}

variable "region" {
  description = "Region for Firestore, Functions and Scheduler"
  type        = string
  default     = "asia-south1"
}

variable "custom_domain" {
  description = "Custom domain for Hosting, empty for none (dev uses the web.app address)"
  type        = string
  default     = ""
}

variable "github_owner" {
  description = "GitHub user or org that owns the repo"
  type        = string
}

variable "github_repo" {
  description = "Repository name, without the owner"
  type        = string
  default     = "black-notebook"
}

variable "manage_github_variables" {
  description = "Write the Actions variables into the repo (needs GITHUB_TOKEN with admin on the repo)"
  type        = bool
  default     = true
}

variable "billing_account" {
  description = "Billing account id (XXXXXX-XXXXXX-XXXXXX), used for the budget alert"
  type        = string
}

variable "monthly_budget" {
  description = "Monthly budget alert amount, in the billing account currency"
  type        = number
  default     = 500
}

variable "budget_currency" {
  description = "Must match the billing account currency"
  type        = string
  default     = "INR"
}

variable "alert_email" {
  description = "Email for budget alerts"
  type        = string
}

variable "google_oauth_client_id" {
  description = "OAuth client id for Google sign-in. Leave empty to enable Google sign-in once in the Firebase console instead."
  type        = string
  default     = ""
}

variable "google_oauth_client_secret" {
  description = "OAuth client secret for Google sign-in. Pass with TF_VAR_google_oauth_client_secret, never in a file."
  type        = string
  default     = ""
  sensitive   = true
}

variable "vapid_key" {
  description = "Web Push public key from Firebase console > Cloud Messaging > Web Push certificates (no API exists to generate it)"
  type        = string
  default     = ""
}
