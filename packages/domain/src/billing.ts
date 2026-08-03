import { z } from 'zod';

/**
 * Ordering paid Luma products (spec section 28).
 *
 * The MVP has no order or subscription engine. An order is a structured
 * enquiry handled manually, and invoicing happens in Luma's existing process
 * outside this system (ADR-10). The provider interface exists now so that a
 * real billing system in phase 7 is an added implementation rather than a
 * rewrite of every call site.
 */

export const orderStatusSchema = z.enum([
  'received',
  'in_progress',
  'activated',
  'declined',
  'cancelled',
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

/** Norwegian labels for the admin and customer views. */
export const ORDER_STATUS_LABEL_NB: Readonly<Record<OrderStatus, string>> = {
  received: 'Mottatt',
  in_progress: 'Under behandling',
  activated: 'Aktivert',
  declined: 'Avslått',
  cancelled: 'Kansellert',
};

/**
 * Legal status transitions. An order cannot move out of a terminal state, and
 * activation must pass through handling, so the audit trail always shows who
 * processed it (spec section 28.2 step 6).
 */
const ALLOWED_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  received: ['in_progress', 'declined', 'cancelled'],
  in_progress: ['activated', 'declined', 'cancelled'],
  activated: [],
  declined: [],
  cancelled: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export const orderRequestSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  /** Stable product key, for example `paafyll` or `heldagskurs`. */
  productCode: z.string().min(1),
  productName: z.string().min(1),

  billingCompanyName: z.string().min(1),
  organizationNumber: z
    .string()
    .regex(/^\d{9}$/, 'et norsk organisasjonsnummer har ni siffer')
    .optional(),
  billingAddress: z.string().min(1),
  billingPostalCode: z.string().min(1),
  billingCity: z.string().min(1),
  billingCountry: z.string().min(1).default('Norge'),
  invoiceEmail: z.email(),
  contactPerson: z.string().min(1),
  customerReference: z.string().optional(),
  purchaseOrderNumber: z.string().optional(),

  status: orderStatusSchema,
  adminNote: z.string().max(4000).optional(),
  handledByAdminId: z.uuid().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type OrderRequest = z.infer<typeof orderRequestSchema>;

export const createOrderInputSchema = orderRequestSchema.omit({
  id: true,
  userId: true,
  status: true,
  adminNote: true,
  handledByAdminId: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateOrderInput = z.infer<typeof createOrderInputSchema>;

/**
 * The seam that keeps the MVP from hard-coding manual handling everywhere.
 * `ManualInvoiceBillingProvider` is the only implementation until phase 7.
 */
export interface BillingProvider {
  createOrder(input: CreateOrderInput & { userId: string }): Promise<OrderRequest>;
  activateOrder(orderId: string, adminId: string): Promise<void>;
  cancelOrder(orderId: string, adminId: string): Promise<void>;
}

/**
 * Approved Norwegian invoice copy (spec section 28.2). Card payment, Stripe
 * and "Betal nå" must not appear anywhere in the MVP.
 */
export const INVOICE_COPY_NB = {
  paymentMethod: 'Betaling med faktura',
  priceExcludesVat: 'Pris ekskl. mva.',
  invoiceWillBeSent: 'Vi sender faktura til oppgitt fakturaadresse.',
  activationAfterHandling: 'Tilgangen aktiveres etter behandling.',
} as const;

/** Payment vocabulary that must not appear in any customer-facing surface. */
export const FORBIDDEN_PAYMENT_TERMS: readonly string[] = [
  'Stripe',
  'Apple Pay',
  'Google Pay',
  'Betal nå',
  'kortbetaling',
  'Checkout',
];
