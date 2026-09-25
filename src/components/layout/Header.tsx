'use client';

// Navigazione dell'area operatore, in due forme che sono lo stesso markup.
//
// Al banco è una COLONNA a sinistra: restituisce una sessantina di pixel d'altezza — una riga e
// mezza di coda in più su un monitor da ufficio — e tiene le sezioni incolonnate, che con il mouse
// si puntano meglio di una fila orizzontale. Sul tablet è una BARRA in alto: una colonna ruberebbe
// larghezza dove ce n'è poca, e il pollice al bordo superiore ci arriva comunque.
//
// A cambiare forma è il CSS (`banco:`, cioè `pointer: fine`), non un ramo di codice: così la
// struttura è già giusta al primo disegno e non si riassesta dopo l'idratazione.
//
// Il contenuto resta quello di prima: identità di chi è collegato (sempre visibile, è la prima
// domanda che si fa chi trova una postazione già aperta), postazione e sportello, orologio
// dell'officina, sezioni consentite dal ruolo, uscita.
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { OperatorRole } from '@/domain/entities/operator';
import { Button } from '@/components/ui/button';
import { useIsTouchLayout } from '@/hooks/useMediaQuery';
import { BrandMark } from './BrandMark';
import { TransitionLink } from './TransitionLink';
import { OperatorChip } from '@/components/shared/OperatorChip';
import { postLogout } from '@/lib/api-client/client';
import { canAccess, type ProtectedArea } from '@/lib/navigation';
import { cn } from '@/lib/utils/cn';

export interface HeaderProps {
  readonly displayName: string;
  readonly role: OperatorRole;
  readonly workstationLabel: string;
  readonly deskLabel: string;
  readonly timeZone: string;
}

/** Voci di navigazione: i permessi arrivano da `AREA_ROLES`, non duplicati qui. */
const NAV: readonly {
  href: string;
  label: string;
  area: ProtectedArea;
  /** Etichetta per chi non amministra, se diversa (la stessa pagina mostra cose diverse). */
  labelBanco?: string;
}[] = [
  { href: '/accettazione', label: 'Accettazione', area: 'accettazione' },
  { href: '/accettazione/archivio', label: 'Archivio', area: 'accettazione' },
  { href: '/check-in', label: 'Check-in', area: 'check-in' },
  { href: '/admin', label: 'Admin', area: 'admin' },
  { href: '/sistema', label: 'Sistema', area: 'sistema', labelBanco: 'Segnala un problema' },
];

function WorkshopClock({ timeZone }: { readonly timeZone: string }) {
  const [now, setNow] = useState<string>('');
  useEffect(() => {
    const formatter = new Intl.DateTimeFormat('it-IT', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const update = (): void => setNow(formatter.format(new Date()));
    update();
    const timer = setInterval(update, 1_000);
    return () => clearInterval(timer);
  }, [timeZone]);
  return (
    <time className="font-mono text-sm text-white/80 tabular-nums" aria-label="Ora dell'officina">
      {now}
    </time>
  );
}

export function Header({ displayName, role, workstationLabel, deskLabel, timeZone }: HeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [leaving, setLeaving] = useState(false);
  // La voce "Check-in" ha senso solo dove si possono scattare foto.
  const touchLayout = useIsTouchLayout();

  const onLogout = async (): Promise<void> => {
    setLeaving(true);
    try {
      await postLogout();
    } finally {
      router.push('/login');
      router.refresh();
    }
  };

  return (
    <header
      className={cn(
        'border-brand-lime bg-brand-blue-dark border-b-4 text-white',
        'banco:sticky banco:top-0 banco:h-screen banco:w-60 banco:shrink-0 banco:border-r-4 banco:border-b-0',
      )}
    >
      <div
        className={cn(
          // In alto lo spazio della barra di stato dell'iPad a tutto schermo (zero altrove): con
          // `black-translucent` la pagina passa sotto la barra, e senza questo margine l'ora del
          // sistema si sovrappone al marchio.
          'mx-auto flex max-w-screen-2xl flex-wrap items-center gap-x-6 gap-y-2 px-4 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-2 sm:px-6',
          'banco:mx-0 banco:h-full banco:max-w-none banco:flex-col banco:flex-nowrap banco:items-stretch banco:gap-3 banco:px-3 banco:py-5',
        )}
      >
        <div className="banco:flex-col banco:items-start banco:gap-5 flex items-center gap-4">
          <span className="banco:px-2 flex items-baseline gap-2">
            <BrandMark tone="light" className="text-base" />
            <span className="banco:hidden hidden text-sm font-semibold text-white/70 sm:inline">
              Accettazione officina
            </span>
          </span>
          <nav
            aria-label="Sezioni"
            className="banco:w-full banco:flex-col banco:items-stretch flex items-center gap-1"
          >
            {NAV.filter(
              (item) => canAccess(item.area, role) && (item.href !== '/check-in' || touchLayout),
            ).map((item) => (
              <TransitionLink
                key={item.href}
                href={item.href}
                className={cn(
                  // `controllo`: 44 px al banco, 52 col dito, come ogni altro comando.
                  'controllo transizione inline-flex items-center rounded-md px-3 text-sm hover:bg-white/10',
                  (
                    item.href === '/accettazione'
                      ? pathname === item.href || pathname.startsWith('/accettazione/pratiche')
                      : pathname.startsWith(item.href)
                  )
                    ? 'bg-white/15 font-semibold text-white'
                    : 'text-white/75',
                )}
              >
                {role !== 'ADMIN' && item.labelBanco !== undefined ? item.labelBanco : item.label}
              </TransitionLink>
            ))}
          </nav>
        </div>

        <div
          className={cn(
            'ml-auto flex flex-wrap items-center gap-x-4 gap-y-2 text-sm',
            'banco:mt-auto banco:ml-0 banco:flex-col banco:items-stretch banco:gap-3 banco:border-t banco:border-white/20 banco:pt-4',
          )}
        >
          <WorkshopClock timeZone={timeZone} />
          <span className="banco:hidden hidden text-white/30 sm:inline">|</span>
          <span className="text-white/85">
            <span className="font-medium">{workstationLabel}</span>
            <span className="text-white/50"> · </span>
            <span>{deskLabel}</span>
          </span>
          <span className="banco:hidden hidden text-white/30 sm:inline">|</span>
          {/* Chi è collegato: nome per esteso e ruolo, non solo un'iniziale. */}
          <span className="flex items-center gap-2 rounded-full bg-white/10 py-1 pr-3 pl-1 ring-1 ring-white/25">
            <OperatorChip displayName={displayName} role={role} isCurrent size="md" tone="light" />
          </span>
          <Button variant="onDark" onClick={() => void onLogout()} disabled={leaving}>
            {leaving ? 'Uscita…' : 'Esci'}
          </Button>
        </div>
      </div>
    </header>
  );
}
