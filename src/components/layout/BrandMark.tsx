// Marchio Autoclub Group in forma testuale: "AUTOCLUB" più il riquadro verde "GROUP", come sul
// sito aziendale. È scritto in CSS e non è un'immagine: resta nitido su un monitor 4K appeso in
// officina come su un tablet, si adatta al colore dello sfondo e non aggiunge un file da caricare
// a ogni pagina. Il logo ufficiale potrà sostituirlo quando ci verrà fornito.
import { cn } from '@/lib/utils/cn';

export interface BrandMarkProps {
  /** `dark` su fondo chiaro, `light` su fondo scuro (intestazioni blu, monitor). */
  readonly tone?: 'dark' | 'light';
  readonly className?: string;
}

export function BrandMark({ tone = 'dark', className }: BrandMarkProps) {
  return (
    <span
      className={cn('inline-flex items-baseline gap-1.5 leading-none font-black', className)}
      aria-label="Autoclub Group"
    >
      <span className={cn('tracking-tight', tone === 'light' ? 'text-white' : 'text-brand-blue')}>
        AUTOCLUB
      </span>
      <span className="bg-brand-lime rounded-sm px-1.5 py-0.5 text-[0.72em] tracking-[0.12em] text-white">
        GROUP
      </span>
    </span>
  );
}
