# ADR-0010: Manual invoicing before a billing system, billing system before Stripe

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** Luma Training (product owner), engineering
- **Spec reference:** §7.2, §7.3, §9.6, §28, §48, §49 (ADR 10), §50 (phases 6 and 7)

## Context

The tender alert service itself is free (§2). Money enters only through two Luma Training products the service promotes: Påfyll at 395 NOK per month excluding VAT, and the full-day course at 14 500 NOK excluding VAT. Both are sold to Norwegian businesses, and both are already sold today through Luma's existing invoicing process, outside any software this project would build.

Version 1 of the specification carried a full order and subscription engine in phase 6. Version 2 moved it to phase 7 (§0, item 10) and replaced it with a structured order form handled manually (§28.2). §28.1 states the principle directly: invoice is the first and only payment method, Stripe must not be a dependency, and payment infrastructure gets built when order volume proves the need. §7.3 puts card payment and Stripe dependency explicitly out of MVP scope.

The B2B reality supports this. Norwegian public-sector-adjacent buyers pay against an invoice with an organization number, a billing address, a contact person, a customer reference and often a purchase order number. Nobody in this segment is entering a card number. Building Stripe Checkout would produce a payment flow the buyers would not use.

## Decision

A three-stage ladder, with each stage gated on evidence rather than on a date.

**Stage 1 (MVP): manual invoice handling.** No order engine, no subscription engine, no invoice records. An order is a structured enquiry:

`OrderRequest` per §28.2, with status `received` | `in_progress` | `activated` | `declined` | `cancelled`, stored in `order_requests`. The flow: user submits, status `received`, confirmation email on the transactional stream, admin notified at `BILLING_ADMIN_EMAIL`, invoice raised in Luma's existing process outside this system, admin updates status and activates access, user receives an activation email, and every status change is written to `admin_audit_events`.

**Stage 2 (phase 7): a real billing system.** Orders, subscriptions, `invoice_records` and `billing_audit_events`, with admin flows for invoice numbers, due dates and pausing. The v1 models are kept as a reference document in `docs/phase-7-billing-reference.md` per §28.3, so phase 7 starts from a design rather than from a blank page.

**Stage 3 (unprioritized): Stripe or card payment,** only if a customer segment appears that will not pay by invoice.

**The `BillingProvider` seam exists from day one** (§28.3):

```typescript
interface BillingProvider {
  createOrder(input: CreateOrderInput): Promise<OrderRequest>;
  activateOrder(orderId: string): Promise<void>;
  cancelOrder(orderId: string): Promise<void>;
}
```

`ManualInvoiceBillingProvider` is the MVP implementation, selected by `BILLING_PROVIDER=manual` (§48). No Stripe environment variables, no Stripe SDK, no Stripe types exist in the repository.

The checkout UI follows §28.2: Norwegian invoice language ("Betaling med faktura", "Pris ekskl. mva", "Vi sender faktura til oppgitt fakturaadresse", "Tilgangen aktiveres etter behandling"), and no card icons, no Stripe Checkout, no Apple Pay, no Google Pay, no "Betal nå".

## Consequences

### Positive

- Phase 6 ships without a payment integration, its PCI-adjacent considerations, its webhook reconciliation, its refund flows or its test-mode/live-mode configuration. That is weeks removed from the critical path to launch.
- The manual flow matches how Luma actually invoices today, so there is no process change to roll out alongside the software.
- Order volume becomes the trigger for phase 7 rather than a guess. If manual handling stays comfortable, phase 7 is deferred again, correctly.
- The `BillingProvider` interface means the call sites (order form, admin activation, confirmation emails) are written once. Phase 7 replaces one implementation.
- Every order is auditable from the start (§53 requires the order flow to be auditable), so the phase 7 migration has clean history to work from.

### Negative / trade-offs

- Manual handling does not scale, and it will fail visibly at some volume. Deliberate: that failure is the signal to build stage 2. The admin dashboard shows the order backlog (§45) so the signal arrives as data rather than as a complaint.
- Activation latency is human latency. A user who orders Påfyll on a Friday evening may wait until Monday. The confirmation email must set that expectation honestly in Norwegian.
- `BillingProvider` was designed against a manual flow, so it may not perfectly fit a subscription engine with proration and dunning. Accepted: the interface is small and its three call sites are cheap to revise.
- Recurring Påfyll billing is entirely outside the system in stage 1. There is no renewal reminder and no lapse detection. Admin owns this in Luma's existing process.

## Alternatives considered

- **Stripe Checkout in the MVP.** Rejected by §7.3 and §28.1, and rejected on product grounds: the buyers pay by invoice.
- **Full order and subscription engine in phase 6, as v1 specified.** Rejected by the v2 rescope. It is significant work whose demand is unproven, and it would delay launch of the thing that generates the demand signal.
- **No abstraction at all, direct `order_requests` writes from the UI.** Rejected: phase 7 would then have to find and rewrite every call site, and §49 requires that ordering be isolated.
- **A third-party invoicing SaaS integration in the MVP.** Rejected: it is stage 2 work wearing a shortcut's clothes, and it would couple launch to a vendor selection that has not happened.

## Verification

- A dependency test asserts no package in the workspace depends on `stripe` or `@stripe/*`, and a source scan finds no occurrence of `stripe` outside this ADR and the phase 7 reference document.
- An environment test asserts the schema defines no Stripe variables and that `BILLING_PROVIDER` accepts only `manual` at present, failing loudly on any other value rather than falling back silently.
- A test asserts all order creation, activation and cancellation flows go through `BillingProvider`; no module outside `packages/billing` writes to `order_requests`.
- A state-machine test asserts the only permitted transitions are `received -> in_progress -> activated | declined` and `received | in_progress -> cancelled`, and that any other transition is rejected.
- An audit test asserts every status transition writes an `admin_audit_events` row containing the admin id, the previous status and the new status; a transition performed with no audit row fails.
- An email test asserts submitting an order sends `order-request-received-v1` on the transactional stream and notifies `BILLING_ADMIN_EMAIL`, and that activation sends `paid-access-activated-v1`.
- A UI test asserts the order page contains no card-brand imagery and none of the forbidden strings from §28.2, and that it contains the required Norwegian invoice phrasing.
- A test asserts `docs/phase-7-billing-reference.md` exists, since §28.3 makes keeping the v1 models as reference a requirement rather than a courtesy.
