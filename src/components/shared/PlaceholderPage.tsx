// Pagina segnaposto per le aree già raggiungibili ma non ancora sviluppate.
// Serve a tenere la navigazione coerente: la voce di menu esiste, la rotta risponde e dice
// onestamente cosa arriverà e quando, invece di portare altrove o mostrare un errore.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';

export interface PlaceholderPageProps {
  readonly title: string;
  readonly intro: string;
  /** Funzioni previste, con la milestone che le porterà. */
  readonly planned: readonly { readonly label: string; readonly milestone: string }[];
  /** Scorciatoie utili nel frattempo. */
  readonly shortcuts?: readonly { readonly href: string; readonly label: string }[];
  readonly children?: ReactNode;
}

export function PlaceholderPage({
  title,
  intro,
  planned,
  shortcuts = [],
  children,
}: PlaceholderPageProps) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <Badge tone="warning">In lavorazione</Badge>
        </div>
        <p className="text-sm text-slate-600">{intro}</p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold tracking-wide text-slate-600 uppercase">
          Funzioni previste
        </h2>
        <ul className="mt-3 flex flex-col divide-y divide-slate-100">
          {planned.map((item) => (
            <li key={item.label} className="flex items-center justify-between gap-4 py-2 text-sm">
              <span className="text-slate-800">{item.label}</span>
              <span className="shrink-0 font-mono text-xs text-slate-500">{item.milestone}</span>
            </li>
          ))}
        </ul>
        {children}
      </section>

      {shortcuts.length > 0 ? (
        <nav className="flex flex-wrap gap-3 text-sm" aria-label="Scorciatoie">
          {shortcuts.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50"
            >
              {s.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
