// Contenitore con bordo sottile ed elevazione di primo livello.
//
// Bordo `line` e non `slate-200`: il bordo di una card non deve pesare più di quello che
// racchiude. L'ombra `sm` è la prima delle quattro elevazioni: una card dentro un pannello non
// porta ombra propria, altrimenti si sommano e la pagina prende quell'aria gonfia.
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('border-line-subtle bg-surface rounded-lg border shadow-sm', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5 p-6 pb-4', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2 className={cn('text-ink text-lg font-semibold tracking-tight', className)} {...props} />
  );
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-ink-muted testo-corpo', className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-6 pt-4', className)} {...props} />;
}
