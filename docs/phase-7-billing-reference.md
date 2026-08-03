# Phase 7 billing reference

**Status:** Reference material, not implemented. Nothing described here exists in the codebase.

Spec §28.3 requires that the v1 order and subscription models be kept in `/docs` as a reference for phase 7. This is that document. It records the design so phase 7 starts from a considered model rather than from a blank page, and so the MVP's `BillingProvider` seam can be checked against what it will eventually have to support.

The decision to defer all of this is ADR-0010: manual invoicing before a billing system, billing system before Stripe.

## 1. Why none of this is in the MVP

The tender service is free. Money enters only through two Luma Training products the service promotes: Påfyll at 395 NOK per month excluding VAT, and the full-day course at 14 500 NOK excluding VAT. Both are sold to Norwegian businesses that pay against an invoice with an organization number, a billing address, a contact person, a customer reference and often a purchase order number.

Spec §28.1 states the principle: invoice is the first and only payment method, Stripe must not be a dependency, and payment infrastructure is built when order volume proves the need. Version 2 of the specification moved the billing engine from phase 6 to phase 7 (§0 item 10) for exactly this reason.

**The trigger for building phase 7 is order volume, not a date.** The signal is the order backlog in the admin dashboard (§45): when manual handling stops being comfortable, build this.

## 2. What the MVP has instead

`OrderRequest` (spec §28.2), stored in `order_requests`, is a structured enquiry rather than an order:

```typescript
type OrderRequest = {
  id: string;
  userId: string;
  productCode: string;          // e.g. "paafyll", "heldagskurs"
  productName: string;
  billingCompanyName: string;
  organizationNumber?: string;
  billingAddress: string;
  billingPostalCode: string;
  billingCity: string;
  billingCountry: string;
  invoiceEmail: string;
  contactPerson: string;
  customerReference?: string;
  purchaseOrderNumber?: string;
  status: "received" | "in_progress" | "activated" | "declined" | "cancelled";
  adminNote?: string;
  handledByAdminId?: string;
  createdAt: Date;
  updatedAt: Date;
};
```

The invoice itself is raised in Luma's existing process, entirely outside this system. Every status change is written to `admin_audit_events`.

## 3. The `BillingProvider` seam

This interface exists in the MVP (spec §28.3). It is the reason phase 7 replaces an implementation rather than rewriting call sites.

```typescript
interface BillingProvider {
  createOrder(input: CreateOrderInput): Promise<OrderRequest>;
  activateOrder(orderId: string): Promise<void>;
  cancelOrder(orderId: string): Promise<void>;
}
```

Implementations:

| Implementation | Status | Notes |
| --- | --- | --- |
| `ManualInvoiceBillingProvider` | **MVP, shipped** | Selected by `BILLING_PROVIDER=manual`. Stores the request, emails the user, notifies `BILLING_ADMIN_EMAIL`, and exposes admin transitions |
| `InvoiceBillingProvider` | Phase 7 | Full order and subscription engine described below |
| `StripeBillingProvider` | **Explicitly deprioritized** | Not a dependency. No Stripe package, no Stripe environment variable, no Stripe type exists in the repository (spec §7.3, §28.1, §48) |

Phase 7 will likely need to widen this interface, for example with subscription lifecycle operations. That is expected and cheap: the interface is small and its call sites are few. Widening it is not a reason to build it now.

## 4. Phase 7 model sketch

The following is the v1 model, preserved as reference. Field names and types are indicative; phase 7 should revisit them against whatever the manual flow has actually taught us by then.

### 4.1 Order

An order is a concrete commercial commitment, unlike an `OrderRequest`, which is an enquiry.

```typescript
type Order = {
  id: string;
  userId: string;
  companyId?: string;

  productCode: string;
  productName: string;
  quantity: number;
  unitPriceNok: number;         // excluding VAT
  vatPercent: number;           // DEFAULT_VAT_PERCENT
  totalExVatNok: number;
  totalIncVatNok: number;

  // Billing details, carried from the order request
  billingCompanyName: string;
  organizationNumber?: string;
  billingAddress: string;
  billingPostalCode: string;
  billingCity: string;
  billingCountry: string;
  invoiceEmail: string;
  contactPerson: string;
  customerReference?: string;
  purchaseOrderNumber?: string;

  status:
    | "pending_invoice"
    | "invoiced"
    | "active"
    | "payment_overdue"
    | "cancelled"
    | "completed";

  originOrderRequestId?: string;  // link back to the MVP enquiry
  subscriptionId?: string;

  createdAt: Date;
  updatedAt: Date;
};
```

Status meanings:

| Status | Meaning |
| --- | --- |
| `pending_invoice` | Order accepted, invoice not yet issued |
| `invoiced` | Invoice issued and sent, payment outstanding |
| `active` | Paid, or access granted pending payment on agreed terms |
| `payment_overdue` | Past due date, unpaid. Access policy is a business decision, not a technical default |
| `cancelled` | Cancelled before completion, by either party |
| `completed` | Fulfilled and closed. A course seat completes after the course; a subscription completes when it ends |

### 4.2 Subscription

Påfyll is recurring; a course seat is not. Only recurring products create a subscription.

```typescript
type Subscription = {
  id: string;
  userId: string;
  companyId?: string;
  productCode: string;

  billingInterval: "monthly" | "quarterly" | "yearly";
  currentPeriodStart: Date;
  currentPeriodEnd: Date;

  status: "active" | "paused" | "cancelled" | "expired";

  pausedAt?: Date;
  pauseReason?: string;
  cancelledAt?: Date;
  cancelAtPeriodEnd: boolean;

  priceExVatNok: number;
  vatPercent: number;

  createdAt: Date;
  updatedAt: Date;
};
```

Each billing period generates an `Order` for that period, which in turn generates an `invoice_record`. Keeping orders per period rather than mutating one long-lived order means the billing history is readable as a sequence rather than reconstructed from an audit log.

### 4.3 `invoice_records`

A record of an invoice that exists in Luma's accounting process. This table does **not** produce invoices; it tracks them.

```typescript
type InvoiceRecord = {
  id: string;
  orderId: string;

  invoiceNumber: string;        // from Luma's accounting system
  issuedAt: Date;
  dueAt: Date;
  amountExVatNok: number;
  vatAmountNok: number;
  amountIncVatNok: number;

  status: "issued" | "paid" | "overdue" | "credited" | "cancelled";
  paidAt?: Date;
  creditedAt?: Date;
  creditNoteNumber?: string;

  registeredByAdminId: string;
  note?: string;

  createdAt: Date;
  updatedAt: Date;
};
```

Whether phase 7 integrates directly with an accounting system or continues to have an admin key in the invoice number is an open question for phase 7. The criterion is the same as the one that deferred this whole document: integrate when the manual step becomes the bottleneck, not before.

### 4.4 `billing_audit_events`

Append-only, following the same reasoning as `consent_events` (ADR-0009). Money and access are the two things where "what happened and who did it" must be answerable later.

```typescript
type BillingAuditEvent = {
  id: string;
  entityType: "order" | "subscription" | "invoice_record" | "order_request";
  entityId: string;

  eventType: string;            // e.g. "status_changed", "invoice_registered",
                                // "access_activated", "subscription_paused"
  previousValue?: JsonValue;
  newValue?: JsonValue;

  actorType: "admin" | "system" | "user";
  actorId?: string;
  note?: string;

  occurredAt: Date;
  createdAt: Date;
};
```

Rows are never updated or deleted.

### 4.5 Admin flows

Phase 7 admin needs, beyond what the MVP order handling already provides:

- Register an invoice number and due date against an order.
- Mark an invoice paid, overdue or credited.
- Pause and resume a subscription, with a reason.
- Cancel at period end, distinct from cancelling immediately.
- View the billing history for a user or company as a single timeline.
- Report on outstanding, overdue and recognized amounts.
- Reconcile access state against payment state, and surface any disagreement between the two.

### 4.6 Email templates

Spec §25 reserves two templates for phase 7:

- `invoice-order-confirmation-v1`
- `invoice-issued-v1`

Both go on the transactional Postmark stream (ADR-0005), because an invoice is account-critical and must not be suppressible by a marketing complaint.

### 4.7 Database tables

Spec §37 lists the phase 7 additions: `orders`, `subscriptions`, `invoice_records`, `billing_audit_events`.

## 5. Constraints that carry forward

Whatever phase 7 builds must still honour these:

1. **Invoice remains the primary method.** Card payment is a separate, later, unprioritized decision (spec §7.2, §28.1).
2. **No Stripe dependency** unless and until stage 3 is deliberately chosen.
3. **Norwegian customer-facing text** throughout: "Betaling med faktura", "Pris ekskl. mva", "Vi sender faktura til oppgitt fakturaadresse", "Tilgangen aktiveres etter behandling" (ADR-0012).
4. **No card-payment affordances** in the UI: no card icons, no Stripe Checkout, no Apple Pay, no Google Pay, no "Betal nå" (spec §28.2).
5. **Everything auditable.** Spec §53 makes an auditable order flow a definition-of-done item.
6. **Billing never touches matching.** Purchase history is commercial data and is subject to the same boundary as attribution data (ADR-0006). A paying customer's tenders rank identically to a free user's.
7. **The tender service stays free.** Spec §3: users must be able to use the free service without buying anything, and tender data is never withheld to force a purchase.

## 6. Related documents

- ADR-0010: manual invoicing before a billing system, billing system before Stripe
- ADR-0005: Postmark message streams (which stream billing mail uses and why)
- ADR-0006: separation of ranking and marketing (why purchase history cannot reach matching)
- ADR-0009: append-only consent (the pattern `billing_audit_events` follows)
- Spec §28 (payment), §37 (tables), §25 (templates), §45 (admin)
