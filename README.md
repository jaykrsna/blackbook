# Black Notebook

A 90-day self-review PWA. One honest audit, three monthly phases, a daily check-in, and **Saakshi**, a reviewer that judges only the evidence every 15 days.

Live target: `https://bb.jay.im`

## What is in here

| Folder | What it is |
| --- | --- |
| `web/` | React + TypeScript PWA (Vite). Encryption, screens, scores, push. |
| `functions/` | Cloud Functions: Saakshi relay, goal gate, reminder scheduler. |
| `firestore.rules` | Every user owns only `users/{uid}`, and content must be encrypted. |
| `firebase.json` | Hosting, Firestore (asia-south1) and Functions config. |

## Security model

**Content is end-to-end encrypted.** Audit answers, plans, commitments, goals, check-ins, notes, metrics and reviews are encrypted on the device with AES-256-GCM before they reach Firestore.

- A random 256-bit data key encrypts everything. It is stored only wrapped: once by a key derived from the user's passphrase (PBKDF2-SHA256, 600,000 iterations), once by a 32-byte recovery key shown at setup.
- The passphrase, recovery key and unwrapped data key never leave the device.
- Each ciphertext is bound to its document path, so the server cannot swap documents.
- "Keep this device unlocked" stores the key in IndexedDB as non-extractable: the browser can use it, no script can read it out.
- Firestore rules reject any sensitive document that is not an encrypted envelope.

**What the operator can see (plaintext metadata, needed for reminders):** email address, timezone, reminder time, push tokens, cycle start date, which dates have a check-in, how many reviews are done, which phases exist, and review day numbers. Not one word of content.

**Saakshi and the honest limit.** AI review needs the text. The device decrypts the 15 days, computes the scores, and sends one request to the `saakshiReview` function, which forwards it to the Claude API and returns the answer. The function stores nothing and logs only uid, timing and verdict. The device encrypts the answer before saving it.
This means the operator cannot read anything at rest, but whoever controls the function code could change it to capture requests in transit. Keep the function code reviewed, and confirm the AI provider's data retention terms before other users join.

**Lost passphrase and recovery key = lost data.** Nobody can reset it. That is the point.

## Setup

1. Create two Firebase projects (dev and live). Upgrade both to **Blaze** and set a budget alert at ₹500.
2. Firestore: create the database in **asia-south1**. The region cannot be changed later.
3. Authentication: enable **Google**. Add `bb.jay.im` to authorised domains.
4. Hosting: add custom domain `bb.jay.im` and create the DNS records it shows at the jay.im registrar.
5. Cloud Messaging: generate a **Web Push certificate** (VAPID key).
6. Copy `web/.env.example` to `web/.env.production` and fill in the web config and VAPID key. Set `VITE_FB_AUTH_DOMAIN=bb.jay.im` so the Google sign-in page shows your domain.
7. Secrets and params:
   ```bash
   firebase functions:secrets:set ANTHROPIC_API_KEY
   firebase functions:secrets:set RESEND_API_KEY
   ```
   Optional params (asked on first deploy): `AI_MODEL` (default `claude-sonnet-5-5`), `EMAIL_FROM`, `APP_URL`.
8. Email: verify `jay.im` in Resend and add the SPF and DKIM records it gives you.
9. App Check (recommended): register the web app with reCAPTCHA Enterprise, then deploy functions with `ENFORCE_APP_CHECK=true`.
10. Deploy:
    ```bash
    cd web && npm ci && npm run build && cd ..
    cd functions && npm ci && cd ..
    firebase use default
    firebase deploy
    ```

## Develop and test

```bash
cd web && npm install && npm test        # crypto and scores: 14 tests
cd functions && npm install && npm test  # reminders and AI parsing: 11 tests
cd web && npm run dev                    # needs web/.env.local
# Firestore rules, needs Java and Node 24:
npx firebase-tools@15 emulators:exec --only firestore --project demo-blackbook "npm --prefix rules-tests test"
```

## Automated deploys (GitHub Actions)

| Event | What runs | Where it goes |
| --- | --- | --- |
| Pull request | Web tests and build, functions tests, Firestore rules tests in the emulator | Nowhere |
| Push to `main` | All tests, then deploy hosting, rules and functions | Dev project |
| Push a tag like `v1.0.0` | All tests, then deploy | Production (bb.jay.im) |

Deploys are keyless (Workload Identity Federation). No service account key exists anywhere.
The production provider only trusts `refs/tags/v*`, so nothing on `main` can reach production.

Release to production:
```bash
git tag v1.0.0 && git push origin v1.0.0
```

### One-time setup (infrastructure as code)

Everything in Google Cloud and Firebase is created by Terraform in `infra/`: APIs, Firebase, the web app, Authentication and authorised domains, Firestore in asia-south1 (delete protection, daily backups and point-in-time recovery in prod), the Hosting site and custom domain, Secret Manager containers, the keyless GitHub deploy identity, a budget alert, and the GitHub Actions variables.

Run in Google Cloud Shell, once per environment:

```bash
git clone https://github.com/<you>/black-notebook && cd black-notebook
gcloud billing accounts list                      # copy the billing account id
./infra/bootstrap.sh <dev-project-id> <billing-account-id>
cd infra
# edit envs/dev.tfvars (project id, GitHub username, billing account, email)
terraform init -reconfigure -backend-config="bucket=<dev-project-id>-tfstate"
export GITHUB_TOKEN=<fine-grained token for this repo with Variables: read and write>
terraform apply -var-file=envs/dev.tfvars
```

Repeat with `prod` and `envs/prod.tfvars`. Terraform prints `manual_steps_left`. Three things have no API and stay manual:

1. Enable **Google** in Firebase console, Authentication, Sign-in method (or pass an OAuth client to Terraform).
2. Generate the **Web Push key** in Project settings, Cloud Messaging. Put it in `vapid_key` and apply again.
3. Set the secrets: `firebase functions:secrets:set ANTHROPIC_API_KEY --project <id>` and the same for `RESEND_API_KEY`.

For prod, add the `dns_records_to_add` output at your DNS provider for bb.jay.im.

Finally, protect `main` in GitHub so changes arrive by pull request with CI green.

## Reminders

`reminders` runs every 15 minutes and works only from metadata.

| Reminder | When (user's time) | Channel | Skipped if |
| --- | --- | --- | --- |
| Daily nudge | Reminder time | Push, or email if no push | Today's check-in exists |
| Review due | Reminder time, from the review day until done | Push and email | Review saved |
| Missed two days | 10:00 | Push and email | Check-in arrives |
| Month 2 or 3 setup | 09:00, days 31 to 33 and 61 to 63 | Push and email | Phase exists |
| Cycle complete | Reminder time, days 91 to 97, once | Push and email | Already sent |

Messages never contain anything the user wrote.
