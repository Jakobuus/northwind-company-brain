import { cn } from '@/lib/utils';
import type { BrainLayer } from '@/components/brain/brain-api';

/** Ring colours match the layer badges used on notes (NoteList). */
export const RING_DOT: Record<BrainLayer, string> = {
  core: 'bg-primary',
  'dept-core': 'bg-sky-600',
  dept: 'bg-emerald-600',
  private: 'bg-zinc-500',
};

export const initialsOf = (name?: string | null, fallback = '?') =>
  (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || fallback;

export const Initials = ({
  name,
  className,
  title,
}: {
  name?: string | null;
  className?: string;
  title?: string;
}) => (
  <span
    title={title ?? name ?? undefined}
    className={cn(
      'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-foreground ring-2 ring-background',
      className,
    )}
  >
    {initialsOf(name)}
  </span>
);
