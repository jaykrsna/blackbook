locals {
  repo        = "${var.github_owner}/${var.github_repo}"
  upper_env   = upper(var.env)
  is_prod     = var.env == "prod"
  auth_domain = var.custom_domain != "" ? var.custom_domain : "${var.project_id}.firebaseapp.com"
  app_url     = var.custom_domain != "" ? "https://${var.custom_domain}" : "https://${var.project_id}.web.app"

  # dev trusts only pushes to main. prod trusts only version tags.
  wif_condition = local.is_prod ? "assertion.repository=='${local.repo}' && assertion.ref.startsWith('refs/tags/v')" : "assertion.repository=='${local.repo}' && assertion.ref=='refs/heads/main'"

  services = [
    "serviceusage.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "firebase.googleapis.com",
    "firebasehosting.googleapis.com",
    "firebaserules.googleapis.com",
    "firebaseinstallations.googleapis.com",
    "firestore.googleapis.com",
    "identitytoolkit.googleapis.com",
    "apikeys.googleapis.com",
    "fcm.googleapis.com",
    "fcmregistrations.googleapis.com",
    "cloudfunctions.googleapis.com",
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudscheduler.googleapis.com",
    "eventarc.googleapis.com",
    "pubsub.googleapis.com",
    "secretmanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "billingbudgets.googleapis.com",
    "monitoring.googleapis.com",
  ]

  deploy_roles = [
    "roles/firebase.admin",
    "roles/cloudfunctions.admin",
    "roles/run.admin",
    "roles/iam.serviceAccountUser",
    "roles/cloudscheduler.admin",
    "roles/secretmanager.admin",
    "roles/artifactregistry.admin",
    "roles/cloudbuild.builds.editor",
    "roles/serviceusage.serviceUsageConsumer",
  ]
}

data "google_project" "this" {
  project_id = var.project_id
}

# ---------- APIs ----------

resource "google_project_service" "apis" {
  provider           = google-beta.bootstrap
  for_each           = toset(local.services)
  project            = var.project_id
  service            = each.key
  disable_on_destroy = false
}

# ---------- Firebase ----------

resource "google_firebase_project" "this" {
  provider   = google-beta
  project    = var.project_id
  depends_on = [google_project_service.apis]
}

resource "google_firebase_web_app" "app" {
  provider     = google-beta
  project      = google_firebase_project.this.project
  display_name = "Black Notebook (${var.env})"
}

data "google_firebase_web_app_config" "app" {
  provider   = google-beta
  project    = google_firebase_project.this.project
  web_app_id = google_firebase_web_app.app.app_id
}

# ---------- Authentication ----------
# Firebase Auth through Identity Platform. Needs the Blaze plan.

resource "google_identity_platform_config" "auth" {
  provider = google-beta
  project  = google_firebase_project.this.project
  authorized_domains = compact([
    "localhost",
    "${var.project_id}.firebaseapp.com",
    "${var.project_id}.web.app",
    var.custom_domain,
  ])
}

# Google sign-in. If no OAuth client is given, enable Google once in the
# Firebase console (Authentication > Sign-in method), which creates the client.
resource "google_identity_platform_default_supported_idp_config" "google" {
  count         = var.google_oauth_client_id == "" ? 0 : 1
  provider      = google-beta
  project       = google_firebase_project.this.project
  idp_id        = "google.com"
  client_id     = var.google_oauth_client_id
  client_secret = var.google_oauth_client_secret
  enabled       = true
  depends_on    = [google_identity_platform_config.auth]
}

# ---------- Firestore ----------
# Rules are deployed by CI (firebase deploy --only firestore), not here,
# so the repo's firestore.rules is the single source of truth.

resource "google_firestore_database" "db" {
  provider                          = google-beta
  project                           = google_firebase_project.this.project
  name                              = "(default)"
  location_id                       = var.region
  type                              = "FIRESTORE_NATIVE"
  delete_protection_state           = "DELETE_PROTECTION_ENABLED"
  point_in_time_recovery_enablement = local.is_prod ? "POINT_IN_TIME_RECOVERY_ENABLED" : "POINT_IN_TIME_RECOVERY_DISABLED"
  deletion_policy                   = "ABANDON"
}

# Daily backups in prod, kept 7 days. They hold ciphertext only.
resource "google_firestore_backup_schedule" "daily" {
  count     = local.is_prod ? 1 : 0
  provider  = google-beta
  project   = var.project_id
  database  = google_firestore_database.db.name
  retention = "604800s"
  daily_recurrence {}
}

# ---------- Hosting ----------
# The default site has the project id as its name. It is created through the
# API and a 409 (already exists) is treated as success, so re-runs are safe.

resource "terraform_data" "hosting_site" {
  triggers_replace = [var.project_id]
  provisioner "local-exec" {
    command = <<-EOT
      code=$(curl -s -o /tmp/site.json -w '%%{http_code}' -X POST \
        -H "Authorization: Bearer $(gcloud auth print-access-token)" \
        -H "x-goog-user-project: ${var.project_id}" \
        -H "Content-Type: application/json" -d '{}' \
        "https://firebasehosting.googleapis.com/v1beta1/projects/${var.project_id}/sites?siteId=${var.project_id}")
      if [ "$code" = "200" ] || [ "$code" = "409" ]; then echo "Hosting site ready ($code)"; else cat /tmp/site.json; exit 1; fi
    EOT
  }
  depends_on = [google_firebase_project.this]
}

resource "google_firebase_hosting_custom_domain" "domain" {
  count                 = var.custom_domain == "" ? 0 : 1
  provider              = google-beta
  project               = var.project_id
  site_id               = var.project_id
  custom_domain         = var.custom_domain
  wait_dns_verification = false
  depends_on            = [terraform_data.hosting_site]
}

# ---------- Secrets (containers only) ----------
# Values are added by you with `firebase functions:secrets:set`, so they
# never pass through Terraform state or GitHub.

resource "google_secret_manager_secret" "secrets" {
  for_each  = toset(["ANTHROPIC_API_KEY", "RESEND_API_KEY"])
  project   = var.project_id
  secret_id = each.key
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

# ---------- Keyless GitHub deploys ----------

resource "google_service_account" "deployer" {
  project      = var.project_id
  account_id   = "github-deployer"
  display_name = "GitHub Actions deployer (${var.env})"
  depends_on   = [google_project_service.apis]
}

resource "google_project_iam_member" "deployer" {
  for_each = toset(local.deploy_roles)
  project  = var.project_id
  role     = each.key
  member   = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  depends_on                = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-${var.env}"
  display_name                       = "GitHub ${var.env}"
  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }
  attribute_condition = local.wif_condition
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "github_can_deploy" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${local.repo}"
}

# ---------- Budget alert ----------

resource "google_monitoring_notification_channel" "email" {
  project      = var.project_id
  display_name = "Budget alerts (${var.env})"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }
  depends_on = [google_project_service.apis]
}

resource "google_billing_budget" "monthly" {
  billing_account = var.billing_account
  display_name    = "Black Notebook ${var.env}"
  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
  }
  amount {
    specified_amount {
      currency_code = var.budget_currency
      units         = tostring(var.monthly_budget)
    }
  }
  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }
  all_updates_rule {
    monitoring_notification_channels = [google_monitoring_notification_channel.email.id]
  }
  depends_on = [google_project_service.apis]
}

# ---------- GitHub Actions variables ----------
# Public config only. Never secrets.

locals {
  github_variables = {
    "${local.upper_env}_FIREBASE_PROJECT_ID"    = var.project_id
    "${local.upper_env}_WIF_PROVIDER"           = google_iam_workload_identity_pool_provider.github.name
    "${local.upper_env}_DEPLOY_SA"              = google_service_account.deployer.email
    "${local.upper_env}_FB_API_KEY"             = data.google_firebase_web_app_config.app.api_key
    "${local.upper_env}_FB_AUTH_DOMAIN"         = local.auth_domain
    "${local.upper_env}_FB_MESSAGING_SENDER_ID" = data.google_firebase_web_app_config.app.messaging_sender_id
    "${local.upper_env}_FB_APP_ID"              = google_firebase_web_app.app.app_id
    "${local.upper_env}_APP_URL"                = local.app_url
  }
}

resource "github_actions_variable" "vars" {
  for_each      = var.manage_github_variables ? local.github_variables : {}
  repository    = var.github_repo
  variable_name = each.key
  value         = each.value
}

resource "github_actions_variable" "vapid" {
  count         = var.manage_github_variables && var.vapid_key != "" ? 1 : 0
  repository    = var.github_repo
  variable_name = "${local.upper_env}_FB_VAPID_KEY"
  value         = var.vapid_key
}
