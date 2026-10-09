# Stripe conventions

Applies to any code that creates charges, subscriptions, refunds, or invoices, onboards connected accounts, or handles Stripe events. Decisions: [ADR 0001](../decisions/0001-core-platform.md) (Stripe), [ADR 0012](../decisions/0012-stripe-connect.md) (Connect, the application fee, webhooks, testing).

## Keys and modes

- Agents use test keys only (`sk_test_…`, `pk_test_…`) from a Stripe **sandbox** the owner created, stored as Convex environment variables, never in the repo.
- Sandbox keys go only on owner-named cloud dev deployments. Previews and staging get no Stripe variable; the deploy check fails if one is set (ADR 0012, Decision 7).
- Live-mode keys, live webhook endpoints, and live product/price configuration belong to the owner and change only through `gate:production`.

## Client

- Use the `stripe` package in Convex's default runtime: `new Stripe(key, { httpClient: Stripe.createFetchHttpClient(), apiVersion: '2026-09-30.endive' })`. No `"use node"` for Stripe code.
- Every Stripe call goes through `convex/stripe/gateway.ts`. Under `IS_TEST` it returns the fake gateway; the real gateway throws `stripe_not_configured` before any network call when `STRIPE_SECRET_KEY` is unset.
- External calls happen only in actions and HTTP actions (Convex conventions).

## Connect

- Each organization has one v2 `Account`: `dashboard: full`, `fees_collector: stripe`, `losses_collector: stripe`, with the `merchant` and `customer` configurations. Onboarding uses Stripe-hosted Account Links.
- Player and team payments are **direct charges**: a Checkout Session created with the `Stripe-Account` header and `payment_intent_data.application_fee_amount`.
- Only org admins of that organization start onboarding or read its status.
- The connected account id comes only from Stripe's API response. No public function takes an account id, amount, fee, price, or currency as an argument.
- The application fee is the **greater of** a percentage of the payment and a per-player floor for the roster entries and prepaid slots the payment pays for the first time (ADR 0012, "Application fee calculation"). Compute every fee, on Checkout and on a bill, with the one server helper `convex/payments/fee.ts`, never inline.
- The helper uses integer cents only: the percentage in basis points (`APPLICATION_FEE_PERCENT_BPS`) and the floor in cents (`APPLICATION_FEE_FLOOR_CENTS`), both copied onto the season at publish. Round only the percentage part, once per payment, half up to the cent.
- `application_fee_amount` must be positive and below the charge. Send at most `amount − 50` cents and bill the rest as a shortfall. Omit the parameter when the carried fee is 0.
- Store the fee inputs and parts on the payment record, so every fee can be recomputed from it.
- Fees that no payment carries are **billed**: a pending invoice item on the organization's account (`customer_account`), invoiced monthly. Each item carries its final amount; nothing is recomputed at invoice time.

## Flows

- Prices and amounts come from the server (Convex), never from the client.
- Prefer Stripe-hosted surfaces (Checkout, hosted onboarding, hosted invoice page) over collecting card or identity details in the app; card data never touches the system's code.
- Every mutating Stripe API call sends an idempotency key derived from the system's own record id, `<operation>:<recordId>` (for example `checkout:<paymentId>`). Never a random key.
- Write Stripe ids returned by a call back through an internal mutation before doing anything else, so a retry finds them.

## Webhooks

- Two routes: `POST /stripe/webhook` (Your account, `STRIPE_WEBHOOK_SECRET`) and `POST /stripe/webhook/connect` (Connected accounts, `STRIPE_CONNECT_WEBHOOK_SECRET`). A route returns 404 when its secret is unset.
- The signature is verified against the raw body before anything else (`constructEventAsync` with the SubtleCrypto provider). Invalid or missing: 400, nothing recorded or logged.
- Both routes share one processed-event store, `stripeEvents`, keyed by event id. One internal mutation checks the id, records the event, and applies the change in the same transaction. A duplicate returns 200 and changes nothing.
- Check `event.livemode` against the deployment. Map `event.account` to exactly one organization; unknown accounts change nothing.
- Before applying a `checkout.session.*` event, check that the payment's organization owns `event.account` and that amount, currency, and session id match the stored payment.
- State transitions are monotonic: never move `paid` back, and ignore events that arrive after a later state.
- Call Stripe after the 2xx, from a scheduled internal action, not inside the route.
- The database is updated from webhook events, not from the client's redirect after checkout; the redirect only shows status.
- Handle at least: successful payment, failed payment, expiry, refund, and dispute for any flow that takes money; account status and disconnection for Connect; paid, failed, voided, and uncollectible for platform bills. ADR 0012, Decision 5 lists each event and its outcome.

## Tests

- Payment PRs include tests for success, failure, duplicate webhook delivery, an invalid signature, an unknown connected account, and a payment event from another organization's account.
- The fee helper has unit tests for: the percentage part larger, the floor part larger, rounding at half a cent, the cap with a shortfall, and a carried fee of 0.
- E2E and `ci` never call Stripe and hold no Stripe secret: the fake gateway runs under `IS_TEST`, and tests sign their own webhook events with per-run secrets.
- Manual verification uses a Stripe sandbox, test cards, and the Stripe CLI (installed per machine, never in `ci`) against an owner-named dev deployment.
