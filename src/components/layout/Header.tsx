'use client';

// Intestazione dell'area operatore: identità di chi è collegato (sempre visibile, è la prima
// domanda che si fa chi trova una postazione già aperta), postazione e sportello, orologio
// dell'officina, navigazione consentita dal ruolo e uscita.
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { OperatorRole } from '@/domain/entities/operator';
import { Button } from '@/components/ui/button';
import { BrandMark } from './BrandMark';
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
const NAV: readonly { href: string; label: string; area: ProtectedArea }[] = [
  { href: '/accettazione', label: 'Accettazione', area: 'accettazione' },
  { href: '/tablet', label: 'Tablet', area: 'tablet' },
  { href: '/manager', label: 'BDC', area: 'manager' },
  { href: '/admin', label: 'Admin', area: 'admin' },
  { href: '/sistema', label: 'Sistema', area: 'sistema' },
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
    <header className="border-brand-lime bg-brand-blue-dark border-b-4 text-white">
      <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2 sm:px-6">
        <div className="flex items-center gap-4">
          <span className="flex items-baseline gap-2">
            <BrandMark tone="light" className="text-base" />
            <span className="hidden text-sm font-semibold text-white/70 sm:inline">
              Accettazione officina
            </span>
          </span>
          <nav aria-label="Sezioni" className="flex items-center gap-1">
            {NAV.filter((item) => canAccess(item.area, role)).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-md px-2.5 py-1 text-sm transition-colors hover:bg-white/10',
                  pathname.startsWith(item.href)
                    ? 'bg-white/15 font-semibold text-white'
                    : 'text-white/75',
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <WorkshopClock timeZone={timeZone} />
          <span className="hidden text-white/30 sm:inline">|</span>
          <span className="text-white/85">
            <span className="font-medium">{workstationLabel}</span>
            <span className="text-white/50"> · </span>
            <span>{deskLabel}</span>
          </span>
          <span className="hidden text-white/30 sm:inline">|</span>
          {/* Chi è collegato: nome per esteso e ruolo, non solo un'iniziale. */}
          <span className="flex items-center gap-2 rounded-full bg-white/10 py-1 pr-3 pl-1 ring-1 ring-white/25">
            <OperatorChip displayName={displayName} role={role} isCurrent size="md" tone="light" />
          </span>
          <Button variant="onDark" size="sm" onClick={() => void onLogout()} disabled={leaving}>
            {leaving ? 'Uscita…' : 'Esci'}
          </Button>
        </div>
      </div>
    </header>
  );
}
