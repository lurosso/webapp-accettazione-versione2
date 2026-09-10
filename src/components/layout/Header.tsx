'use client';

// Intestazione dell'area operatore: identità, postazione/sportello, orologio dell'officina,
// navigazione e uscita.
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { OperatorRole } from '@/domain/entities/operator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { postLogout } from '@/lib/api-client/client';
import { cn } from '@/lib/utils/cn';

export interface HeaderProps {
  readonly displayName: string;
  readonly role: OperatorRole;
  readonly workstationLabel: string;
  readonly deskLabel: string;
  readonly timeZone: string;
}

const ROLE_LABELS: Record<OperatorRole, string> = {
  ADVISOR: 'Accettatore',
  SUPERVISOR: 'Responsabile',
  ADMIN: 'Amministratore',
};

const NAV = [
  { href: '/accettazione', label: 'Accettazione' },
  { href: '/sistema', label: 'Sistema' },
] as const;

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
    <time className="font-mono text-sm text-slate-600 tabular-nums" aria-label="Ora dell'officina">
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
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold tracking-tight">Accettazione Officina</span>
          <nav aria-label="Sezioni" className="flex items-center gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-md px-2.5 py-1 text-sm hover:bg-slate-100',
                  pathname.startsWith(item.href) ? 'bg-slate-100 font-semibold' : 'text-slate-600',
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
          <WorkshopClock timeZone={timeZone} />
          <span className="hidden text-slate-300 sm:inline">|</span>
          <span className="text-slate-700">
            <span className="font-medium">{workstationLabel}</span>
            <span className="text-slate-400"> · </span>
            <span>{deskLabel}</span>
          </span>
          <span className="hidden text-slate-300 sm:inline">|</span>
          <span className="flex items-center gap-2">
            <span className="font-medium">{displayName}</span>
            <Badge tone={role === 'ADVISOR' ? 'neutral' : 'info'}>{ROLE_LABELS[role]}</Badge>
          </span>
          <Button variant="outline" size="sm" onClick={() => void onLogout()} disabled={leaving}>
            {leaving ? 'Uscita…' : 'Esci'}
          </Button>
        </div>
      </div>
    </header>
  );
}
