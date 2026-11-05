import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LAYER_LABEL } from '@/components/brain/NoteList';
import type { BrainLayer } from '@/components/brain/brain-api';
import { RING_DOT } from './shared';

const asLayer = (value?: string): BrainLayer | undefined =>
  value && value in LAYER_LABEL ? (value as BrainLayer) : undefined;

/** "Department → Company core" with the ring colours; `done` marks the destination as reached. */
export function RingJourney({
  from,
  to,
  done = false,
}: {
  from?: string;
  to: string;
  done?: boolean;
}) {
  const start = asLayer(from);
  const end = asLayer(to);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {start && (
        <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-muted-foreground">
          <span className={cn('h-2 w-2 rounded-full', RING_DOT[start])} />
          {LAYER_LABEL[start]}
        </span>
      )}
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium',
          done ? 'border-emerald-600/40 bg-emerald-50 text-emerald-800' : 'bg-muted/50',
        )}
      >
        {end && <span className={cn('h-2 w-2 rounded-full', RING_DOT[end])} />}
        {end ? LAYER_LABEL[end] : to}
      </span>
    </div>
  );
}
