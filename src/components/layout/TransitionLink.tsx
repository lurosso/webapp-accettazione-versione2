'use client';

// Un `Link` di Next che fa sfumare la pagina corrente appena toccato. Il prefetch e tutto il resto
// restano quelli di `Link`; qui si intercetta solo il click "normale" (tasto principale, nessun
// modificatore, stessa finestra) per passare dal router con la transizione. Cmd/Ctrl-click e
// compagnia restano al browser, che apre la scheda come farebbe con qualunque link.
import Link from 'next/link';
import type { ComponentProps, MouseEvent } from 'react';
import { useTransitionRouter } from '@/hooks/useTransitionRouter';
import { clickDaAnimare } from './page-transition-store';

type TransitionLinkProps = ComponentProps<typeof Link>;

/** L'`href` di `Link` come stringa: è quello che si passa al router. */
function hrefComeStringa(href: TransitionLinkProps['href']): string {
  if (typeof href === 'string') {
    return href;
  }
  const pathname = href.pathname ?? '';
  let query = '';
  if (typeof href.query === 'string') {
    query = href.query;
  } else if (href.query !== null && href.query !== undefined) {
    const coppie: [string, string][] = [];
    for (const [k, v] of Object.entries(href.query)) {
      if (v === undefined || v === null) {
        continue;
      }
      if (Array.isArray(v)) {
        for (const x of v) {
          coppie.push([k, String(x)]);
        }
      } else {
        coppie.push([k, String(v)]);
      }
    }
    query = new URLSearchParams(coppie).toString();
  }
  return `${pathname}${query === '' ? '' : `?${query}`}${href.hash ?? ''}`;
}

export function TransitionLink(props: TransitionLinkProps) {
  const { href, onClick, target } = props;
  const router = useTransitionRouter();
  const destinazione = hrefComeStringa(href);
  return (
    <Link
      {...props}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (!clickDaAnimare(event, target)) {
          return;
        }
        event.preventDefault();
        router.push(destinazione);
      }}
    />
  );
}
