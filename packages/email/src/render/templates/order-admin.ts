import { ORDER_STATUS_LABEL_NB } from '@luma/domain';
import { FOOTER_NB, ORDER_ADMIN_NB, orderAdminSubject } from '../../copy.js';
import { formatDateTime } from '../../format.js';
import { buildLinks, lumaLink } from '../../links.js';
import type { OrderAdminNotificationContext, RenderedEmail } from '../../types.js';
import * as h from '../html.js';
import type { Part } from '../parts.js';
import { renderLegalFooter, renderTitle } from '../sections.js';
import { assemble } from '../shell.js';
import * as t from '../text.js';

/**
 * The billing administrator's notification (spec section 28.2, step 2).
 *
 * Two things make this a different document from the customer's confirmation
 * rather than a re-skin of it.
 *
 * First, it is addressed to the person who raises the invoice. The subject
 * names the product and the ordering company so a new order is distinguishable
 * from a receipt in a list of subject lines, and the body is a work item: the
 * invoice basis, the order id, a link into admin, and one line saying what
 * happens next.
 *
 * Second, every invoicing field is printed whether or not it has a value. The
 * customer's confirmation drops the optional rows, which is right there — an
 * empty "Deres referanse" is noise to a customer who did not fill it in. Here
 * a dropped row is expensive: an administrator cannot tell "the customer left
 * it blank" from "the template forgot it", and both readings end in a phone
 * call. `ORDER_ADMIN_NB.missingValue` makes the blank explicit.
 *
 * There is no promotion block and no `renderHeader()`: the free-service byline
 * is a statement to a customer, and this is internal mail. Spec section 28.2's
 * prohibited payment vocabulary applies here as everywhere else, and this
 * template is in `renderAllTemplates()`, so the shared scan covers it.
 */
export function renderOrderAdminNotification(
  context: OrderAdminNotificationContext,
): RenderedEmail<'order-admin-notification-v1'> {
  const links = buildLinks(context.links);
  const order = context.order;
  const adminUrl = lumaLink(context.adminOrderUrl, context.links.medium);

  /** An optional field, rendered as an explicit blank rather than omitted. */
  const supplied = (value: string | undefined): string =>
    value && value.trim().length > 0 ? value : ORDER_ADMIN_NB.missingValue;

  const rows: ReadonlyArray<readonly [string, string]> = [
    [ORDER_ADMIN_NB.orderIdLabel, context.orderId],
    [ORDER_ADMIN_NB.receivedAtLabel, formatDateTime(context.now)],
    [ORDER_ADMIN_NB.statusLabel, ORDER_STATUS_LABEL_NB[context.status]],
    [ORDER_ADMIN_NB.productLabel, order.productName],
    [ORDER_ADMIN_NB.productCodeLabel, order.productCode],
    [ORDER_ADMIN_NB.priceBasisLabel, ORDER_ADMIN_NB.priceBasis],
    [ORDER_ADMIN_NB.companyLabel, order.billingCompanyName],
    [ORDER_ADMIN_NB.organizationNumberLabel, supplied(order.organizationNumber)],
    [
      ORDER_ADMIN_NB.addressLabel,
      `${order.billingAddress}, ${order.billingPostalCode} ${order.billingCity}, ${order.billingCountry}`,
    ],
    [ORDER_ADMIN_NB.invoiceEmailLabel, order.invoiceEmail],
    [ORDER_ADMIN_NB.contactPersonLabel, order.contactPerson],
    [ORDER_ADMIN_NB.customerReferenceLabel, supplied(order.customerReference)],
    [ORDER_ADMIN_NB.purchaseOrderLabel, supplied(order.purchaseOrderNumber)],
  ];

  const body: Part = {
    html: [
      h.paragraph(ORDER_ADMIN_NB.internalNote, { muted: true }),
      h.paragraph(ORDER_ADMIN_NB.intro),
      h.heading(ORDER_ADMIN_NB.invoiceHeading, 3),
      h.definitionList(rows.map(([label, value]) => h.definitionRow(label, value))),
      h.rawParagraph(`<strong>${h.link(adminUrl, ORDER_ADMIN_NB.action)}</strong>`),
      h.heading(ORDER_ADMIN_NB.nextStepHeading, 3),
      h.paragraph(ORDER_ADMIN_NB.nextStep),
    ].join('\n'),
    text: [
      t.wrap(ORDER_ADMIN_NB.internalNote),
      '',
      t.wrap(ORDER_ADMIN_NB.intro),
      '',
      t.underlined(ORDER_ADMIN_NB.invoiceHeading),
      ...rows.map(([label, value]) => t.definition(label, value)),
      '',
      t.labelledLink(ORDER_ADMIN_NB.action, adminUrl),
      '',
      t.underlined(ORDER_ADMIN_NB.nextStepHeading),
      t.wrap(ORDER_ADMIN_NB.nextStep),
    ].join('\n'),
  };

  return assemble({
    template: 'order-admin-notification-v1',
    subject: orderAdminSubject(order.productName, order.billingCompanyName),
    preheader: `${ORDER_ADMIN_NB.orderIdLabel}: ${context.orderId}`,
    sections: [
      renderTitle(ORDER_ADMIN_NB.heading, formatDateTime(context.now)),
      body,
      renderLegalFooter({ links, sender: context.sender, why: FOOTER_NB.whyBillingAdmin }),
    ],
  });
}
