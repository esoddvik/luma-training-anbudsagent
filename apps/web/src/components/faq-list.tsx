'use client';

import { useState } from 'react';
import { Disclosure } from '@luma/ui';

export interface FaqItem {
  readonly q: string;
  readonly a: string;
}

/**
 * The landing page's FAQ.
 *
 * `Disclosure` is controlled on purpose (see its own note), so *someone* has to
 * own the open state. This is the smallest possible owner: one index, one
 * `'use client'` file, and a landing page that stays a server component.
 *
 * One panel open at a time. A FAQ is a list of alternatives, not a list of
 * things to compare side by side, and keeping every answer open turns five
 * short questions into a wall the reader has to scroll past to reach the next
 * one. Clicking the open question closes it, so «all closed» stays reachable.
 */
export function FaqList({ items }: { readonly items: readonly FaqItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="flex flex-col">
      {items.map((item, index) => (
        <Disclosure
          key={item.q}
          id={`faq-${index}`}
          summary={item.q}
          open={openIndex === index}
          onToggle={(next) => setOpenIndex(next ? index : null)}
        >
          <p className="prose-measure m-0 text-text-muted">{item.a}</p>
        </Disclosure>
      ))}
    </div>
  );
}
