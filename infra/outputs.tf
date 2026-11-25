output "github_variables" {
  description = "Repository variables for GitHub Actions (already written if manage_github_variables = true)"
  value       = local.github_variables
}

output "dns_records_to_add" {
  description = "DNS records Firebase Hosting needs for the custom domain"
  value       = var.custom_domain == "" ? null : google_firebase_hosting_custom_domain.domain[0].required_dns_updates
}

output "manual_steps_left" {
  value = compact([
    var.google_oauth_client_id == "" ? "Enable Google in Firebase console > Authentication > Sign-in method" : "",
    var.vapid_key == "" ? "Generate the Web Push key in Firebase console > Project settings > Cloud Messaging, then re-apply with vapid_key set" : "",
    "Set secrets: firebase functions:secrets:set ANTHROPIC_API_KEY --project ${var.project_id} (and RESEND_API_KEY)",
    var.custom_domain == "" ? "" : "Add the dns_records_to_add at your DNS provider for ${var.custom_domain}",
  ])
}
