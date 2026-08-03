import { ORDER_STATUS_LABEL_NB } from '@luma/domain';
import { FOOTER_NB, ORDER_RECEIVED_NB } from '../../copy.js';
import { formatDate } from '../../format.js';
import { buildLinks } from '../../links.js';
import type { OrderReceivedContext, RenderedEmail } from '../../types.js';
import * as h from '../html.js';
import type { Part } from '../parts.js';
import { renderHeader, renderLegalFooter, renderTitle } from '../sections.js';
import { assemble } from '../shell.js';
import * as t from '../text.js';

/**
 * Confirmation that an order enquiry was received (spec section 28.2, step 1).
 *
 * Invoice only. No card icons, no "Betal nå", no Stripe: the prohibited
 * payment vocabulary in `FORBIDDEN_PAYMENT_TERMS` is part of the shared
 * forbidden-phrasing test, so this template is checked against it like every
 * other. The free-service reminder is there because an order confirmation is
 * the one moment a user might reasonably wonder whether the tender alerts
 * have just become a paid product.
 */
export function renderOrderReceived(
  context: OrderReceivedContext,
): RenderedEmail<'order-request-received-v1'> {
  const links = buildLinks(context.links);
  const order = context.order;

  const rows: Array<readonly [string, string]> = [
    [ORDER_RECEIVED_NB.productLabel, order.productName],
    [ORDER_RECEIVED_NB.companyLabel, order.billingCompanyName],
  ];
  if (order.organizationNumber) {
    rows.push([ORDER_RECEIVED_NB.organizationNumberLabel, order.organizationNumber]);
  }
  rows.push([
    ORDER_RECEIVED_NB.addressLabel,
    `${order.billingAddress}, ${order.billingPostalCode} ${order.billingCity}, ${order.billingCountry}`,
  ]);
  rows.push([ORDER_RECEIVED_NB.invoiceEmailLabel, order.invoiceEmail]);
  rows.push([ORDER_RECEIVED_NB.contactPersonLabel, order.contactPerson]);
  if (order.customerReference) {
    rows.push([ORDER_RECEIVED_NB.customerReferenceLabel, order.customerReference]);
  }
  if (order.purchaseOrderNumber) {
    rows.push([ORDER_RECEIVED_NB.purchaseOrderLabel, order.purchaseOrderNumber]);
  }
  rows.push([ORDER_RECEIVED_NB.statusLabel, ORDER_STATUS_LABEL_NB[context.status]]);

  const paymentLines = [
    ORDER_RECEIVED_NB.priceExcludesVat,
    ORDER_RECEIVED_NB.invoiceWillBeSent,
    ORDER_RECEIVED_NB.activationAfterHandling,
  ];

  const body: Part = {
    html: [
      h.paragraph(ORDER_RECEIVED_NB.intro),
      h.definitionList(rows.map(([label, value]) => h.definitionRow(label, value))),
      h.heading(ORDER_RECEIVED_NB.paymentHeading, 3),
      h.bulletList(paymentLines),
      h.paragraph(ORDER_RECEIVED_NB.freeServiceReminder, { muted: true }),
    ].join('\n'),
    text: [
      t.wrap(ORDER_RECEIVED_NB.intro),
      '',
      ...rows.map(([label, value]) => t.definition(label, value)),
      '',
      ORDER_RECEIVED_NB.paymentHeading,
      ...paymentLines.map((line) => t.bullet(line)),
      '',
      t.wrap(ORDER_RECEIVED_NB.freeServiceReminder),
    ].join('\n'),
  };

  return assemble({
    template: 'order-request-received-v1',
    subject: ORDER_RECEIVED_NB.subject,
    preheader: `${ORDER_RECEIVED_NB.productLabel}: ${order.productName}`,
    sections: [
      renderHeader(),
      renderTitle(ORDER_RECEIVED_NB.heading, formatDate(context.now)),
      body,
      renderLegalFooter({ links, sender: context.sender, why: FOOTER_NB.whyTransactional }),
    ],
  });
}
