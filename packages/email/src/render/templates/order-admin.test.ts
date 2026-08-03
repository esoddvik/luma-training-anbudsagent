import type { CreateOrderInput } from '@luma/domain';
import { describe, expect, it } from 'vitest';
import { ORDER_ADMIN_NB, ORDER_RECEIVED_NB, PROMOTION_NB } from '../../copy.js';
import { FakePostmarkClient } from '../../postmark/fake.js';
import * as f from '../../testing/fixtures.js';
import { renderOrderAdminNotification } from './order-admin.js';
import { renderOrderReceived } from './order-received.js';

/**
 * The admin notification carries the invoice basis (spec section 28.2).
 *
 * A field missing here is not a cosmetic defect. It means somebody at Luma
 * telephones a customer who already supplied the information, so the assertion
 * is field by field and driven from the fixture rather than from a snapshot: a
 * snapshot records what the template does, this records what it owes.
 */

function render(order: CreateOrderInput) {
  return renderOrderAdminNotification({
    recipientEmail: f.BILLING_ADMIN_EMAIL,
    sender: f.SENDER,
    links: { ...f.LINK_CONTEXT, medium: 'landing' },
    now: f.FIXED_NOW,
    order,
    orderId: f.ORDER_REQUEST_ID,
    status: 'received',
    adminOrderUrl: f.ADMIN_ORDER_URL,
  });
}

const complete = render(f.ORDER_INPUT);
const minimal = render(f.ORDER_INPUT_MINIMAL);

/**
 * The text part hard-wraps at 72 columns, so a sentence arrives with newlines
 * in the middle of it. Collapsing whitespace is the difference between
 * asserting on the copy and asserting on the wrap width.
 */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ');
}

describe('subject line', () => {
  it('names the order, the product and the ordering company', () => {
    // The administrator scans a list of subject lines. "Vi har mottatt
    // bestillingen din" - the customer's subject - is indistinguishable from
    // every other receipt in that list.
    expect(complete.subject).toContain('Ny bestilling');
    expect(complete.subject).toContain(f.ORDER_INPUT.productName);
    expect(complete.subject).toContain(f.ORDER_INPUT.billingCompanyName);
    expect(complete.subject).not.toBe(ORDER_RECEIVED_NB.subject);
  });
});

describe('the invoice basis', () => {
  /** Every field an invoice needs, as label and value, from the fixture. */
  const expected: ReadonlyArray<readonly [string, string]> = [
    [ORDER_ADMIN_NB.orderIdLabel, f.ORDER_REQUEST_ID],
    [ORDER_ADMIN_NB.companyLabel, f.ORDER_INPUT.billingCompanyName],
    [ORDER_ADMIN_NB.organizationNumberLabel, f.ORDER_INPUT.organizationNumber as string],
    [ORDER_ADMIN_NB.addressLabel, f.ORDER_INPUT.billingAddress],
    [ORDER_ADMIN_NB.addressLabel, f.ORDER_INPUT.billingPostalCode],
    [ORDER_ADMIN_NB.addressLabel, f.ORDER_INPUT.billingCity],
    [ORDER_ADMIN_NB.addressLabel, f.ORDER_INPUT.billingCountry],
    [ORDER_ADMIN_NB.invoiceEmailLabel, f.ORDER_INPUT.invoiceEmail],
    [ORDER_ADMIN_NB.contactPersonLabel, f.ORDER_INPUT.contactPerson],
    [ORDER_ADMIN_NB.customerReferenceLabel, f.ORDER_INPUT.customerReference as string],
    [ORDER_ADMIN_NB.purchaseOrderLabel, f.ORDER_INPUT.purchaseOrderNumber as string],
    [ORDER_ADMIN_NB.productLabel, f.ORDER_INPUT.productName],
    [ORDER_ADMIN_NB.productCodeLabel, f.ORDER_INPUT.productCode],
    [ORDER_ADMIN_NB.priceBasisLabel, ORDER_ADMIN_NB.priceBasis],
  ];

  for (const [label, value] of expected) {
    it(`carries ${label} in both parts`, () => {
      expect(complete.text).toContain(label);
      expect(complete.text).toContain(value);
      expect(complete.html).toContain(label);
      expect(complete.html).toContain(value);
    });
  }

  it('states the status in Norwegian', () => {
    expect(complete.text).toContain(`${ORDER_ADMIN_NB.statusLabel}: Mottatt`);
  });

  it('prints an absent optional field as a visible blank, never as a missing row', () => {
    // Dropping the row makes "the customer left it out" and "the template lost
    // it" look identical, and both readings end in a phone call.
    for (const label of [
      ORDER_ADMIN_NB.organizationNumberLabel,
      ORDER_ADMIN_NB.customerReferenceLabel,
      ORDER_ADMIN_NB.purchaseOrderLabel,
    ]) {
      expect(minimal.text).toContain(`${label}: ${ORDER_ADMIN_NB.missingValue}`);
      expect(minimal.html).toContain(label);
    }
    expect(minimal.html).toContain(ORDER_ADMIN_NB.missingValue);
  });
});

describe('acting on the order', () => {
  it('links straight to the admin order view, in both parts', () => {
    expect(complete.html).toContain(ORDER_ADMIN_NB.action);
    expect(complete.text).toContain(ORDER_ADMIN_NB.action);
    expect(complete.text).toContain(f.ADMIN_ORDER_URL);
    // Tagged like every other Luma link (spec section 44.2).
    expect(complete.text).toContain('utm_source=anbudsvarsling');
  });

  it('says what happens next, as the manual invoicing flow in spec 28.2', () => {
    expect(complete.text).toContain(ORDER_ADMIN_NB.nextStepHeading);
    expect(flat(complete.text)).toContain(flat(ORDER_ADMIN_NB.nextStep));
    expect(complete.html).toContain(ORDER_ADMIN_NB.nextStep);
    // Steps 3 to 5: raise the invoice, move the status, activate the access.
    expect(flat(complete.text)).toContain('fakturaprosess');
    expect(flat(complete.text)).toContain('aktiver tilgangen');
  });
});

describe('it is internal mail, not a customer document', () => {
  it('carries no promotion and no free-service byline', () => {
    expect(complete.html).not.toContain(PROMOTION_NB.readMore);
    expect(complete.html).not.toContain(PROMOTION_NB.offSwitchIntro);
    expect(complete.html).not.toContain('En gratis tjeneste fra Luma Training');
    expect(complete.html).not.toContain('luma:promotion:start');
  });

  it('does not reuse the customer confirmation copy', () => {
    // The gap this template closes: the administrator used to receive the
    // customer's confirmation, addressed to the customer.
    expect(complete.text).not.toContain(ORDER_RECEIVED_NB.intro);
    expect(complete.text).not.toContain(ORDER_RECEIVED_NB.freeServiceReminder);
    const customerCopy = renderOrderReceived({
      recipientEmail: f.RECIPIENT_EMAIL,
      sender: f.SENDER,
      links: { ...f.LINK_CONTEXT, medium: 'landing' },
      now: f.FIXED_NOW,
      order: f.ORDER_INPUT,
      status: 'received',
    });
    expect(complete.html).not.toBe(customerCopy.html);
    expect(complete.subject).not.toBe(customerCopy.subject);
  });
});

describe('stream routing at send time', () => {
  it('goes out on transactional and never on marketing or tender notifications', async () => {
    const client = new FakePostmarkClient({ now: () => f.FIXED_NOW });
    const outcome = await client.sendTransactional(complete, {
      to: f.BILLING_ADMIN_EMAIL,
      metadata: { orderRequestId: f.ORDER_REQUEST_ID },
    });

    expect(outcome.status).toBe('sent');
    expect(outcome.stream).toBe('transactional');
    expect(client.sentOnStream('transactional').map((email) => email.template)).toEqual([
      'order-admin-notification-v1',
    ]);
    expect(client.sentOnStream('luma-marketing')).toEqual([]);
    expect(client.sentOnStream('tender-notifications')).toEqual([]);
    expect(client.lastSent()?.to).toBe(f.BILLING_ADMIN_EMAIL);
  });

  it('cannot be sent as a tender notification', () => {
    // A compile-time guarantee, restated so the reason survives a refactor:
    // `sendTenderNotification` accepts only `TenderNotificationTemplate`, and
    // this template is not one. The line below does not typecheck without the
    // expect-error, and the directive fails the build if it ever starts to.
    const client = new FakePostmarkClient();
    // @ts-expect-error order-admin-notification-v1 is a transactional template
    void client.sendTenderNotification(complete, { to: f.BILLING_ADMIN_EMAIL });
  });
});
