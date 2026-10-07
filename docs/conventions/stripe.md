# Stripe conventions

Applies to any code that creates charges, subscriptions, refunds, or handles Stripe events.

## Keys and modes

- Agents use test-mode keys only (`sk_test_…`, `pk_test_…`), stored as Convex environment variables, never in the repo.
- Live-mode keys, live webhook endpoints, and live product/price configuration belong to the owner and change only through `gate:production`.

## Flows

- Prices and amounts come from the server (Convex), never from the client.
- Prefer Stripe-hosted surfaces (Checkout, Customer Portal) over collecting card details in the app; card data never touches our code.
- Every mutating Stripe API call sends an idempotency key derived from our own record id.

## Webhooks

- Received by a Convex HTTP action, with the signature verified against the webhook secret before anything else.
- Handlers are idempotent: the same event id processed twice leaves the same result. Store processed event ids.
- Our database is updated from webhook events, not from the client's redirect after checkout; the redirect only shows status.
- Handle at least: successful payment, failed payment, refund, and dispute for any flow that takes money.

## Tests

Payment PRs include tests for success, failure, duplicate webhook delivery, and an invalid signature. Manual verification uses the Stripe CLI and test cards in test mode.
