# 0012: Stripe Connect for organization payments and the application fee

- **Status:** Accepted
- **Gate:** `gate:technology`
- **Issue:** #57
- **Date:** 2026-10-09 (Stripe docs, Stripe pricing pages, the npm registry, and GitHub releases checked 2026-10-09; merging the PR is the owner's acceptance). Revised the same day for the owner's greater-of fee decision.

## Context

ADR 0001 accepts Stripe, but neither it nor `docs/conventions/stripe.md` covers Stripe Connect. The owner decided that each organization connects its own Stripe account, players pay the organization, and the platform takes an application fee that cannot be avoided by under-registering players ([requirements, Payments](../product/requirements.md#payments), recorded by #68). This ADR decides how that works on Stripe, how Convex talks to Stripe, how webhooks are handled, and how payments are tested without secrets.

On this PR the owner asked whether an organization could still list one player when two or more play ([comment](https://github.com/jasonbryan/omni-league/pull/74#issuecomment-6085088864)). The owner then decided the fee amount (2026-10-09, chat): "Hybrid: % of payment, per-player floor". The fee is the greater of a percentage of each registration payment and a per-player floor. "Application fee calculation" below maps this to Stripe; the requirements and glossary are updated in this PR to match.

It covers the eight decision items of #57:

1. Connected account type
2. Charge type and application fee mechanics
3. Billing the organization's connected account when no player payment carries the fee
4. Stripe client and Stripe CLI
5. Webhooks, failure states, and idempotency
6. Tenancy and authorization
7. Test mode, CI, and per-deployment keys
8. Changes to `docs/conventions/stripe.md` (made in this PR)

### Constraints

| Source                                                                                                          | Constraint used here                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Requirements, Payments](../product/requirements.md#payments) (owner, 2026-10-09)                               | Fee is the greater of a percentage of each registration payment and a per-player floor; the floor applies to every roster entry whatever the pricing; everyone who plays is rostered; minimum roster size per sport format; a team is confirmed only when its roster meets the minimum and every entry's fee is paid; a team payment's floor counts the larger of roster size and minimum; late additions pay before they are active; rosters are visible to opponents. |
| [Requirements, Free seasons and offline payments](../product/requirements.md#free-seasons-and-offline-payments) | The fee applies in free seasons and to offline payments. When no player payment carries the fee, the platform bills the organization's connected account ("Yes, org is invoiced").                                                                                                                                                                                                                                                                                      |
| [Requirements, Organizations and staff](../product/requirements.md#organizations-and-staff)                     | The organization is the access boundary. Org admins manage everything in their organization; league organizers only their assigned leagues.                                                                                                                                                                                                                                                                                                                             |
| AGENTS.md, Secrets; [Stripe conventions](../conventions/stripe.md)                                              | Agents use test keys only. Live keys, live webhook endpoints, and live configuration are the owner's, through `gate:production`. Prices come from the server. Stripe-hosted surfaces only. Webhooks are verified, idempotent, and the source of truth.                                                                                                                                                                                                                  |
| [ADR 0005](0005-e2e-and-accessibility-testing.md), [ADR 0009](0009-ci-pipeline.md)                              | E2E runs on the anonymous local Convex backend with no secrets. Test-only functions are internal and guarded by `IS_TEST`. No `ci` step may call Stripe.                                                                                                                                                                                                                                                                                                                |
| [ADR 0010](0010-hosting-and-deployment.md), [hosting](../process/hosting.md)                                    | Each preview (`pr-<n>`) and staging (`main`) is a Convex preview deployment that is deleted and recreated on every push or merge, so its `*.convex.site` URL is new each time. Previews and staging share one set of Convex default preview variables. Budget: about $25/month for hosting and Convex.                                                                                                                                                                  |
| [ADR 0003](0003-package-manager-and-node.md)                                                                    | Fail-closed `allowScripts`; minimum release age 3 days; no standing exclusions.                                                                                                                                                                                                                                                                                                                                                                                         |
| [ADR 0011](0011-transactional-email.md)                                                                         | Pattern reused: a webhook route that returns 404 when its secret is unset, a deploy check on variable names, and an `IS_TEST`-only test path.                                                                                                                                                                                                                                                                                                                           |

### Stripe facts that shape the decision (checked 2026-10-09)

| Fact                                                                                                                                                                                                                                                                                                                                                                                        | Source                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standard, Express, and Custom account types are marked **deprecated** for new platforms. Stripe recommends the Accounts v2 API, or Accounts v1 with controller properties where v2 lacks a feature.                                                                                                                                                                                         | [Connected account types](https://docs.stripe.com/connect/accounts)                                                                                            |
| "The Accounts v2 API is GA for Connect users." A v2 `Account` takes configurations: `merchant` (accept payments), `customer` (the platform can bill it), `recipient` (receive transfers). v1 endpoints accept a v2 account id.                                                                                                                                                              | [Accounts v2](https://docs.stripe.com/connect/accounts-v2), [Accounts as customers](https://docs.stripe.com/accounts-v2/use-accounts-as-customers)             |
| `defaults.responsibilities.fees_collector` and `losses_collector` (`stripe` or `application`) are set once, when the merchant configuration is added, and cannot be changed. `losses_collector: application` requires `fees_collector: application`. KYC is Stripe's unless losses are the platform's and `dashboard` is `none`.                                                            | [Configure connected accounts](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration)                                                    |
| Stripe-owned pricing (connected accounts pay Stripe fees, carry their own negative balances, use direct charges): "Stripe doesn't charge your platform in this model." Connect pricing: no monthly active account fee and no payout fee. Platform-handled pricing: $2 per monthly active account, 0.25% + 25¢ per payout, account debits 1.5%.                                              | [SaaS platform](https://docs.stripe.com/connect/saas), [Connect pricing](https://stripe.com/connect/pricing)                                                   |
| `application_fee_amount` "must be positive and less than the amount of the charge. The application fee collected is capped at the captured amount of the charge." Application fees are not refunded on a refund unless `refund_application_fee=true` (whole fee on a full refund, proportional on a partial one). No Stripe fee on the application fee itself.                              | [Direct charges](https://docs.stripe.com/connect/direct-charges?platform=web&ui=stripe-hosted)                                                                 |
| Stripe's no-code Platform Pricing Tool is "only available for platforms responsible for paying Stripe fees", and a fee set on the PaymentIntent overrides it. Under 1A the platform does not pay Stripe fees, so the fee is computed by the platform's own code.                                                                                                                            | [Direct charges, collect fees](https://docs.stripe.com/connect/direct-charges?platform=web&ui=stripe-hosted)                                                   |
| Direct charges: the disputed amount is debited from the connected account; with `fees_collector: stripe` the connected account pays the dispute fee. US dispute fee $15, returned only if the dispute is won.                                                                                                                                                                               | [Connect disputes](https://docs.stripe.com/connect/disputes), [Stripe pricing](https://stripe.com/pricing)                                                     |
| Account debits "only supported for connected accounts where your platform is responsible for negative balances." Otherwise: "create a customer for each connected account and charge them using Stripe Billing."                                                                                                                                                                            | [Debit connected accounts](https://docs.stripe.com/connect/account-debits)                                                                                     |
| "Pay with Stripe balance" is a **preview**, Accounts v2 only, "only ... to charge subscription payments", and the balance must cover the full amount. 1% of volume.                                                                                                                                                                                                                         | [Pay with Stripe balance](https://docs.stripe.com/payments/pay-with-balance), [Connect pricing](https://stripe.com/connect/pricing)                            |
| Stripe Invoicing Starter: 0.4% per paid invoice. Stripe Billing pay-as-you-go: 0.7% of Billing volume, excluding one-off invoices. US cards 2.9% + 30¢; ACH Direct Debit 0.8%, capped at $5.                                                                                                                                                                                                | [Invoicing pricing](https://stripe.com/invoicing/pricing), [Billing pricing](https://stripe.com/billing/pricing), [Stripe pricing](https://stripe.com/pricing) |
| Connect webhooks have two scopes: **Your account** and **Connected accounts**, each its own endpoint and signing secret. Connected-account events carry a top-level `account`. Direct-charge events and v1 `account.updated` for v2 accounts arrive in the Connected accounts scope. A production Connect endpoint "receive[s] both live and test webhooks", so `livemode` must be checked. | [Connect webhooks](https://docs.stripe.com/connect/webhooks), [Webhooks](https://docs.stripe.com/webhooks)                                                     |
| At most **16 event destinations** per account. Live retries for up to 3 days; sandbox retries three times over a few hours. Ordering is not guaranteed. Duplicates happen; dedupe by event id. Signature: HMAC-SHA256 of `t.payload`, `v1` scheme only, default tolerance 5 minutes, constant-time compare, raw body.                                                                       | [Webhooks](https://docs.stripe.com/webhooks)                                                                                                                   |
| v1 idempotency keys: up to 255 characters, pruned after at least 24 hours, parameters compared, the first result (including a 500) replayed. v2: 30 days, scoped per account, failed requests re-executed.                                                                                                                                                                                  | [Idempotent requests](https://docs.stripe.com/api/idempotent_requests), [API v2 overview](https://docs.stripe.com/api-v2-overview)                             |
| General sandboxes: up to five per account, isolated settings, full v2 API support, test keys. The test mode sandbox only partly supports v2. Sandbox Connect platforms cannot connect to accounts in other sandboxes.                                                                                                                                                                       | [Testing use cases](https://docs.stripe.com/testing-use-cases), [Sandboxes](https://docs.stripe.com/sandboxes)                                                 |
| Checkout `expires_at`: 30 minutes to 24 hours (default 24 hours). Minimum charge 0.50 USD.                                                                                                                                                                                                                                                                                                  | [Create a Checkout Session](https://docs.stripe.com/api/checkout/sessions/create), [Currencies](https://docs.stripe.com/currencies)                            |
| `stripe` (npm) **23.0.0**, MIT, published 2026-10-01, pins API version `2026-09-30.endive`, no dependencies, no install script, ships a `worker` build (fetch + SubtleCrypto).                                                                                                                                                                                                              | npm registry; package `CHANGELOG.md`                                                                                                                           |
| Stripe CLI **1.53.0** (2026-09-30; 1.53.1 on 2026-10-07 is inside the 3-day release age). Binary licence Apache-2.0 ([repo](https://github.com/stripe/stripe-cli)); npm wrapper `@stripe/cli` MIT with a `postinstall` script.                                                                                                                                                              | npm registry, GitHub releases                                                                                                                                  |

### Assumptions on questions still open for the owner

These are [requirements, Open](../product/requirements.md#open) 3 to 6. The ADR does not decide them. Each assumption is isolated so the answer changes one value or one branch, not the design.

| Open question                             | Assumption used here                                                                                                                                                                                                                      | What changes with the answer                                                                                                                                                                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **3. Fee percentage**                     | An integer in basis points, `APPLICATION_FEE_PERCENT_BPS` (500 = 5%), read on the server and copied onto each season when it is published, so a later change never alters an open season. No value is assumed; examples use placeholders. | The value only.                                                                                                                                                                                                                          |
| **4. Per-player floor**                   | An integer in cents, `APPLICATION_FEE_FLOOR_CENTS`, handled the same way.                                                                                                                                                                 | The value only. The floor also sets the lowest prices a season may have (pricing guard below).                                                                                                                                           |
| **5. Fee shown to the payer** or absorbed | **Absorbed:** the Checkout amount is the organization's price; the fee comes out of it.                                                                                                                                                   | If shown: Checkout gets a second line item, "Platform fee", and the amount becomes price + fee. The percentage is still taken of the organization's price, not of price + fee, so the fee never depends on itself. No other change.      |
| **6. Fee on refunds and lost disputes**   | **Kept:** refunds the platform makes send `refund_application_fee=false`; no fee refund on a lost dispute.                                                                                                                                | If returned: refunds send `refund_application_fee=true`, a lost dispute triggers an application fee refund, and the fee is recalculated on what remains, with any floor still owed billed (see "Refunds and disputes under greater-of"). |

Other assumptions the merge confirms (none of them is in the requirements, and each can be changed on review):

- **US organizations and USD** at launch. The platform account and every connected account are US; prices are USD.
- **Unpaid platform bill policy**, **roster removal after payment**, and **late additions under team-only pricing**, as stated under Decision 3 and "Fee rules mapped to Stripe objects".
- **How greater-of is applied:** per Checkout session; on an offline payment, the percentage is taken of the season's listed price; rounding half up to the cent. All under "Application fee calculation".

## Options and decisions

### Decision 1: connected account configuration

#### Option 1A: Accounts v2, `dashboard: full`, Stripe collects fees and carries losses (recommended)

- A v2 `Account` per organization with the `merchant` configuration (`card_payments` requested) and the `customer` configuration (so the platform can invoice it, Decision 3).
- `dashboard: "full"`, `defaults.responsibilities.fees_collector: "stripe"`, `losses_collector: "stripe"`, `defaults.currency: "usd"`. Requirements collection is then Stripe's.
- This is the configuration behind Stripe-owned pricing: **no Connect fee to the platform**, no monthly active account fee, no payout fee.
- The organization pays Stripe's processing fee (2.9% + 30¢ per US card charge) and carries its own refunds, disputes, and negative balances.
- Onboarding is Stripe-hosted: a v2 Account Link (`use_case.type: account_onboarding`, `collection_options.fields: eventually_due`), single-use, expiring within minutes. The organization manages payouts, refunds, and disputes in the full Stripe Dashboard; the app builds none of that.
- Cons: the organization sees a Stripe account, not a white-labelled one. The platform cannot debit the account (account debits need platform loss liability). An organization with the full Dashboard can refund players and disconnect from the platform on its own; both are handled under Decision 5.

#### Option 1B: Accounts v1 with controller properties, same responsibilities

- `controller.fees.payer: account`, `controller.losses.payments: stripe`, `controller.stripe_dashboard.type: full`. Same money flow and cost as 1A.
- Cons: billing the organization needs a separate `Customer` object and a map from account id to customer id ("If you use the Accounts v1 API, you can't pass an Account ID to an endpoint that expects a Customer ID"). Stripe calls v1 the limited option and discourages running both.

#### Option 1C: platform-controlled accounts (`dashboard: express` or `none`, platform carries losses)

- Enables destination charges and account debits.
- Cons: the platform carries every organization's negative balances and dispute losses; Stripe holds a reserve on the platform's balance when a connected account goes negative. Connect fees apply: $2 per monthly active account plus 0.25% + 25¢ per payout. Twenty active organizations cost $40 a month before any payout fee, which on its own is above the whole $25 hosting budget, with no revenue offset beyond the application fee. With `dashboard: none` the platform must build payout, refund, and dispute screens.

#### Option 1D: legacy Standard accounts through OAuth

- Lets organizations that already have a Stripe account connect it.
- Cons: deprecated for new platforms. v2 onboarding already offers networked onboarding, which reuses details from an owner's other Stripe accounts.

**Decision 1: Option 1A.** It costs the platform nothing per account, leaves loss liability with Stripe and the organization, needs no payout or dispute UI, and is the only option that gives the platform a billable customer on the same object (Decision 3).

### Decision 2: charge type and application fee mechanics

#### Option 2A: direct charges through Stripe Checkout with `payment_intent_data.application_fee_amount` (recommended)

- The server creates a Checkout Session **on the connected account** (`Stripe-Account` header), `mode: payment`, `ui_mode: hosted_page`, with the line items, `payment_intent_data.application_fee_amount`, `client_reference_id` and `metadata.paymentId` set to the system's `payments` record id, `metadata.organizationId`, and `expires_at` = now + 30 minutes (the minimum, which bounds slot reservations below).
- The organization is the merchant of record; Checkout shows its branding; the player's statement shows the organization.
- Stripe deducts its processing fee and the application fee from the payment. Example with the fee absorbed and placeholder rates (5%, $1.00 floor; not decided): a $50.00 player price carries max($2.50, $1.00) = $2.50 and nets the organization $50.00 − $1.75 (2.9% + 30¢) − $2.50 = $45.75.
- Stripe recommends direct charges for full-Dashboard accounts and for SaaS platforms.
- Cons: payment objects live on the connected account, so every read uses `Stripe-Account`. The organization can refund from its Dashboard without the platform's involvement (handled by `charge.refunded`).

#### Option 2B: destination charges with `on_behalf_of`

- The charge is on the platform with `transfer_data.destination`; the platform pays Stripe fees and carries refunds and disputes.
- Cons: requires the platform to carry losses (Option 1C) and the `recipient` configuration; Stripe advises against Stripe-liable accounts with destination charges. Same cost problem as 1C.

#### Option 2C: separate charges and transfers

- One platform charge split across several accounts.
- Cons: same liability and cost as 2B, and every transfer and reversal is the platform's code. No payment in this product goes to more than one organization.

**Decision 2: Option 2A.** It matches 1A, costs the platform nothing, and leaves refunds and disputes with the organization.

**Who pays what (2A with 1A):**

| Cost                               | Paid by                                                   |
| ---------------------------------- | --------------------------------------------------------- |
| Card processing (2.9% + 30¢ US)    | Organization, deducted from the payment                   |
| Application fee (greater-of)       | Organization, deducted from the payment, to the platform  |
| Refunds                            | Organization's balance (fee kept, per assumption 6)       |
| Dispute amount and $15 dispute fee | Organization's balance; Stripe carries a negative balance |
| Connect platform fees              | None                                                      |

### Decision 3: billing the connected account when no payment carries the fee

The owner decided the organization is billed (free seasons, offline payments, and any roster entry whose fee no player payment carries). This decision is how.

#### Option 3A: one-off Stripe invoices to the organization's customer-configured account (recommended)

- Each fee that no payment carries becomes a **pending invoice item** on the organization's v2 account (`customer_account`), created when the fee is billed (below), with idempotency key `invoice-item:<billedFeeId>`.
- A monthly Convex cron (the 1st, 06:00 UTC) creates and finalizes one invoice per organization with pending items: `collection_method: send_invoice`, `days_until_due: 14`, `pending_invoice_items_behavior: include`, payment methods card and US bank account (ACH). Stripe emails the hosted invoice link to the account's contact email. A total under $0.50 (Stripe's minimum) rolls to the next month.
- Cost to the platform: Invoicing 0.4% of each paid invoice plus processing on the invoice payment, because the platform is the merchant for its own invoice: card 2.9% + 30¢, or ACH 0.8% (cap $5). Example: 40 billed entries at a $1.00 floor (placeholder) is a $40.00 invoice: $0.16 + $1.46 by card ($1.62, 4.1%), or $0.16 + $0.32 by ACH ($0.48, 1.2%).
- Works whatever the organization's balance, including organizations that only run free seasons and have no balance at all.
- Cons: collection depends on the organization paying; unpaid bills need a policy (below). The platform pays processing on its own invoices (the percentage and floor, Open 3 and 4, can account for this).

#### Option 3B: account debits

- Pulls the fee from the connected account's Stripe balance (`POST /v1/charges` with `source=<account>`).
- Cons: only for accounts whose losses the platform carries, so it forces Option 1C with its Connect fees; 1.5% of debit volume; listed "Not available" under Stripe-owned pricing. An organization with only free seasons has no balance to debit.

#### Option 3C: netting against the organization's next player payment

- Adds unbilled fees to the next Checkout's `application_fee_amount`.
- Cons: never collects from an organization with no further online payments (free-only or offline-only organizations, which are the cases this decision exists for); capped below each charge; makes one player's payment carry other players' fees, which complicates refunds and reporting.

#### Option 3D: a Billing subscription with usage-based pricing, paid from the Stripe balance

- Monthly subscription; billed entries reported as usage; "Pay with Stripe balance" as the payment method.
- Cons: Pay with Stripe balance is a preview, subscriptions only, and fails unless the balance covers the whole amount; organizations with only free seasons have no balance. Costs 0.7% (Billing) plus 1%. Revisit if it becomes generally available and the owner wants automatic collection.

**Decision 3: Option 3A.**

**When a fee is billed** (it becomes a `billedFees` record and a pending invoice item at that moment; amounts from "Application fee calculation"):

- A roster entry is added to a team in a **free season** (zero team and player price): the floor.
- An organizer **marks a team or a roster entry paid offline**: the greater-of on the season's listed price.
- A late addition under **team-only pricing** (no player price; see the rules below): the floor.
- The **shortfall** of a payment whose fee Stripe cannot carry in full (see "Never above the charge").
- If the owner answers Open 6 with "returned": a **refund top-up** when a refund or lost dispute leaves less than the fee still owed.

**Effect on team confirmation:** a **billed** fee counts as paid for rule 4 at once, so free-season and offline teams are confirmed without waiting for the monthly invoice.

**Unpaid bill (proposed; the merge confirms):**

| State                     | Trigger                                                                              | Effect                                                                                                                                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open`                    | `invoice.finalized`                                                                  | Org admins see the amount and the hosted invoice link. No restriction.                                                                                                                                                                                                      |
| `past_due`                | A daily cron finds an `open` bill past its due date (no Dashboard automation needed) | The organization cannot publish a new season, mark an offline payment, or add a roster entry whose fee would be billed (free-season joins and team-only late additions). Player Checkout payments continue, since they carry their own fee. Confirmed teams stay confirmed. |
| `paid`                    | `invoice.paid`                                                                       | Restrictions lifted at once.                                                                                                                                                                                                                                                |
| `uncollectible` or `void` | `invoice.marked_uncollectible`, `invoice.voided` (owner action in the Dashboard)     | Recorded. `uncollectible` keeps the `past_due` restrictions until the owner clears them; `void` lifts them.                                                                                                                                                                 |
| Payment attempt failed    | `invoice.payment_failed`                                                             | Recorded; the bill stays `open` or `past_due`. Org admins are shown the hosted link again.                                                                                                                                                                                  |

No player loses an active roster entry because of the organization's bill. The cost is that players in a past-due organization's free season cannot join until the bill is paid.

### Application fee calculation

Owner decision, 2026-10-09 (chat): "Hybrid: % of payment, per-player floor". The fee is the greater of a percentage of the payment and a per-player floor for the roster entries the payment pays for.

**One pure helper,** `convex/payments/fee.ts`, computes every fee on the server: each Checkout session's `application_fee_amount` and each billed fee. It uses integer cents and no floating point. No other code computes a fee, and no fee input comes from the client.

```text
inputs (integers)
  base        the organization's price on this payment, in cents:
              the Checkout amount while the fee is absorbed (Open 5), the season's listed price
              for an offline payment, 0 for a free-season entry or a team-only late addition
  bps         the season's percentage in basis points, copied at publish (Open 3)
  floorCents  the season's per-player floor in cents, copied at publish (Open 4)
  count       roster entries and prepaid slots this payment pays the floor for, for the first time
  amount      the charge Stripe takes: base, or base + fee if the fee is shown (Open 5); none if no Checkout

percentPart = floor((base × bps + 5000) / 10000)    rounded half up to the cent
floorPart   = floorCents × count
owed        = max(percentPart, floorPart)
carried     = min(owed, amount − 50)                application_fee_amount; 0 when there is no Checkout
shortfall   = owed − carried                        billed to the organization (Decision 3)
```

- **Rounding:** only the percentage part is rounded, once per payment, half up to the cent. The floor part is exact. A recorded fee never changes, and a platform bill's total is the sum of already-rounded items.
- **Never above the charge:** Stripe requires `application_fee_amount` to be positive and less than the charge, and caps collection at the captured amount. `carried` is at most `amount − 50`, so the organization keeps at least $0.50 of each charge before its processing fee. If `carried` is 0, the parameter is omitted. The rest of `owed` is the shortfall, which is billed. A Checkout is never created with a fee at or above its amount.
- **Pricing guard at publish:** a player price is 0 or at least `floorCents + 50`; a team price is 0 or at least `floorCents × minimum + 50`. The organizer sees these minimums in the pricing form. The checkout-time cap covers any case the guard misses, such as a very large roster or a high percentage.
- **Validation:** the helper throws if `bps` is outside 0 to 9999 (a 100% fee could never be carried) or any input is negative. Publishing a season with invalid copied values fails.
- **Stored on the payment:** `base`, `bps`, `floorCents`, `count`, `percentPart`, `floorPart`, `owed`, `carried`, and `shortfall`, so every fee can be recomputed from its record in tests and reconciliation.

**Where greater-of applies:**

| Option                            | How                                                                                | Pros                                                                                                                                                      | Cons                                                                                                                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Per Checkout session (chosen)** | Each payment's fee is the greater-of on that payment alone.                        | A fee depends only on its own payment, so refunds, disputes, and reconciliation map to one payment. Matches "a percentage of every registration payment". | Under split pricing a season's total can exceed the greater-of taken over the whole season, because the team payment carries the floor and each player payment adds its percentage. |
| Per team, cumulative              | Each payment's fee is the team's greater-of to date minus fees already taken.      | The team's total is exactly its greater-of.                                                                                                               | A fee depends on earlier payments; refunding an earlier payment changes later fees; many more states to test.                                                                       |
| Floor settled at season end       | Checkout takes the percentage only; a floor top-up is billed when the season ends. | Exact over the season.                                                                                                                                    | Moves the floor from Checkout, where it is collected with the payment, to a bill the organization can leave unpaid.                                                                 |

**Each case** (placeholder rates 5% and a $2.00 floor, not decided):

| Case                                                                                          | `base`                      | `count`                        | Fee                          | Where it goes            |
| --------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------ | ---------------------------- | ------------------------ |
| Team payment, $200, 6 rostered, minimum 4                                                     | $200                        | 6                              | max($10.00, $12.00) = $12.00 | Checkout                 |
| Same team listing only 4 of the 6 who play                                                    | $200                        | 4                              | max($10.00, $8.00) = $10.00  | Checkout                 |
| Team payment, 2 accepted, minimum 4                                                           | team price                  | 4 (2 entries, 2 prepaid slots) | greater-of                   | Checkout                 |
| Split pricing: player payment for an entry the team payment already carried                   | player price                | 0                              | percentage only              | Checkout; omitted if 0   |
| Player payment for an entry not yet carried (per-player pricing, or beyond the prepaid slots) | player price                | 1                              | greater-of                   | Checkout                 |
| Late addition with a player price                                                             | player price                | 1                              | greater-of                   | `late_addition` Checkout |
| Late addition under team-only pricing                                                         | 0                           | 1                              | floor                        | Billed                   |
| Free-season entry                                                                             | 0                           | 1                              | floor                        | Billed                   |
| Offline payment of a team or an entry (proposed)                                              | listed team or player price | as the online payment          | greater-of                   | Billed                   |
| Fee above `amount − 50`                                                                       | as above                    | as above                       | `carried` on Checkout        | Shortfall billed         |

The first two rows answer the owner's question: listing fewer players than play saves at most the floor for each unlisted player, and nothing once the percentage part is the larger.

**Refunds and disputes under greater-of:**

- **Kept (assumption 6):** platform refunds send `refund_application_fee=false`, and a lost dispute returns no fee. The recorded fee does not change. An organization refunding from its own Dashboard does not return the application fee either; the platform records the refund.
- **If Open 6 is "returned":** platform refunds send `refund_application_fee=true`; Stripe returns the whole fee on a full refund and a proportional share on a partial one. A refund the organization makes from its Dashboard, and a lost dispute, are followed by an application fee refund from the platform (same proportion). The helper then recomputes `owed` with `base` = the amount still kept and `count` = this payment's entries still rostered. If the fee the platform still holds from the payment, plus any shortfall billed for it, is below the new `owed`, the difference is billed as a refund top-up. A refund therefore never takes a player who stays rostered below the floor.

**Monthly platform bill:** each billed fee is one pending invoice item with its final amount and a description naming the season and the reason (free season, offline payment, team-only late addition, shortfall, refund top-up). The invoice total is the sum of the items; no percentage or rounding is applied at invoice time. A total under $0.50 rolls to the next month (Decision 3).

### Fee rules mapped to Stripe objects

The floor for each roster entry is paid **exactly once**, by one of three things: a player or team **payment** (application fee on a Checkout direct charge), a **prepaid slot** of a team payment, or a **billed fee**. The percentage is taken on every payment. A sketch of the records (the slices fix the schema):

- `payments`: organization, season, team, payer, kind (`team`, `player`, `late_addition`), amount, the fee fields above, `entriesCarried`, `slotsCarried`, Checkout Session id, status (`pending`, `paid`, `failed`, `expired`, `refunded`, `partially_refunded`, `disputed`, `dispute_lost`).
- `feeAssessments`: one per roster entry (or prepaid slot), status `unassessed`, `reserved` (by a pending payment), `carried` (payment id), `prepaid_slot` (team payment id, no entry yet), `billed` (billed fee id).
- `billedFees`: organization, season, reason (`free_season`, `offline`, `team_only_late_addition`, `shortfall`, `refund_top_up`), the payment or roster entries it covers, amount, invoice item id, status (`pending`, `invoiced`, `collected`, `uncollectible`).
- `platformBills`: organization, Stripe invoice id, period, amount, status.
- `stripeEvents`: the processed-event store (Decision 5).

| Requirement rule                                                          | How it maps                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Greater of a percentage and a per-player floor                            | "Application fee calculation" above, per Checkout session.                                                                                                                                                                                              |
| 1. **Per rostered player**, whatever the pricing                          | Every roster entry gets a `feeAssessment`. A pending invite gets none. A payment's `count` is the entries and slots it carries for the first time.                                                                                                      |
| 2. **Everyone who plays is rostered**                                     | Not a Stripe concern. Score reports and stat lines only accept **active** roster entries: those whose fee is `carried`, `prepaid_slot`-filled, or `billed` (whatever the bill's state).                                                                 |
| 3. **Minimum roster size**                                                | Read from the sport configuration (raised, never lowered, by the organization). A team payment's `count = max(rosterEntries, minimum)`: one floor per current entry plus one **prepaid slot** per missing entry up to the minimum.                      |
| 4. **Confirmed only when** roster ≥ minimum and every entry's fee is paid | A team is confirmed when it has at least `minimum` roster entries and none of them is `unassessed` or `reserved`. Re-evaluated in the mutation that applies each payment, billing, or roster change.                                                    |
| 5. **Late additions pay**                                                 | An entry added after the team's payment, with no free prepaid slot, is inactive until its fee is paid: by a `late_addition` Checkout at the season's player price if there is one, otherwise billed to the organization (team-only pricing; see below). |
| 6. **Rosters visible to opponents**                                       | Not a Stripe concern. A roster slice shows each team's roster entries to the other teams of the season (`gate:ui-design`).                                                                                                                              |
| Free seasons and offline payments                                         | A billed fee (Decision 3). An offline payment never creates a Stripe payment; it only bills the fee.                                                                                                                                                    |

**The cases #57 asks about:**

- **Invite accepted after the team paid for the minimum:** already covered. The accepted entry fills one of the team payment's prepaid slots; nothing is charged again. Only an entry beyond the slots paid for is a late addition.
- **Roster removal after payment (proposed):** the fee is kept; nothing is refunded. A removed entry's slot becomes a free prepaid slot that a replacement can fill without a new fee **until the season's first scheduled game**. After that, every new entry pays its own floor, so a slot cannot be shared by players who both play.
- **Split pricing** (a team price and a player price): the team payment pays the floor for its `count`. A player payment for an entry already carried pays only the percentage; one for an entry not yet carried pays the greater-of with `count` 1.
- **Late addition under team-only pricing (proposed):** there is no player price to charge, and Stripe refuses a charge whose application fee equals the whole amount, so a fee-only Checkout on the organization's account is impossible. The floor is billed to the organization and the entry is active at once. The organization may collect from the player outside the platform.
- **Fee larger than the charge:** the pricing guard and the checkout-time cap above. The shortfall is billed.
- **Zero-price season:** no Checkout at all; every entry's floor is billed.

**Concurrency:** creating a payment reserves its entries and slots (`reserved`) in the same mutation. A second payment cannot reserve them. `checkout.session.expired` or `async_payment_failed` releases them; Checkout's 30-minute expiry bounds the hold.

**Residual gaps:**

- **Under-rostering combined with money taken outside the platform still evades the fee, and the system cannot detect it.** The percentage sees only money paid through Checkout or marked offline; the floor sees only rostered players. An organization that lists only the minimum and collects the other players' money in cash or through another payment app pays nothing on those players. Under-rostering alone, with all money through Checkout, saves at most the floor for each unlisted player (rows 1 and 2 above).
- **Mitigations kept** (requirements, rules 2, 3, and 6): the minimum roster size per format, met by accepted players only, bounds how few players a team can list; only rostered players get scores and stat lines; rosters are visible to opponents, so an unlisted player can be noticed by the other team and the organizer. None of these proves who played or what was paid.
- **Beyond that it is a terms-of-service matter.** Terms that require every player to be rostered and every registration payment to go through the platform or be marked offline, with suspension as the remedy, are the owner's to write. No terms document exists yet, and this ADR does not add one.
- **Collection depends on the organization paying its bill.** There is no automatic debit (Decision 3). The `past_due` restrictions are the only lever.
- **Organization-initiated refunds:** with the full Dashboard an organization can refund a player's payment itself; the platform keeps the fee (assumption 6) and records the refund.
- **Disconnection:** an organization can disconnect its account (Decision 5). Fees billed but not yet invoiced may then be uncollectible if Stripe no longer allows invoicing the account; the sandbox test checks this before the first payment slice merges.

### Decision 4: Stripe client and Stripe CLI

#### Option 4A: the `stripe` package in Convex's default runtime (recommended)

- `stripe` **23.0.x** (MIT, no dependencies, no install script), constructed with `httpClient: Stripe.createFetchHttpClient()` and `apiVersion: '2026-09-30.endive'` pinned explicitly. Webhooks are verified with `stripe.webhooks.constructEventAsync(body, header, secret, undefined, Stripe.createSubtleCryptoProvider())` inside the HTTP action.
- Verified in the scratch run (Test evidence): signature verification, rejection of a wrong secret, a tampered body, a 10-minute-old timestamp, and a missing header all worked in a default-runtime HTTP action, and an API call sent the `Stripe-Account`, `Idempotency-Key`, and `Stripe-Version` headers. The `worker` build bundles to about 0.7 MB (0.23 MB minified), far inside Convex's 230 MB deployment limit.
- Pros: Stripe's own signature check and types (v1 and v2), idempotency and `stripeAccount` request options, form encoding of nested v1 parameters, and v2 JSON handled by the package. The Convex Stripe component already uses this same call in the default runtime.
- Cons: a new major roughly every few months, and each major pins a new API version. A major bump is a new decision (not a minor or patch), and webhook endpoints must be moved to the same API version at the same time.

#### Option 4B: the `stripe` package in a `"use node"` action

- Cons: HTTP actions cannot use the Node runtime, so every webhook would hop from the HTTP action to a Node action (`ctx.runAction`), adding a Node cold start on Convex cloud before the 2xx. Node actions use 512 MiB against 64 MiB in the default runtime, so they cost more action compute. Node files cannot hold queries or mutations. It gains nothing over 4A, because the `worker` build already runs in the default runtime.

#### Option 4C: plain `fetch` plus Web Crypto, no package

- A 40-line verifier (HMAC-SHA256 through `crypto.subtle`, constant-time compare, 300-second tolerance) passed the same five cases as 4A in the scratch run.
- Cons: the project would own form encoding of nested v1 parameters, v2 JSON calls, error classes, retries, and response types, and would carry security-relevant verification code. Kept as the fallback if the package ever stops running in the default runtime.

#### Option 4D: the Convex Stripe component `@convex-dev/stripe` 0.1.6 (Apache-2.0)

- Cons: no Connect support: its source has no `Stripe-Account` use, no application fee, and no Connect endpoint. It also requires `react` as a peer and pins `stripe` ^22.

**Decision 4 (client): Option 4A.**

**Stripe CLI.** Used only for manual testing on a developer's cloud dev deployment (`stripe listen --forward-to … --forward-connect-to …`, `stripe trigger`). It is never used in `ci`.

| Option                                                                                                                                                 | Pros                                                                                                            | Cons                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **CLI-A: machine install, not a repo dependency (recommended).** Homebrew `brew install stripe`, or the GitHub release binary, version 1.53.0 or later | Nothing in `package.json`, the lockfile, or `ci`; no install script under ADR 0003; Dependabot is not involved. | Each developer installs it once; the version is documented, not enforced.                                                                                                      |
| CLI-B: `@stripe/cli` as a devDependency                                                                                                                | Version pinned in the lockfile.                                                                                 | A `postinstall` script (needs an `allowScripts` decision), five platform packages, weekly releases in Dependabot, and a binary installed on every `ci` run that never uses it. |
| CLI-C: no CLI                                                                                                                                          | Nothing to install.                                                                                             | Local webhook testing would need a registered endpoint per developer or a tunnelling tool (a new service).                                                                     |

**Decision 4 (CLI): CLI-A.** The CLI's own `stripe sandbox create`, which provisions an anonymous sandbox without the owner's account, is not used: the sandboxes are the owner's (AGENTS.md, Secrets).

### Decision 5: webhooks, failure states, and idempotency

#### Endpoints

Two HTTP routes in `convex/http.ts`, each registered as its own Stripe event destination (snapshot payload, API version `2026-09-30.endive`), each with its own signing secret:

| Route                          | Stripe scope       | Secret variable                 | Events                                                                                                                                                                                                                                                                     |
| ------------------------------ | ------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /stripe/webhook/connect` | Connected accounts | `STRIPE_CONNECT_WEBHOOK_SECRET` | `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, `account.updated`, `account.application.deauthorized` |
| `POST /stripe/webhook`         | Your account       | `STRIPE_WEBHOOK_SECRET`         | `application_fee.created`, `application_fee.refunded`, `invoice.finalized`, `invoice.paid`, `invoice.payment_failed`, `invoice.voided`, `invoice.marked_uncollectible`                                                                                                     |

Thin (v2) events are not used. Stripe's v2 onboarding guide suggests `v2.core.account[requirements].updated`, which needs a third, thin-event destination; v1 `account.updated` is still sent for v2 connected accounts in the Connected accounts scope, and the handler re-reads the account anyway. The sandbox test confirms `account.updated` arrives for a v2 account; if it does not, a thin destination is added under this ADR.

#### Pipeline (both routes)

1. If the route's secret is unset on this deployment: **404**, nothing read or logged (as ADR 0011's `/resend-webhook`).
2. Read the raw body as text and verify the `Stripe-Signature` header (4A, 5-minute tolerance). Invalid or missing signature: **400**, nothing recorded, no body logged.
3. If `event.livemode` does not match the deployment (true only when `STRIPE_SECRET_KEY` starts with `sk_live_`; false when it is a test key or unset): **200**, recorded as `ignored_livemode`.
4. One internal mutation, `stripe.events.apply`, in a single Convex transaction:
   - looks up `stripeEvents` by event id (index `by_eventId`); if present, returns `duplicate`: **200**, no change;
   - for Connect events, maps `event.account` to exactly one organization (index `by_stripeAccountId`); an unknown account is recorded as `ignored_unknown_account` with **200** and no change (sandboxes can hold accounts of other dev deployments, and a 4xx would only cause retries);
   - inserts the event row and applies the state change in the same transaction, so a concurrent duplicate either sees the row or loses the optimistic-concurrency race and then sees it;
   - schedules any Stripe API follow-up (for example re-reading an account) with `ctx.scheduler.runAfter(0, …)` rather than calling Stripe before the 2xx.
5. Unknown event types: **200**, recorded as `ignored_type`.
6. A thrown error rolls the whole transaction back, nothing is recorded, and the route returns **500**, so Stripe retries the delivery (3 days live, a few hours in a sandbox).

**One processed-event store for both endpoints.** `stripeEvents` holds `eventId` (unique), endpoint, type, account, `livemode`, outcome, and time. Both routes write to it, so an event delivered to both endpoints by a misconfiguration is applied once. Rows are kept 90 days (manual resend works up to 30 days) and deleted by a daily cron.

**Second line of defence: state transitions are monotonic.** Stripe can send two distinct events for one change, and order is not guaranteed. Every handler checks the current state first: `paid` is never moved back to `pending`, an `expired` event after `completed` is ignored, and a `completed` event for a payment that is already `paid` changes nothing.

#### Each event and the state it leaves

| Event                                                                                                           | Outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkout.session.completed`, `payment_status: paid`                                                            | After the tenancy checks (Decision 6), the payment becomes `paid`; its reserved entries become `carried` and its prepaid slots are recorded; the team is confirmed if rule 4 holds.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `checkout.session.completed`, `payment_status: unpaid` (delayed method)                                         | Payment stays `pending` with the reservation held; waits for the async event.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `checkout.session.async_payment_succeeded`                                                                      | As `completed` with `paid`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `checkout.session.async_payment_failed`                                                                         | Payment `failed`; reservation released; entries stay unpaid; the team stays unconfirmed. The payer can start a new payment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `checkout.session.expired`                                                                                      | Payment `expired` (unless already `paid`); reservation released; entries stay unpaid; the team stays unconfirmed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `charge.refunded`                                                                                               | Refunded amount recorded; payment `refunded` or `partially_refunded`. Roster entries are **not** changed automatically (an organizer removes players). Fee kept (assumption 6); if Open 6 is "returned", recalculated as in "Refunds and disputes under greater-of".                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `charge.dispute.created`                                                                                        | Payment `disputed`; org admins are told. Roster entries stay active during the dispute.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `charge.dispute.closed`                                                                                         | `won` or `warning_closed`: back to `paid`. `lost`: `dispute_lost`. The organization has absorbed the amount and the $15 fee (direct charge, `fees_collector: stripe`); the platform keeps the fee (assumption 6); entries stay rostered unless an organizer removes them.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `account.updated`                                                                                               | Schedules an action that retrieves the v2 account and stores status: `active` when `configuration.merchant.capabilities.card_payments` is `active` (v1 `charges_enabled: true`), otherwise `restricted` with "requirements due". On a change to `restricted`: new Checkouts for the organization are refused (registration that needs online payment closes), and its open Checkout Sessions are expired through the API. Paid entries stay paid. Teams that already paid for the minimum still confirm as invites are accepted, because prepaid slots need no payment. Entries that need a new payment wait. Free seasons and offline marking continue (billing does not depend on `card_payments`). |
| `account.application.deauthorized`                                                                              | Organization status `disconnected`: everything under `restricted`, plus offline marking and billed additions are blocked, because the account may no longer be invoiced. Pending invoice items are invoiced at once (best effort). An org admin can onboard again, which creates a new account; past payments keep their old account id.                                                                                                                                                                                                                                                                                                                                                              |
| `application_fee.created`                                                                                       | The fee id is stored on the payment, for reconciliation and any future fee refund.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `application_fee.refunded`                                                                                      | Refunded fee amount recorded. Under assumption 6 the platform never refunds fees itself, so this only follows an owner action in the Dashboard; it is flagged for owner review. (If Open 6 is answered "returned", the fee is recalculated and any floor still owed is billed as a refund top-up.)                                                                                                                                                                                                                                                                                                                                                                                                    |
| `invoice.finalized`, `invoice.paid`, `invoice.payment_failed`, `invoice.voided`, `invoice.marked_uncollectible` | Update `platformBills` and the organization's billing state as in Decision 3's table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

**Duplicate delivery:** the second delivery of an event id returns 200 and changes nothing. **Invalid signature:** 400, nothing recorded. Both are tested on both routes (Consequences).

#### Outgoing calls: idempotency keys

Every mutating Stripe call sends an idempotency key built from the system's own record id, never a random value, so a retried action cannot create a second object:

| Call                                       | Key                                                             | Note                                                                                                                                             |
| ------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Create v2 account                          | `account-create:<organizationId>`                               | v2 keys last 30 days. The account id is stored from the response; before creating, the action checks whether the organization already has one.   |
| Create Account Link                        | `account-link:<onboardingAttemptId>`                            | A new attempt id per click, because a link is single-use and expires in minutes.                                                                 |
| Create Checkout Session (`Stripe-Account`) | `checkout:<paymentId>`                                          | One session per payment record. A retry after the 24-hour v1 window is impossible: the session has expired by then and the payment is `expired`. |
| Expire Checkout Session (`Stripe-Account`) | `checkout-expire:<paymentId>`                                   |                                                                                                                                                  |
| Refund (`Stripe-Account`)                  | `refund:<refundRequestId>`                                      | If refunds are offered in the app; organizations can also refund from their Dashboard.                                                           |
| Create invoice item                        | `invoice-item:<billedFeeId>`                                    |                                                                                                                                                  |
| Create and finalize monthly invoice        | `invoice:<platformBillId>`, `invoice-finalize:<platformBillId>` |                                                                                                                                                  |

Stripe ids returned by a call are written back by an internal mutation, so a later retry finds them and does not call Stripe again.

### Decision 6: tenancy and authorization

| Function                                                | Kind            | Who may call it, and the check                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stripeConnect.startOnboarding({ organizationId })`     | public action   | Signed-in **org admin of that organization** only (shared helper in `convex/lib/`); league organizers and others get `FORBIDDEN`. Creates the account if none exists, then an Account Link; returns only the link URL.                                                                                                |
| `stripeConnect.status({ organizationId })`              | public query    | Org admins of that organization only. Returns status, billing state, and whether requirements are due. Never returns keys, secrets, or other organizations' data.                                                                                                                                                     |
| `payments.start({ teamId or rosterEntryId, kind })`     | public action   | The captain (team payment), the player or guardian (player payment), per the payment slice. **No amount, fee, currency, price, or account id is accepted from the client.** It reads the season's prices and fee and the organization's account id on the server, reserves entries, and creates the Checkout Session. |
| `payments.markOffline({ teamId or rosterEntryId })`     | public mutation | Org admins, or the league organizer assigned to that league. Bills the greater-of on the season's listed price, computed on the server; refused while the organization is `past_due` or `disconnected`.                                                                                                               |
| `stripe.events.apply`, billing crons, Stripe follow-ups | internal        | Only the webhook routes and the scheduler.                                                                                                                                                                                                                                                                            |

Rules:

- **The connected account id comes only from Stripe's API response**, written by an internal mutation. No public function takes an account id as an argument.
- **Each Connect event's `event.account` maps to exactly one organization** through a unique index. Events for unknown accounts change nothing.
- **A payment event cannot cross tenants.** Before applying `checkout.session.*`, the handler loads the payment by `metadata.paymentId` and requires all of: the payment's organization has `stripeAccountId === event.account`; `amount_total` and `currency` equal the stored payment; the session id equals the stored session id (once set). Any mismatch is recorded as `rejected_mismatch` with no state change. So a session on organization A's account can never mark organization B's roster entry as paid, even if metadata were wrong.
- **Billing events** must reference a `platformBills` row the system created (`invoice.id` stored at creation).
- **Tests** for every public function above: happy path, unauthenticated caller, caller from another organization, and a league organizer of another league (Convex conventions).

### Decision 7: testing, CI, and keys per deployment

#### E2E in `ci` with no secrets and no Stripe call

| Option                                                                                 | Verdict                                                                                                                             |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **7A: fake gateway under `IS_TEST`, plus locally signed webhook events (recommended)** | No secret, no network, real verification and real handlers.                                                                         |
| 7B: `stripe-mock` (Stripe's OpenAPI-driven mock server, MIT, v0.206.0)                 | A new tool and binary in `ci`; stateless, so it never sends webhooks and cannot drive the payment flow. Rejected.                   |
| 7C: a Stripe sandbox key in `ci`                                                       | A repository secret (fork PRs lose it), network calls from `ci`, and shared mutable state. Forbidden by ADR 0009 and #57. Rejected. |

How 7A works:

- **One seam.** Every Stripe call goes through `convex/stripe/gateway.ts`. When `process.env["IS_TEST"] === "true"`, the factory returns `FakeStripeGateway`, which records each call (operation, account, idempotency key, amount, fee) in a `testStripeCalls` table and returns deterministic fake ids. For a Checkout it returns the payment's own `success_url` with `session_id=cs_fake_<paymentId>`, so the browser goes straight to the "payment processing" page and no test-only screen is needed. Otherwise the real gateway is used, and it throws `stripe_not_configured` if `STRIPE_SECRET_KEY` is unset, before any network call. `IS_TEST` can never reach a cloud deployment: #15's deploy check already fails on it.
- **Webhooks.** Playwright `globalSetup` generates two random per-run secrets (never stored) and sets `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET` with `npx convex env set`, as ADR 0008 does for `BETTER_AUTH_SECRET`. An e2e helper builds the event JSON, signs it with `stripe.webhooks.generateTestHeaderString` (or `node:crypto` HMAC), and posts it to `http://127.0.0.1:3211/stripe/webhook/connect`. The page then updates live through the Convex subscription.
- **What e2e covers:** a team payment through to a confirmed team; a failed payment (`async_payment_failed`) and an expired one; a duplicate delivery changing nothing; an invalid signature returning 400.
- **`testing:readStripeCalls`** (internal, `IS_TEST`-guarded) lets specs assert the amount, fee, account, and idempotency key that would have been sent. `testing:reset` clears `testStripeCalls` and `stripeEvents`.
- **Convex tests (`convex-test`, ADR 0004):** the same signed fixtures through `t.fetch` on both routes (the edge-runtime environment has `crypto.subtle`); each event row of the outcome table; duplicate, invalid signature, unknown account, livemode mismatch, cross-tenant mismatch; every fee case above; the real gateway throwing without a key.
- **Fee helper unit tests:** the percentage part larger, the floor part larger, and equal; rounding at exactly half a cent (rounds up) and just below; `count` 0 (percentage only); the cap at `amount − 50` with the shortfall; a carried fee of 0 (parameter omitted); invalid `bps` and negative inputs; refund recompute under both answers to Open 6.

#### Keys and webhook endpoints per deployment

Each preview and staging gets a new `*.convex.site` URL on every push or merge, and Stripe allows only 16 event destinations per account, so per-preview endpoints are impossible. Previews and staging also share one set of Convex default preview variables, so a key given to staging would be readable by every PR's code.

| Deployment                                                                   | Stripe keys                                                                                                                                                                            | Webhook endpoints                                                                                                                                                                                                                                                                                                | Payments                                                                                                         |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Local e2e and `ci`** (anonymous local backend)                             | None                                                                                                                                                                                   | Per-run random secrets; events signed by the test                                                                                                                                                                                                                                                                | Fake gateway (`IS_TEST`)                                                                                         |
| **Developer cloud dev deployment** (stable `https://<dev-name>.convex.site`) | Optional. The owner sets the **development sandbox's** test secret key with `npx convex env set STRIPE_SECRET_KEY …` on a dev deployment the owner names.                              | Either `stripe listen --forward-to https://<dev-name>.convex.site/stripe/webhook --forward-connect-to https://<dev-name>.convex.site/stripe/webhook/connect` (one CLI secret, stable across restarts, set as both secrets), or two event destinations registered in the development sandbox for that stable URL. | Real Stripe, sandbox only. Without a key, payment screens show "Payments are not configured on this deployment". |
| **Per-PR preview `pr-<n>`**                                                  | **None.** The deploy check fails if `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, or `STRIPE_CONNECT_WEBHOOK_SECRET` is set.                                                           | None (both routes return 404)                                                                                                                                                                                                                                                                                    | Disabled, with the notice above                                                                                  |
| **Staging `main`**                                                           | **None** (same default preview variables and check)                                                                                                                                    | None                                                                                                                                                                                                                                                                                                             | Disabled                                                                                                         |
| **Production**                                                               | Live key, set by the owner at the first release that ships payments (`gate:production`). The deploy check fails if any of the three variables is missing or the key is not `sk_live_`. | Two live event destinations (platform and Connect) to `https://<prod>.convex.site/…`, created by the owner                                                                                                                                                                                                       | Live                                                                                                             |

- **Sandboxes, not the test mode sandbox:** general sandboxes support the v2 API fully and keep settings separate from live mode. The owner creates a **development** sandbox now; a **release rehearsal** sandbox (or the same one) is used for an owner check on a dev deployment before the first production release with payments.
- **Hosted payments are therefore never exercised on previews or staging.** Previews show only the "not configured" notice. Payment flows are covered by e2e (fake gateway) and run against Stripe on the named dev deployment. This is the main cost of the decision.
- **Rejected:** a build step that rewrites one sandbox endpoint's URL to staging's new `*.convex.site` URL on every merge. It needs a Stripe key in Netlify's build environment and in the shared preview variables, so every PR's code could use it, and still gives PR previews no webhooks.

### Decision 8: conventions

`docs/conventions/stripe.md` is updated in this PR with the Connect rules: account configuration, direct charges with the greater-of fee from one helper, no amounts or account ids from the client, the two endpoints and shared event store, the tenancy checks, the idempotency key format, the `IS_TEST` gateway, and the per-deployment key rules. Glossary entries are added for **per-player floor**, **platform bill**, **prepaid slot**, and **Stripe sandbox**, and **application fee** is updated.

## Recommendation

| Item                        | Decision                                                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Account type             | Accounts v2, `dashboard: full`, Stripe collects fees and carries losses; `merchant` + `customer` configurations; Stripe-hosted onboarding.                                              |
| 2. Charge type              | Direct charges through hosted Checkout with `application_fee_amount`; greater of a percentage and a per-player floor, per session, from one server helper; fee absorbed (assumption 5). |
| 3. Billing the organization | One-off monthly Stripe invoices of pending invoice items to the customer-configured account; billed counts as paid; `past_due` restrictions.                                            |
| 4. Client and CLI           | `stripe` 23.0.x in the default runtime (no `"use node"`); Stripe CLI installed per machine, never in `ci`.                                                                              |
| 5. Webhooks                 | Two snapshot endpoints, one `stripeEvents` store, one transactional mutation per event, monotonic states, record-id idempotency keys.                                                   |
| 6. Tenancy                  | Org-admin-only onboarding and status; account id only from Stripe; `event.account` → one organization; amount, account, and session cross-checked.                                      |
| 7. Testing and keys         | Fake gateway under `IS_TEST` plus locally signed events in `ci`; sandbox keys only on owner-named dev deployments; none on previews or staging.                                         |
| 8. Conventions              | `docs/conventions/stripe.md` updated in this PR.                                                                                                                                        |

Together these cost the platform nothing until a fee is collected, keep every loss and refund with the organization that took the payment, and keep secrets out of `ci`, previews, and staging.

## Cost

| Item                                       | Cost                                                                                                                                                                                                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connect platform fees (1A + 2A)            | **$0.** No monthly active account fee, no payout fee.                                                                                                                                                                                                      |
| Player payments                            | Paid by the organization: 2.9% + 30¢ per US card charge, plus the application fee.                                                                                                                                                                         |
| Platform bills (3A)                        | Paid by the platform out of the fees collected: 0.4% per paid invoice, plus 2.9% + 30¢ by card or 0.8% (cap $5) by ACH. About 4.1% by card or 1.2% by ACH on a $40 bill.                                                                                   |
| Disputes on player payments                | Organization: $15 per dispute, returned if won.                                                                                                                                                                                                            |
| Convex usage                               | About 8 function calls per online payment (start, Checkout, two webhook routes and mutations) and about 5 per monthly bill. At 1,000 payments and 50 organizations a month, about 10,000 calls: 1% of the 1M included in ADR 0010's plan. No Node actions. |
| Against the about $25/month hosting budget | **No fixed cost.** Stripe charges are per transaction, paid from payment and fee revenue, not from the hosting budget. Option 1C would have added $2 per active organization per month, which is why it is rejected.                                       |
| Sandboxes, Stripe CLI                      | $0.                                                                                                                                                                                                                                                        |

## Consequences

- **New service:** Stripe Connect on the platform's Stripe account (Accounts v2, Invoicing). No monthly fee.
- **New dependency:** `stripe` ~23.0 (MIT), runtime dependency. No dependencies of its own, no install script, so ADR 0003's `allowScripts` map is unchanged; 23.0.0 is past the 3-day release age. A major bump (24) is a new decision, because it changes the pinned API version; the webhook endpoints' API version moves with it.
- **New tool (outside the repo):** Stripe CLI 1.53.0 or later, installed per machine. Not in `package.json` or `ci`.
- **Environment variables:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `APPLICATION_FEE_PERCENT_BPS`, `APPLICATION_FEE_FLOOR_CENTS`. Set only on owner-named dev deployments (sandbox values) and production (live values). Never in the repo, GitHub, Netlify, or the Convex default preview variables.
- **Deploy check (`scripts/check-deploy-env.mjs`, extended by the first payment slice):** previews fail if any `STRIPE_*` variable is set; production fails if any of the three is missing or the key's prefix is not `sk_live_`. Names only; the key's prefix is compared in memory and never printed, as for `AUTH_EMAIL_DISABLED`.
- **Owner setup (once, no values in any issue or PR):**
  1. Create a **development** general sandbox; enable Connect in it; set the platform profile (SaaS, direct charges); set branding.
  2. Give the agent's or tester's named cloud dev deployment the sandbox's test secret key with `npx convex env set`.
  3. Either register the two event destinations above for that dev deployment's stable URL, or have the tester use `stripe listen`.
  4. At the first production release with payments: live Connect setup, the live key, and the two live endpoints, through `gate:production`.
- **Sandbox scratch test before the first payment slice merges** (#57's test plan; needs step 1 and 2): create a v2 account as in 1A; onboard it with test data; one Checkout direct charge with an application fee; both webhooks received and verified on the dev deployment; confirm `account.updated` arrives for the v2 account; create, finalize, and pay a $1 invoice to the account's `customer_account`; disconnect the test account and record whether it can still be invoiced. The result is appended to Test evidence below in a follow-up PR; if any check fails, this ADR is amended before payment code merges.
- **Slices that follow (each `Blocked by: #57`; UI through `gate:ui-design`):**
  1. Organization onboarding and status (Decisions 1 and 6), the two webhook routes, `stripeEvents`, the gateway seam and fake, and the deploy check.
  2. The fee helper, season pricing with the pricing guard, team payment through Checkout, prepaid slots, and team confirmation.
  3. Player payments, split pricing, and late additions.
  4. Free seasons, offline payments, and platform bills with the `past_due` restrictions.
  5. Refund and dispute handling and their organizer and player views.
- **`docs/product/requirements.md`** and **`docs/glossary.md`** are updated in this PR with the owner's greater-of decision, rule 6 (rosters visible to opponents), the residual gap, and the open questions renumbered 3 to 6. The owner's answers to Open 3 to 6 and the confirmations above are recorded there when given.
- **What becomes harder:**
  - Hosted Stripe payments cannot be smoke-tested on previews or staging; only on a named dev deployment and, after release, production.
  - Collecting from free-only or offline-only organizations depends on them paying an invoice.
  - Each `stripe` major is a new decision, with an API version move on both endpoints.
- **What would change this decision:**
  - Pay with Stripe balance becoming generally available for one-off charges: re-compare 3D for automatic collection.
  - Organizations needing a white-labelled experience: Option 1C, with its Connect fees and loss liability.
  - Organizations outside the US: currency and country handling, and account debit availability, change.
  - `account.updated` not arriving for v2 accounts in the sandbox test: add a thin-event destination for `v2.core.account[configuration.merchant].capability_status_updated`.

## Test evidence

### Offline scratch run (2026-10-09), outside the repository

macOS arm64, Node 24.16.0, npm 11, `convex` 1.46.0, `stripe` 23.0.0 (`npm install --ignore-scripts`; the lockfile marks `hasInstallScript` only on `esbuild`), anonymous local backend `precompiled-2026-10-06-a3538c6` on ports 3290/3291. No Stripe key and no Stripe network call: the webhook secret was a throwaway local value, and API calls went to a local stand-in server. The scratch code is not committed.

<details><summary>Evidence</summary>

Three HTTP routes received the same signed `checkout.session.completed` event (`account: acct_scratch`), signed with `stripe.webhooks.generateTestHeaderString`:

| Case                     | `/stripe/sdk` (4A, default runtime) | `/stripe/raw` (4C, Web Crypto) | `/stripe/node` (4B, HTTP action → `"use node"` action) |
| ------------------------ | ----------------------------------- | ------------------------------ | ------------------------------------------------------ |
| Valid                    | 200, `account` read                 | 200                            | 200                                                    |
| Wrong secret             | 400                                 | 400                            | 400                                                    |
| Tampered body            | 400                                 | 400                            | 400                                                    |
| Timestamp 10 minutes old | 400                                 | 400                            | 400                                                    |
| No header                | 400                                 | 400                            | 400                                                    |
| Warm round trips (ms)    | 6, 4, 4, 5, 5                       | 2, 2, 3, 3, 3                  | 5, 4, 4, 4, 4 (first call 19)                          |

Local timings do not include Convex cloud's Node cold start, which 4B would add.

An HTTP action in the default runtime called `stripe.checkout.sessions.create(…, { stripeAccount: 'acct_scratch', idempotencyKey: 'checkout:payment_abc123' })` with the fetch client pointed at a local stand-in. The stand-in received `POST /v1/checkout/sessions` with headers `Stripe-Account: acct_scratch`, `Idempotency-Key: checkout:payment_abc123`, `Stripe-Version: 2026-09-30.endive`, and the body `mode=payment&line_items[0][quantity]=1&line_items[0][price_data][currency]=usd&line_items[0][price_data][unit_amount]=5000&…&payment_intent_data[application_fee_amount]=600&success_url=…`.

Bundle size of `import Stripe from 'stripe'` (esbuild, `platform=browser`, which resolves the `worker` build): 698,527 bytes; minified 227,116; gzipped 30,591.

Processes: the local backend (started PID and its listening child on 3290/3291) was stopped and both ports confirmed free.

</details>

### Sandbox scratch test

**Pending the owner prerequisite** (Consequences, owner setup steps 1 and 2). Not run: the system holds no Stripe key.

## Sources

Checked 2026-10-09.

- Stripe: [Connected account types (deprecated)](https://docs.stripe.com/connect/accounts), [Accounts v2](https://docs.stripe.com/connect/accounts-v2), [Configure connected accounts](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration), [SaaS platform payments and billing with Accounts v2](https://docs.stripe.com/connect/accounts-v2/saas-platform-payments-billing), [Accounts as customers](https://docs.stripe.com/accounts-v2/use-accounts-as-customers), [Integration recommendations](https://docs.stripe.com/connect/integration-recommendations), [Build a SaaS platform](https://docs.stripe.com/connect/saas), [Onboard connected accounts](https://docs.stripe.com/connect/saas/tasks/onboard)
- Stripe: [Direct charges (hosted Checkout)](https://docs.stripe.com/connect/direct-charges?platform=web&ui=stripe-hosted), [Debit connected accounts](https://docs.stripe.com/connect/account-debits), [Connect subscriptions and billing connected accounts](https://docs.stripe.com/connect/subscriptions), [Pay with Stripe balance](https://docs.stripe.com/payments/pay-with-balance), [Connect disputes](https://docs.stripe.com/connect/disputes)
- Stripe: [Webhooks](https://docs.stripe.com/webhooks), [Connect webhooks](https://docs.stripe.com/connect/webhooks), [Event types](https://docs.stripe.com/api/events/types), [Idempotent requests](https://docs.stripe.com/api/idempotent_requests), [API v2 overview](https://docs.stripe.com/api-v2-overview), [Create a Checkout Session](https://docs.stripe.com/api/checkout/sessions/create), [Currencies and minimum amounts](https://docs.stripe.com/currencies)
- Stripe: [Sandboxes](https://docs.stripe.com/sandboxes), [Testing use cases](https://docs.stripe.com/testing-use-cases), [`stripe listen`](https://docs.stripe.com/cli/listen), [Stripe CLI repository and install methods](https://github.com/stripe/stripe-cli), [stripe-mock](https://github.com/stripe/stripe-mock)
- Stripe pricing: [Payments](https://stripe.com/pricing), [Connect](https://stripe.com/connect/pricing), [Billing](https://stripe.com/billing/pricing), [Invoicing](https://stripe.com/invoicing/pricing)
- npm registry: `stripe` 23.0.0 (2026-10-01, MIT, `CHANGELOG.md` "pinned API version `2026-09-30.endive`"), `@stripe/cli` 1.53.0 and 1.53.1, `@convex-dev/stripe` 0.1.6
- Convex: [Runtimes](https://docs.convex.dev/functions/runtimes), [Limits](https://docs.convex.dev/production/state/limits), [Convex Stripe component](https://www.convex.dev/components/stripe)
