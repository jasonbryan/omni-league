# 0011: Transactional email for verification and password reset

- **Status:** Accepted
- **Gate:** `gate:technology`
- **Issue:** #26
- **Date:** 2026-10-08 (pricing, docs, terms, and npm registry checked 2026-10-07; merging the PR is the owner's acceptance)

## Context

ADR 0008 (Accepted) chose Better Auth through `@convex-dev/better-auth`, with email + password and Google. Sign-in sends no email. Before the first production release, Better Auth's `emailVerification.sendVerificationEmail` and `emailAndPassword.sendResetPassword` callbacks must reach a transactional email sender ("Deferred until #26" in ADR 0008). This ADR picks that sender, how Convex calls it, the sending domain, what dev and preview do, how failures are noticed, and how the key is held.

Scope: verification and password-reset email only. Whether the slice uses links or `emailOTP` codes does not change anything here. Later product notifications reuse the sender but are planned as their own features.

### Owner answers and requirements (settled)

From `docs/product/requirements.md` (PR #27, merged) and the owner's answers on #7:

1. **Domain:** a project-owned domain is bought **before the first production release**, and the purchase is deferred until then. No project-owned sending domain is needed during development.
2. **Verification and reset email** are added before the first production release.
3. **Budgets:** the auth provider's free tier at launch (#7); about $25/month for hosting and Convex combined (#9). Neither covers an email sender.
4. **Domain for the app:** the host's default domain until the first production release (#9).

### Assumptions taken from other decisions

**If any row below changes before this ADR is merged, or if #9 or #15 decide differently, this ADR is revised to match.**

| Source | Assumption used here | Where it matters |
| --- | --- | --- |
| ADR 0008, auth (`docs/decisions/0008-auth-provider.md`, #7; Accepted on `main`; PR #25) | `better-auth` 1.6.x through `@convex-dev/better-auth` 0.12.x. The verification and reset slice turns on `requireEmailVerification: true` (unverified password users get `403 EMAIL_NOT_VERIFIED`), `sendOnSignUp: true`, `sendResetPassword`, `revokeSessionsOnPasswordReset: true`, and a scheduled deletion of password accounts still unverified 7 days after sign-up. Per-IP limiting is `rateLimit: { enabled: !IS_TEST, storage: "database" }` and depends on a trustworthy `cf-connecting-ip` header, which the first sign-in feature verifies. If it cannot, the per-IP limiter is turned off. Volume is 0.5 emails per MAU per month. Google sign-in for an address that has an **unverified** password account is refused (`account not linked`). | Callbacks, limits, cap behaviour, cost |
| ADR 0005, e2e (`docs/decisions/0005-e2e-and-accessibility-testing.md`, #4; merged in PR #17) | E2E runs on the anonymous local backend with no secrets. Test-only functions are internal and guarded by `process.env.IS_TEST === "true"`. `IS_TEST` is set only on the local e2e deployment, never on cloud dev, preview, or production. Feature crons skip work under `IS_TEST`. If the verification and reset slice needs the emailed link or code in e2e, it adds an `IS_TEST`-only outbox. | E2E outbox, guard |
| #15, previews (open, `status:blocked`) | Each same-repo PR gets a Convex preview deployment configured through **Convex default preview environment variables**. The preview deploy job runs a **reusable** step that fails if `IS_TEST` has a value; the production deploy request runs the same step against production. Fork PRs get no secrets and no preview. | Deploy check, preview variables |
| #9, hosting (open, `gate:technology`; ADR 0009 or 0010 in parallel drafting) | **No host is chosen yet.** The web app uses the host's default domain until the first production release. #9 also fixes the **Convex deployment region**: Convex offers US East (N. Virginia) or EU West (Ireland), fixed when the deployment is created ([Convex regions](https://docs.convex.dev/production/regions)). This ADR assumes **US East**. | Sender region, sending domain |
| #8, CI (open) | CI runs lint, tests, and e2e with no repository secrets, so fork PRs work. | No sender key in CI |

## Options

Prices, limits, and terms were read from the official pages on 2026-10-07 (Sources). Volume is ADR 0008's **0.5 emails per MAU per month**: about **500 emails a month at 1,000 MAU** and **5,000 at 10,000 MAU**. On an average day that is about 17 or 170 emails, but a league opening registration can bring many new password accounts in one day.

### Ruled out or not compared in full

| Candidate | Finding (official page) | Why not compared in full |
| --- | --- | --- |
| **Twilio SendGrid** | The Free Email API plan was retired from 2025-05-27; new accounts get a 60-day trial ([Twilio changelog](https://www.twilio.com/en-us/changelog/sendgrid-free-plan)). | Free tier withdrawn. Excluded, as #26 requires. |
| **Mailgun** | Free: 100 emails/day, 1 custom domain, **1-day log retention**. Basic: $15/month for 10,000. US or EU region. ([pricing](https://www.mailgun.com/pricing/)) | Same 100/day cap as Resend Free and the same $15 step as Postmark, with no Convex component. It offers nothing that changes the outcome. |
| **MailerSend** | Free: 500 emails/month, **100 API requests/day**, 1 domain, 1-day activity retention. Hobby: $7/month for 5,000. ([pricing](https://www.mailersend.com/pricing)) | Free tier is exactly the 1,000-MAU volume, with no headroom. Hobby ($7) is the cheapest paid plan that covers 10,000 MAU and is noted under "What would change this". |
| **Cloudflare Email Service** | Sending is **beta**. Not available on Workers Free; Workers Paid (from $5/month per account) includes 3,000 emails/month, then $0.35 per 1,000. REST API available. ([overview](https://developers.cloudflare.com/email-service/), [pricing](https://developers.cloudflare.com/email-service/platform/pricing/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)) | Beta, and a $5/month floor from the first email. If #9 chooses Cloudflare Workers Paid as the host, the floor is already paid and this should be re-compared (see "What would change this"). |
| **Brevo** | The official pricing page did not render its plan details on 2026-10-07. Third-party pages report 300 emails/day free. | Not verified from a primary source, so not evaluated. |

### Option A: Resend through the Convex component `@convex-dev/resend` (recommended)

- **What it is:** Resend, a transactional email API. Convex's `@convex-dev/resend` component queues each email in its own tables, batches sends to Resend's batch API, retries transient failures through `@convex-dev/workpool`, keeps a status per email, and handles Resend's signed status webhooks.
- **Plan and price** ([resend.com/pricing](https://resend.com/pricing)):
  - **Free:** $0, 3,000 emails/month, **100 emails/day** ("The Free plan is limited to 100 emails per day"), 3 domains, 30-day data retention.
  - **Pro:** $20/month for 50,000 emails, no daily limit, 10 domains, $0.90 per extra 1,000.
  - API rate limit: 10 requests/s per team on every plan ([rate limit](https://resend.com/docs/api-reference/rate-limit)). The daily quota resets at midnight UTC and applies only to Free.
- **Region:** chosen **per domain** when it is added: us-east-1 (N. Virginia), eu-west-1 (Ireland), sa-east-1, or ap-northeast-1 ([regions](https://resend.com/docs/dashboard/domains/regions)). **Stored data is held in the United States** whatever the sending region, under SCCs and the EU-U.S. Data Privacy Framework ([security](https://resend.com/security)).
- **Commercial use:** the Terms of Service (updated 2026-08-27) contain no restriction on commercial use on any plan. Section 6 makes the Free tier subject only to the usage limits on the pricing page. Section 9 requires recipient consent, which a user requesting their own verification or reset email gives. ([terms](https://resend.com/legal/terms-of-service))
- **Packages:** `@convex-dev/resend` **0.2.8** (2026-09-01, Apache-2.0, `latest` on 2026-10-07). Peers `convex` ^1.43.0 and `convex-helpers` ^0.1.106, both already present (ADR 0001, ADR 0008). Full tree under "Packages".
- **Behaviour, read from the 0.2.8 source and verified in a scratch run (Test evidence):**
  - `sendEmail(ctx, …)` can be called from a mutation or action. It throws `API key is not set` if `RESEND_API_KEY` is empty.
  - **`testMode` defaults to `true`.** In test mode, any recipient other than `delivered@`, `bounced@`, or `complained@resend.dev` throws. Production must pass `testMode: false`.
  - **Retries:** 5 attempts, 30 s initial backoff, doubling. HTTP 400, 401, 403, 404, 422 and similar are **permanent**: the email is marked `failed` at once. **429 is retried**, so a Free-plan `daily_quota_exceeded` (429) is retried for about 15 minutes and then marked `failed`. It is **not** held until the quota resets.
  - **Status per email:** `waiting`, `queued`, `sent`, `delivered`, `delivery_delayed`, `bounced`, `failed`, `cancelled`, with `complained`. An `onEmailEvent` mutation is called for **webhook events only**. An API failure marks the email `failed` but does **not** call `onEmailEvent` (verified).
  - **Webhook:** `handleResendEventWebhook` verifies the Svix signature (`svix-id`, `svix-timestamp`, `svix-signature`) with `RESEND_WEBHOOK_SECRET` and throws on a missing or bad signature.
  - **Stored data:** the component stores `from`, `to`, subject, and the **HTML/text body** (which holds the verification or reset link) in its own tables. `cleanupOldEmails` (default: finalized more than 7 days ago) and `cleanupAbandonedEmails` (default: 30 days) delete them; the app schedules both.
  - **Convex usage:** about 10 to 15 function calls per email including two or three webhook events (estimate from the source; not measured exactly). 5,000 emails/month is under 0.1M calls.
- **Pros:**
  - Durable queue and retries with no project code, and a status record for every send.
  - Webhook signature verification already written and tested upstream; verified here against unsigned, stale, and wrongly signed requests.
  - Resend's Free tier covers launch volume at $0; a sending-only API key can be restricted to one domain ([API keys](https://resend.com/docs/api-reference/api-keys/create-api-key)).
  - Maintained by Convex, the same publisher as `@convex-dev/better-auth`.
- **Cons and risks:**
  - **100/day on Free.** One busy registration day, or an attacker, can use it up (see "Daily cap").
  - Pre-1.0 (0.2.x). Adds three sub-components (two workpools and a rate limiter) and ten transitive packages.
  - The body, with the link, sits in the component's tables until cleanup, and in Resend's logs for 30 days (see "Data handling").
  - At about 6,000 MAU the monthly volume passes 3,000, and Pro costs $20/month.

### Option B: Resend with plain `fetch` from an internal action

- **What it is:** the same Resend account and plan as Option A. The callback schedules a project `internalAction` that calls `POST https://api.resend.com/emails` with `fetch`. No package is added.
- **Cost, region, terms, and limits:** as Option A.
- **Pros:** no new package; the email body is never stored in Convex.
- **Cons:**
  - The project writes and tests the retry policy, idempotency keys, a status table, the Svix-style webhook verification (HMAC-SHA256 over `id.timestamp.body`, base64 secret after `whsec_`, 5-minute tolerance, constant-time compare), and replay handling. All of that is security- or reliability-relevant code that Option A already has.
  - The body still sits in Resend's 30-day log, so the main data-handling difference is only the Convex copy, which holds links that expire after 1 hour (see "Data handling").

### Option C: Amazon SES (SESv2 API from an internal action)

- **What it is:** AWS's email service, called with the SESv2 `SendEmail` API.
- **Price:** **$0.10 per 1,000** emails. New AWS customers get up to $200 of Free Tier credits for 6 months ([SES pricing](https://aws.amazon.com/ses/pricing/)). About **$0.05/month at 1,000 MAU and $0.50 at 10,000 MAU**.
- **Limits:** new accounts start in the **sandbox**: only verified recipients, 200 messages per 24 hours, 1 per second. Production access is a manual review (initial response within 24 hours; the request needs a website URL and a bounce/complaint process), and the resulting quota "varies based on your specific use case" ([production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html), [quotas](https://docs.aws.amazon.com/ses/latest/dg/quotas.html)).
- **Region:** chosen per AWS region; us-east-1 matches Convex US East.
- **Pros:** by far the lowest cost at 10,000 MAU and beyond; no small daily cap once out of the sandbox, so an abuse spike costs cents rather than blocking users; an IAM policy can limit the key to `ses:SendEmail` from one identity.
- **Cons:**
  - An AWS account with billing, IAM, and a production-access review that may be refused or delayed, on top of buying the domain.
  - Requests need AWS SigV4 signing: either a new package (for example `aws4fetch`) or project-written signing code.
  - Delivery events go through SNS or EventBridge. An HTTPS SNS subscription into Convex needs SNS message-signature verification (X.509 certificate fetch and check), which the project writes.
  - No Convex component: the project writes the queue, retries, and status records (as Option B).

### Option D: Postmark

- **Price:** Free: **100 emails/month**, no overage. Basic: **$15/month** for 10,000 emails ([pricing](https://postmarkapp.com/pricing)). Launch volume (500/month) does not fit Free, so Postmark costs **$15/month from the first production release**, at both 1,000 and 10,000 MAU.
- **Retention:** 45 days on Basic, not configurable; custom retention (up to 365 days) only on Pro and above.
- **Webhooks:** "Postmark does not currently support HMAC webhook signature verification"; it offers basic auth in the webhook URL and an IP allowlist ([webhooks](https://postmarkapp.com/developer/webhooks/webhooks-overview)). That does not meet #26's "verifies the sender's signature" requirement without a weaker substitute.
- **Pros:** no daily cap on paid plans; transactional-only reputation.
- **Cons:** $15/month from launch, no signed webhooks, no Convex component.

### Summary

| | A: Resend + component | B: Resend + `fetch` | C: Amazon SES | D: Postmark |
| --- | --- | --- | --- | --- |
| Monthly cost at 1,000 MAU (500 emails) | **$0** (Free) | $0 | about $0.05 (or $0 within AWS credits) | $15 |
| Monthly cost at 10,000 MAU (5,000 emails) | **$20** (Pro) | $20 | about $0.50 | $15 |
| Free-tier daily cap | 100/day | 100/day | 200/day only in sandbox; production quota per review | none on paid |
| Signed webhooks | Svix HMAC, verified by the component | Svix HMAC, project code | SNS X.509 signatures, project code | none (basic auth / IP list) |
| Queue, retries, status | Component | Project code | Project code | Project code |
| New packages | 1 direct, 10 transitive, no install scripts | none | `aws4fetch` or own SigV4 | none |
| Sending region / storage | per domain (us-east-1 available) / US | same | per AWS region | US |
| Body retention at sender | 30 days; off only with a $50/month add-on (eligibility rules) | same | not documented on the pages checked | 45 days (Basic) |
| Set-up before release | Resend account, DNS, key, webhook | same | AWS account, IAM, DNS, production-access review, SNS | account, DNS, key, webhook |

## Recommendation

**Option A: Resend, called through `@convex-dev/resend` 0.2.x, on the Free plan at launch, sending from `mail.<domain>` in us-east-1. Dev and preview deployments send nothing.**

- It is the only option that costs $0 at launch and comes with a durable queue, retries, per-send status, and signed-webhook handling already written. The project's own code is limited to limits, the outbox, and status bookkeeping.
- Amazon SES is much cheaper at 10,000 MAU, but needs an AWS account, a production-access review, SigV4 signing, and SNS signature verification written in this repository. It is the documented exit if the owner does not approve Resend Pro (owner question 1).
- Postmark costs $15/month from day one and has no signed webhooks. Plain `fetch` (Option B) saves one package but moves security-relevant webhook code into the repository.

### How Convex calls the sender

```
Better Auth callback (inside the /api/auth HTTP action)
  └─ await ctx.runMutation(internal.authEmail.enqueue, { kind, to, url })
        ├─ IS_TEST set?            → write testEmailOutbox row, return (Resend never called)
        ├─ suppressed / over limit → record a skipped send, return (no throw)
        └─ otherwise               → resend.sendEmail(ctx, {...})  (component queues, batches, retries)
Resend → POST <CONVEX_SITE_URL>/resend-webhook (Svix-signed) → component → internal.authEmail.onEmailEvent
```

- **The callbacks never throw.** `enqueue` records every outcome itself. Without an `advanced.backgroundTasks.handler`, Better Auth 1.6.33 awaits the callback but catches and logs any error (`runInBackgroundOrAwait` in `dist/context/create-context.mjs`), so a throw would only produce a log line. `/send-verification-email` calls the callback directly and would turn a throw into an error response only for existing unverified accounts, which would reveal that the account exists. No `backgroundTasks.handler` is set, so the enqueue mutation finishes before the HTTP response.
- **`sendOnSignIn` stays off.** The sign-in screen offers "Resend email" instead, so repeated sign-in attempts do not send mail.
- **No email for duplicate sign-ups:** `onExistingUserSignUp` is not set.
- **Component options:** `testMode: false`, `onEmailEvent: internal.authEmail.onEmailEvent`, defaults for retries. `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET` are read from the environment.
- **Token lifetime:** Better Auth's defaults are kept: verification token 1 hour (`emailVerification.expiresIn` 3600 s), reset token 1 hour (`resetPasswordTokenExpiresIn`). A link that cannot be sent within the hour is useless, so a refused send is dropped rather than queued for the next day.
- **Sender address:** `EMAIL_FROM` (for example `Omni League <no-reply@mail.<domain>>`) and `EMAIL_REPLY_TO` (the support contact, owner question 3) are environment variables, so the switch-over needs no code change.

### Packages

Resolved on 2026-10-07 with `npm install --package-lock-only --ignore-scripts` next to `convex` 1.46.0, `@convex-dev/better-auth` 0.12.5, `better-auth` 1.6.33, `vitest` 5.0.3 (with ADR 0008's override), and `typescript` 6.0.3 (npm 11.13.0, Node 24.16.0).

| Package | Version | Type | Licence | Install script |
| --- | --- | --- | --- | --- |
| `@convex-dev/resend` | 0.2.x (0.2.8) | dependency | Apache-2.0 | none |
| `resend` | 6.32.1 (transitive) | | MIT | none |
| `svix` | 1.99.1 (transitive) | | MIT | none |
| `standardwebhooks` | 1.1.1 and 1.0.0 (transitive) | | MIT | none |
| `@stablelib/base64` | 1.0.1 (transitive) | | MIT | none |
| `fast-sha256` | 1.3.0 (transitive) | | Unlicense | none |
| `postal-mime` | 2.7.6 (transitive) | | MIT-0 | none |
| `remeda` | 2.51.0 (transitive) | | MIT | none |
| `@convex-dev/workpool` | 0.4.13 (transitive) | | Apache-2.0 | none |
| `@convex-dev/rate-limiter` | 0.3.2 (transitive) | | Apache-2.0 | none |
| `@convex-dev/batch-worker` | 0.2.2 (transitive) | | Apache-2.0 | none |

- `convex-helpers` (peer, 0.1.127) is already in the tree through `@convex-dev/better-auth`.
- `resend` declares `@react-email/render` as an optional peer; it is not installed, and the project does not use React Email.
- The lockfile marks `hasInstallScript` only on `esbuild` and `fsevents`, both already denied in ADR 0003's map. **ADR 0003's `allowScripts` map is unchanged.** No `overrides` entry is added.
- `convex/convex.config.ts` gains `app.use(resend)`. The app does not import the transitive components directly.
- A minor or patch bump of `@convex-dev/resend` needs no gate but must pass the slice's Convex tests.

### Sending domain and DNS (when the domain is bought)

- **Production sending subdomain:** `mail.<domain>`, added to Resend in **us-east-1** (the region of the assumed Convex US East deployment; eu-west-1 if #9 picks EU West). Resend recommends sending from a subdomain to keep its reputation separate from the root domain ([domains](https://resend.com/docs/dashboard/domains/introduction)).
- **No separate dev or preview subdomain.** Dev and preview never send (below), so only production sends from the domain. This keeps production's reputation and DMARC reports to production traffic alone.
- **Records the owner adds** (exact values are shown in the Resend dashboard and depend on the region):

| Record | Type | Host | Purpose |
| --- | --- | --- | --- |
| DKIM | TXT | `resend._domainkey.mail` | Resend's DKIM public key |
| SPF (return path) | TXT | `send.mail` (default return-path subdomain) | Authorises Resend's sending servers for the bounce domain |
| Return path / feedback | MX | `send.mail` | Receives bounces and complaints for the return-path domain |
| DMARC | TXT | `_dmarc` (the organisational domain, so it also covers `mail.`) | Start with `v=DMARC1; p=none; rua=mailto:<owner reports address>`. Move to `p=quarantine` after about 2 to 4 weeks of clean aggregate reports, then to `p=reject` ([Resend DMARC guide](https://resend.com/docs/dashboard/domains/dmarc)). |

  - DKIM is signed for `mail.<domain>` and the From address is on `mail.<domain>`, so DKIM aligns. The return path `send.mail.<domain>` shares the organisational domain, so SPF aligns under relaxed alignment. DMARC needs only one of them.
  - If the `send` subdomain clashes with another service, Resend's custom return path option changes its name ([custom return path](https://resend.com/docs/dashboard/domains/custom-return-path)).
- **Who verifies:** the owner, in the Resend dashboard (Domains → Verify). Agents never hold the Resend account or a production key.

### Deployments and periods

Periods: **P1** before the verification and reset slice merges (today); **P2** after it merges, before the domain exists; **P3** after the domain exists and is verified.

| Deployment | Period | Real email sent? | From | To | API key | Email settings |
| --- | --- | --- | --- | --- | --- | --- |
| **Local e2e** (anonymous local backend; CI) | P1 | No | none | none | **none** | ADR 0008: no callbacks |
| | P2, P3 | **No.** Sends go to `testEmailOutbox` under `IS_TEST` | none | outbox row only | **none** | `IS_TEST=true`, `AUTH_EMAIL_DISABLED` unset: verification required, outbox used |
| **Developer dev** (one per developer or agent) | P1 | No | none | none | none | ADR 0008 |
| | P2, P3 | **No** | none | none | **none** | `AUTH_EMAIL_DISABLED=true` |
| **Per-PR preview** | P1 | No | none | none | none | ADR 0008 |
| | P2, P3 | **No** | none | none | **none** (the deploy check fails if one is set) | `AUTH_EMAIL_DISABLED=true` in the Convex default preview variables |
| **Production** | P1, P2 | Not released: the first production release is blocked (below) | none | none | none | |
| | P3 | **Yes** | `EMAIL_FROM` on `mail.<domain>` | the user's own address only | production key: `sending_access`, restricted to `mail.<domain>` | `AUTH_EMAIL_DISABLED` and `IS_TEST` unset |

**Recommended for dev and preview before (and after) the domain exists: no sending.** The owner-only sandbox (Resend's `onboarding@resend.dev` sender, which only delivers to the Resend account owner, [403 on resend.dev](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)) was considered and not chosen:

- Only the owner could receive mail, so neither agents nor the tester could use it.
- Its key would live in the production Resend team: a sending-only key cannot be restricted to `resend.dev`, so after P3 it could also send from `mail.<domain>`. Its sends would also count against production's 100/day quota. A second team needs its own paid plan ([Resend multiple teams](https://resend.com/blog/multiple-teams)).
- The real send path is instead covered by Convex tests with a mocked `fetch`, the e2e outbox, and the owner's switch-over check on production before release (step 8 below).

### `AUTH_EMAIL_DISABLED`: dev and preview behaviour after the slice merges

One environment variable controls every per-deployment difference. **Default: unset, which means verification and reset are fully on.** Forgetting it on production therefore gives the strict behaviour.

| | `AUTH_EMAIL_DISABLED` unset (production, local e2e) | `AUTH_EMAIL_DISABLED=true` (developer dev, previews) |
| --- | --- | --- |
| Password sign-up | Account created, verification email queued, "Check your email" screen. No session until verified. | Account created and signed in at once (as today). No email. |
| Password sign-in | `403 EMAIL_NOT_VERIFIED` until verified; the screen offers "Resend email". | Works without verification. |
| Verification | Link (or code) from the email | Not offered; the verification prompt is hidden. `/send-verification-email` returns `400 VERIFICATION_EMAIL_NOT_ENABLED`. |
| Reset | "Forgot password?" link shown; reset email queued | Link hidden. `/request-password-reset` returns `400 RESET_PASSWORD_DISABLED`. A tester who forgets a password signs up again or asks the owner to delete the account (ADR 0008). |
| 7-day deletion of unverified accounts | Runs (skipped under `IS_TEST`, ADR 0005) | **Off**, because nobody can verify there |
| Google linking to a password account | Allowed once the password account is verified | Never (password emails stay unverified), as ADR 0008 describes |

- **Only the value `true` is accepted.** Any other value makes `createAuth` throw a configuration error, so every auth request fails visibly and a typo cannot silently pick a mode.
- **The Angular app learns the mode** from the public query `authEmail.sendingStatus` (below), not from a build flag, so the same build works on every deployment.
- **The same behaviour holds in P2 and P3.** The domain only changes production.
- **Production check:** #15's reusable deploy step is extended so that it **fails if `AUTH_EMAIL_DISABLED` has any value on production**, exactly as for `IS_TEST`. The same step fails on production if `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, or `EMAIL_FROM` is missing. On previews it fails if `AUTH_EMAIL_DISABLED` is not `true` or if `RESEND_API_KEY` has any value. The step checks names only and never prints a value. The production deploy request lists it.
- **Order at merge:** the slice's PR has the owner add `AUTH_EMAIL_DISABLED=true` to the Convex default preview variables and tells developers to set it on their dev deployments **before** the slice merges. Otherwise previews created afterwards would require verification with no way to send.

### E2E with no sender key

- Local e2e and CI need **no sender key**, so fork PRs keep working (ADR 0005, ADR 0008).
- **Outbox:** when `IS_TEST === "true"`, `authEmail.enqueue` writes `{ kind, to, url, createdAt }` to `testEmailOutbox` and returns **before** any call to the component, so Resend is never called. `testing:readOutbox` (an `internalQuery` behind ADR 0005's `IS_TEST` guard) lets Playwright read the link through `npx convex run`. `testing:reset` clears the outbox and the `authEmail*` tables.
- Without `IS_TEST`, `enqueue` never writes to the outbox.
- **Seeding changes:** with verification required on local e2e, `testing:seedLeague` must mark seeded password users verified (`emailVerified: true`), or the existing sign-in specs get `403 EMAIL_NOT_VERIFIED`.
- **Convex tests:** the component is registered in `convex-test` through `@convex-dev/resend/test`, with `fetch` mocked. Tests prove that the outbox throws or stays empty without `IS_TEST`, that `enqueue` never calls the component under `IS_TEST`, the limits, the budget, suppression, and the webhook route's 401 on unsigned requests.

### Token exposure outside email

| Path | Who can see it | Guard |
| --- | --- | --- |
| `testEmailOutbox` (link in plain text) | Local e2e only | `IS_TEST`, the same guard as ADR 0005. #15's existing `IS_TEST` check proves it is off on previews and production. |
| Component tables (`emails`, `content`: the body with the link) | Internal functions only, plus anyone with **admin access to that deployment's dashboard**. No client can call component functions, and no project function returns them. | On production, only the owner has dashboard access. Rows are deleted by the cleanup cron: finalized emails after 24 hours, others after 7 days. Links expire after 1 hour. Dev and preview have no rows, because they never send. |
| Better Auth's `verification` table | Same as above | Already present in ADR 0008: reset tokens are stored as `reset-password:<token>`. The component copy adds no new reader. |
| Resend's email log (30 days) | The Resend account (owner) | Not avoidable on Free or Pro (see "Data handling"). |
| Logs | Deployment admins | Project code never logs the URL, token, or address. It logs `kind`, status, and the component's email id. |

The only path that exposes a token to anyone other than an admin of the sending deployment is the outbox, and it is behind `IS_TEST`.

### Limits on every endpoint that sends email

| Endpoint | Better Auth per-IP default | Project per-IP rule (`rateLimit.customRules`) | Project per-address limit (in `authEmail.enqueue`) |
| --- | --- | --- | --- |
| `POST /sign-up/email` (with `sendOnSignUp`) | 3 per 10 s | **10 per hour** | 1 per 60 s and **5 per 24 h per recipient**, across all kinds |
| `POST /send-verification-email` | 3 per 60 s | **5 per hour** | same |
| `POST /request-password-reset` | 3 per 60 s | **5 per hour** | same |

- **Per-address:** keyed on the SHA-256 of the lower-cased, trimmed address, counted from `authEmailSends`. A refused send is recorded as `skipped_limited` and nothing is sent. The response is unchanged, so the limit reveals nothing about which accounts exist.
- **Global daily budget:** `enqueue` stops at **`EMAIL_DAILY_LIMIT` sends per UTC day (default 95 when unset)**, 5 below Resend Free's 100/day, so the project hits its own budget before Resend's quota and can tell users. On Pro the owner raises it (for example to 2,000) as a cost guard.
- **Per-IP rules depend on a client IP.** ADR 0008 makes the first sign-in feature confirm that `cf-connecting-ip` is trustworthy on Convex cloud. If it is not, the per-IP limiter is off, and only the per-address and global limits remain.

**What one attacker can trigger per day:**

- **With per-IP limits working, one IP:** 10 + 5 + 5 = 20 email-triggering requests an hour, **480 a day**. Sign-ups with fresh addresses are not stopped by the per-address limit, so one IP can **use up the 95-send budget in under 5 hours**. A few IPs can do it in under an hour. Resets aimed at real users are capped at 5 a day per victim.
- **Without per-IP limits:** the budget goes in **95 requests**, which takes seconds.
- **Compared with Resend Free's 100/day cap, no per-IP or per-address limit protects the cap from a determined attacker.** The limits stop casual abuse, cap harassment of any one address, and keep Resend's quota from being hit first. Protecting the cap itself needs either a bot challenge on these three forms (a new external service, owner question 2) or a plan with no daily cap (owner question 1).

### Daily cap: what happens when it is hit

- **New password accounts verified per day under the cap:** at most **95 sends per UTC day**. Each new account needs at least one send, and some need a resend, so about **50 to 95 new password accounts** can be verified on one day. Google sign-ups need no email and are unaffected.
- **When the budget is reached:**
  - `enqueue` records `skipped_capped` and sends nothing. The send is **dropped, not queued**: the link would expire in 1 hour, and the user can request a new one after 00:00 UTC.
  - If Resend still returns `429 daily_quota_exceeded` (for example if the counter and Resend's count differ), the component retries for about 15 minutes, then marks the email `failed`. That is also dropped.
  - `authEmail.sendingStatus` returns `paused: true` with `resumesAt` (next 00:00 UTC).
- **What the user sees** (screens go through `gate:ui-design` in the slice):
  - After sign-up: "Your account is created, but email is paused until <local time>. Come back after then and choose Resend email." No "check your inbox" message.
  - On sign-in for an unverified account: the same paused message, with the resend button disabled until `resumesAt`.
  - On "Forgot password?": the usual "If an account exists, we sent a link", plus "Email is paused until <local time>; reset links cannot be sent until then."
- **Can the user sign in meanwhile?** **No, not with that password account**: it stays `403 EMAIL_NOT_VERIFIED`. **Google sign-in for the same address is also refused** while the unverified password account exists (`account not linked`, ADR 0008). The user can use Google only with a different address. Existing verified users and Google-only users are unaffected.
- **Interaction with the 7-day deletion:** the account is deleted 7 days after sign-up if still unverified, which leaves seven daily quota windows to resend. A cap hit on one day does not shorten that. If the cap is exhausted every day for a week (sustained abuse), affected accounts are deleted and the address is freed. The owner is told through the daily digest (below) long before that.

### Failure detection

Better Auth reports success whatever the callback does, so the project records outcomes itself:

1. **`authEmailSends` row per attempt** (internal): `kind`, `recipientHash`, component email id, `status` (`queued`, `sent`, `delivered`, `delivery_delayed`, `bounced`, `complained`, `failed`, `suppressed`, `skipped_limited`, `skipped_capped`, `skipped_suppressed`, `failed_config`), and times. No plain address, no URL. Kept 30 days.
2. **Webhook events** (`email.sent`, `delivered`, `delivery_delayed`, `bounced`, `complained`, `failed`, `suppressed`; [event types](https://resend.com/docs/dashboard/webhooks/event-types)) update the row through `onEmailEvent`.
3. **`authEmail.reconcile` cron, every 10 minutes:** API failures do not raise webhook events, so the cron reads the component status of rows still `queued` or `sent` after 20 minutes and records `failed` with the error.
4. **Missing configuration:** if `RESEND_API_KEY` or `EMAIL_FROM` is missing where sending is on, `enqueue` records `failed_config` and logs `auth_email_config_missing` instead of throwing.
5. **Every failure, bounce, complaint, and skip** logs one structured line (`auth_email_<status>`, `kind`, email id) to the Convex logs.
6. **Owner digest:** a cron at 00:15 UTC sends `OWNER_ALERT_EMAIL` (production only) a counts-only summary of the previous UTC day when any send failed, bounced, drew a complaint, or was skipped for the cap. It goes through the same sender, after the daily quota resets, and contains no addresses. Convex log streams and exception reporting need the Pro plan ([log streams](https://docs.convex.dev/production/integrations/log-streams/), [pricing](https://www.convex.dev/pricing)), which is over the #9 budget, so they are not used.
7. **`authEmail.health`** (`internalQuery`): counts by status for the last 24 hours and 7 days, for the owner in the dashboard function runner.

A total Resend outage would stop the digest too. The Resend dashboard shows the same failures, and the owner's switch-over check (below) is repeated after any change to the email code.

**What the user sees** on the verification and reset screens: "We sent a link to <the address they typed>. It can take a minute; check spam. Didn't get it? Resend (available after 60 s)." No per-user delivery status is shown to an unauthenticated user, because it would reveal whether an account exists. The screen also shows the support contact (owner question 3).

### Bounces and complaints

- Resend adds hard-bounced and complaining addresses to its team-wide suppression list and skips later sends to them, raising `email.suppressed` ([suppressions](https://resend.com/docs/dashboard/emails/email-suppressions)). Gmail may not report complaints.
- `onEmailEvent` records `bounced`, `complained`, or `suppressed` and adds the address hash to `authEmailSuppressions`. `enqueue` then skips that address (`skipped_suppressed`) without spending quota.
- **Effect on the user:** verification or reset mail never arrives. A new password account for that address cannot be verified and is deleted after 7 days. A verified user can still sign in with a password or Google, but cannot reset by email.
- **Recovery:** the user contacts support. Once the mailbox works, the owner removes the address from Resend's suppression list and deletes the `authEmailSuppressions` row in the dashboard.

### New Convex functions and routes: who may call them

| Function or route | Kind | Who may call or read it |
| --- | --- | --- |
| `authEmail.enqueue` | `internalMutation` | Only server code: Better Auth's callbacks inside `createAuth`. Not callable by any client. |
| `authEmail.onEmailEvent` | `internalMutation` | Only the component, on a verified webhook event |
| `authEmail.reconcile`, `authEmail.cleanup`, `authEmail.dailyDigest` | internal, crons | Only the scheduler. All skip work under `IS_TEST`. `cleanup` calls the component's `cleanupOldEmails` (24 h) and `cleanupAbandonedEmails` (7 days) and deletes `authEmailSends` rows older than 30 days. |
| `authEmail.health` | `internalQuery` | The owner, through the dashboard function runner; internal functions |
| `authEmail.sendingStatus` | public `query`, **deliberately unauthenticated** (`docs/conventions/convex.md`) | Anyone. Takes no arguments and returns only `{ enabled, paused, resumesAt }`, which is global state with no address, user id, or count. Tests cover the unauthenticated caller and a signed-in caller from another league getting the same answer. |
| `POST /resend-webhook` | HTTP route in `convex/http.ts` | Resend only. It returns **404 if `RESEND_WEBHOOK_SECRET` is unset** (dev, preview, local), and otherwise calls `handleResendEventWebhook`. A missing, wrong, or older-than-5-minutes **Svix signature (HMAC-SHA256)** gets **401**, with nothing logged from the request. The secret is stored like the API key. |
| `testing:readOutbox` | `internalQuery` | Playwright via `npx convex run`, and only when `IS_TEST` is set |
| Component functions (`components.resend.*`) | component | Only the app's own functions. Clients cannot call component functions. |

- `authEmailSends`, `authEmailSuppressions`, the daily counter, and the component tables hold addresses or their hashes. **No public query or mutation reads them**, so league organizers and other users can never see another user's address or send status.

### Secrets and environment variables

| Variable | Local e2e | Developer dev | Preview (Convex default preview variables) | Production (set by the owner) |
| --- | --- | --- | --- | --- |
| `RESEND_API_KEY` | not set | not set | **not set** (deploy check fails if set) | Resend key with `sending_access`, **restricted to `mail.<domain>`** |
| `RESEND_WEBHOOK_SECRET` | not set | not set | not set | the webhook's signing secret |
| `EMAIL_FROM`, `EMAIL_REPLY_TO` | not set | not set | not set | the sender and support addresses |
| `OWNER_ALERT_EMAIL` | not set | not set | not set | the owner's address |
| `EMAIL_DAILY_LIMIT` | not set | not set | not set | optional; default 95 |
| `AUTH_EMAIL_DISABLED` | **unset** | `true` | `true` | **unset** (deploy check fails if set) |
| `IS_TEST` | `true` (Playwright `globalSetup`) | unset | unset (check) | unset (check) |

- The production key **can be scoped**: Resend API keys are `full_access` or `sending_access`, and a `sending_access` key can be limited to one domain ([API keys](https://resend.com/docs/api-reference/api-keys/create-api-key)). Only the owner holds the Resend account and creates keys.
- **No key exists in P1 or P2**, and no key is ever held by an agent, CI, or a preview.
- No key or secret appears in the repository, issues, PRs, or logs. The deploy check reads variable names only.

### Data handling

- **Where messages are processed:** sent from the domain's region (us-east-1, N. Virginia). Resend holds stored data in the United States. **This matches the assumed Convex US East deployment.** If #9 picks EU West (Ireland), the domain is added in eu-west-1, but Resend's stored data is still in the US, under its pre-signed DPA, SCCs, and the EU-U.S. Data Privacy Framework ([security](https://resend.com/security)).
- **Message bodies in Resend's logs:** "Email and log data is retained for 30 days on Free, Pro, and Scale plans." Bodies hold the verification or reset link. Turning content storage off is a **$50/month add-on**, available only to teams that have been on Pro or Scale for at least a month and have sent more than 3,000 emails with a bounce rate under 5% ([sensitive data](https://resend.com/docs/knowledge-base/how-do-i-ensure-sensitive-data-isnt-stored-on-resend)). **It is not used at launch.** Mitigation: both links expire after 1 hour, and a reset link is deleted once used, so a log entry older than an hour holds a dead link.
- **In Convex:** the component's copy is deleted by the cleanup cron (above). `authEmailSends` holds no address or link.
- **Account deletion** (ADR 0008's `onDelete` trigger) deletes the user's `authEmailSends` rows. Resend's copy ages out within 30 days.

## Cost

| Monthly cost | 1,000 MAU (about 500 emails) | 10,000 MAU (about 5,000 emails) |
| --- | --- | --- |
| Before the first production release | **$0** (nothing is sent) | **$0** |
| Resend, from the first production release | **$0** on Free (3,000/month, **100/day**) | **$20** on Pro (50,000/month, no daily cap) |
| Extra Convex usage (component, crons) | within included amounts: $0 | under 0.1M calls: at most about $0.22 on Starter |

- **Monthly limit:** at 0.5 emails per MAU, Free's 3,000/month lasts to about **6,000 MAU**.
- **Daily limit:** Free allows about 50 to 95 new password accounts per UTC day (above). A league opening registration to more than that in one day needs Pro, **at any MAU**.
- **Which owner constraint it falls under:** **neither.** It is not the auth provider (#7's "free tier at launch"; ADR 0008's library is free) and not hosting or Convex (#9's "about $25/month"). Email is a separate service with no budget yet, so the paid step is owner question 1.

## Switch-over when the domain is bought (no code change)

**The first production release (`gate:production`) is blocked until a sending domain is verified in Resend and the verification and reset slice is merged.** The production deploy request lists both, plus the deploy check above, as prerequisites.

1. The owner buys the domain (registrar and DNS host are the owner's choice; #9 decides whether the web app moves to it).
2. The owner creates the Resend account (Free) and adds `mail.<domain>` in us-east-1 (or the region matching #9).
3. The owner adds the DKIM, SPF, MX, and DMARC (`p=none`) records from the table above and clicks Verify in Resend.
4. The owner creates the production API key (`sending_access`, restricted to `mail.<domain>`) and sets `RESEND_API_KEY` on the production Convex deployment.
5. The owner creates a Resend webhook to `https://<prod-deployment>.convex.site/resend-webhook` for `email.sent`, `delivered`, `delivery_delayed`, `bounced`, `complained`, `failed`, and `suppressed`, and sets `RESEND_WEBHOOK_SECRET`.
6. The owner sets `EMAIL_FROM`, `EMAIL_REPLY_TO`, `OWNER_ALERT_EMAIL`, and optionally `EMAIL_DAILY_LIMIT` on production, and confirms that `AUTH_EMAIL_DISABLED` and `IS_TEST` are unset.
7. The production deploy runs the extended deploy check (it fails on any missing or forbidden variable).
8. **Owner check before opening to users:** sign up with an owner-controlled address and receive the verification email within a minute (not in spam); verify; request a reset and complete it; confirm the `authEmailSends` rows reach `delivered`; confirm that the message headers show SPF, DKIM, and DMARC `pass`; send a test webhook from Resend and see it accepted; and post an unsigned request to `/resend-webhook` and see 401.
9. After 2 to 4 weeks of clean DMARC reports, the owner moves DMARC to `p=quarantine`, then `p=reject`.

Dev and preview change nothing at switch-over.

## Consequences

- **New dependency:** `@convex-dev/resend` 0.2.x and its tree (Packages). No install scripts, no `overrides`, and ADR 0003's `allowScripts` map is unchanged.
- **New external service:** Resend, Free plan at launch; Pro ($20/month) at about 6,000 MAU or for registration days with more than about 95 new password accounts, subject to owner question 1.
- **No cost and no sender key before the first production release.**
- **Verification and reset slice (`Blocked by: #26`, #7; blocks the first production release)** implements:
  - the callbacks, `authEmail.*` functions and crons, `/resend-webhook`, the outbox, the limits, the budget, suppression, and the digest;
  - `AUTH_EMAIL_DISABLED`, `sendingStatus`, and the Angular screens and email templates (through `gate:ui-design`);
  - seeding verified users in `testing:seedLeague`, and clearing the new tables in `testing:reset`;
  - Convex tests for every row of the access table and every limit; e2e specs for sign-up → verify and reset through the outbox;
  - the owner steps for `AUTH_EMAIL_DISABLED=true` on previews and dev before merge.
- **#15:** the reusable deploy step gains the `AUTH_EMAIL_DISABLED` and email-variable checks above, and the owner setup doc lists `AUTH_EMAIL_DISABLED=true` among the preview variables. Previews never get an email key.
- **Production deploy request:** lists #26's switch-over steps 1 to 8 as prerequisites.
- **What becomes harder:** a determined attacker can block new password sign-ups for a UTC day while on Free (owner question 2). Moving to SES later means a superseding ADR and rewriting the send and webhook path; `authEmailSends`, the limits, the outbox, and `AUTH_EMAIL_DISABLED` stay.
- **What would change this:**
  - The owner declines Resend Pro: re-compare Amazon SES (about $0.50/month at 10,000 MAU) and MailerSend Hobby ($7/month).
  - #9 chooses Cloudflare Workers Paid as the host: re-compare Cloudflare Email Service once it leaves beta (3,000/month included, then $0.35 per 1,000).
  - #9 chooses EU West for Convex: the domain region changes to eu-west-1 (no code change), and the US storage of Resend data is noted in the privacy notice.
  - `@convex-dev/resend` stops being maintained or diverges from Convex releases: move to Option B (plain `fetch`) behind the same `enqueue` mutation.

## Owner questions

1. **Paid email at or below 10,000 MAU.** Resend Free runs out at about 6,000 MAU (monthly) or on the first day with more than about 95 new password accounts (daily). Pro is $20/month and falls under no existing budget. Approve Pro when either happens (recommended), or have the system prepare a superseding ADR to move to Amazon SES (about $0.50/month at 10,000 MAU) before then? If a league is expected to open registration to more than about 95 new password users in one day at launch, Pro is needed from the first release.
2. **Bot challenge on sign-up, resend, and reset.** On Free, one attacker can use up the daily budget in hours, blocking new password users until 00:00 UTC (Google is unaffected). Options: (a) accept that risk at launch and watch the digest (recommended for launch, because Pro removes the daily cap); (b) add a free bot challenge such as Cloudflare Turnstile through Better Auth's `captcha` plugin, which is a new external service and needs its own `gate:technology` issue.
3. **Support contact.** Users whose mail bounces need a way to reach the project. Which address goes in `EMAIL_REPLY_TO` and on the verification and reset screens? Recommended: an address on the purchased domain, forwarded to the owner.

## Test evidence

**Scratch run (2026-10-07), outside the repository:** macOS arm64, Node 24.16.0, npm 11.13.0, `convex` 1.46.0, `@convex-dev/resend` 0.2.8, `svix` 1.99.1, anonymous local backend (`CONVEX_AGENT_MODE=anonymous npx convex dev`, no Convex login). No real Resend key was used. The placeholder key and scratch webhook secret are not recorded.

1. **Install resolution:** see Packages. `hasInstallScript` only on `esbuild` and `fsevents`.
2. **Component install:** `npx convex dev` installed `resend`, `resend/emailWorkpool`, `resend/callbackWorkpool`, their `batchWorker` sub-components, and `resend/rateLimiter`.
3. **No key:** `sendEmail` from an internal mutation threw `API key is not set`.
4. **Default `testMode`:** with a placeholder key, sending to `someone@example.com` threw `Test mode is enabled, but email address is not a valid resend test address`.
5. **Permanent failure:** with `testMode: false` and an invalid key, sending to `delivered@resend.dev` returned an email id. Resend answered `401 API key is invalid`. Within 8 s the component status was `failed` with that error, the log had one `permanent_failure` line (no body), and **`onEmailEvent` was not called** (the app's event table held only the enqueue row).
6. **Stored body:** `resend.get` returned the stored text including the link, which confirms that the component keeps the body until cleanup.
7. **Webhook route** (`POST /resend-webhook`, wrapper as specified above):
   - with `RESEND_WEBHOOK_SECRET` unset: 404 for every request;
   - with it set: unsigned → **401**; correctly signed (`svix` `Webhook.sign`) → **201**; signed with a timestamp 10 minutes old → **401**; signed with another secret → **401**.
   - The signed event for an unknown Resend id was logged as "Email not found for resendId …, ignoring".
8. **Source checks:**
   - `better-auth` 1.6.33: `runInBackgroundOrAwait` (`dist/context/create-context.mjs`), the special rate-limit rules (`dist/api/rate-limiter/index.mjs`: `/sign-up` 3 per 10 s; `/send-verification-email` and `/request-password-reset` 3 per 60 s), token lifetimes (`dist/api/routes/email-verification.mjs`, `password.mjs`), and plain-text reset identifiers in the `verification` table.
   - `@convex-dev/resend` 0.2.8: `src/client/index.ts`, `src/component/lib.ts`, `src/component/schema.ts`.
   - `standardwebhooks` 1.0.0: HMAC-SHA256, 5-minute tolerance, constant-time comparison.

**Not run:** a real send through Resend (no account or domain exists; covered by switch-over step 8), and Better Auth wired to the component (the slice's Convex and e2e tests cover it).

## Sources

All checked 2026-10-07.

- **Resend:** [pricing](https://resend.com/pricing), [errors](https://resend.com/docs/api-reference/errors), [rate limit and quota headers](https://resend.com/docs/api-reference/rate-limit), [API introduction](https://resend.com/docs/api-reference/introduction), [API keys](https://resend.com/docs/api-reference/api-keys/create-api-key), [regions](https://resend.com/docs/dashboard/domains/regions), [domains](https://resend.com/docs/dashboard/domains/introduction), [custom return path](https://resend.com/docs/dashboard/domains/custom-return-path), [DMARC](https://resend.com/docs/dashboard/domains/dmarc), [verify webhooks](https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests), [event types](https://resend.com/docs/dashboard/webhooks/event-types), [suppressions](https://resend.com/docs/dashboard/emails/email-suppressions), [sensitive data](https://resend.com/docs/knowledge-base/how-do-i-ensure-sensitive-data-isnt-stored-on-resend), [403 on resend.dev](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain), [security](https://resend.com/security), [terms of service](https://resend.com/legal/terms-of-service) (updated 2026-08-27), [multiple teams](https://resend.com/blog/multiple-teams).
- **Amazon SES:** [pricing](https://aws.amazon.com/ses/pricing/), [production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html), [quotas](https://docs.aws.amazon.com/ses/latest/dg/quotas.html).
- **Postmark:** [pricing](https://postmarkapp.com/pricing), [webhooks](https://postmarkapp.com/developer/webhooks/webhooks-overview).
- **Others:** [Mailgun pricing](https://www.mailgun.com/pricing/), [MailerSend pricing](https://www.mailersend.com/pricing), [Twilio SendGrid free plan changelog](https://www.twilio.com/en-us/changelog/sendgrid-free-plan), [Cloudflare Email Service](https://developers.cloudflare.com/email-service/), [its pricing](https://developers.cloudflare.com/email-service/platform/pricing/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).
- **Convex:** [regions](https://docs.convex.dev/production/regions), [log streams](https://docs.convex.dev/production/integrations/log-streams/), [pricing](https://www.convex.dev/pricing).
- **npm registry:** `@convex-dev/resend`, `resend`, `svix`, `standardwebhooks`, `@convex-dev/workpool`, `@convex-dev/rate-limiter`, `@convex-dev/batch-worker` (versions, licences, peers, publish dates).
