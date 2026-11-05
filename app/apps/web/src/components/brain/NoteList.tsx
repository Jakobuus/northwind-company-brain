'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowUpRight, FileText, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  brainApi,
  brainErrorText,
  type BrainLayer,
  type BrainMoveTarget,
  type BrainNote,
} from './brain-api';

export const LAYER_LABEL: Record<BrainLayer, string> = {
  core: 'Company core',
  'dept-core': 'Department core',
  dept: 'Department',
  private: 'Private',
};

const LAYER_CLASS: Record<BrainLayer, string> = {
  core: 'border-transparent bg-primary text-primary-foreground',
  'dept-core': 'border-transparent bg-sky-600 text-white',
  dept: 'border-transparent bg-emerald-600 text-white',
  private: 'border-transparent bg-zinc-500 text-white',
};

const TARGET_LABEL: Record<BrainMoveTarget, string> = {
  dept: 'department',
  'dept-core': 'department core',
  core: 'company core',
};

/** Next ring inward from a layer; private notes go inward by "commit", not a promotion. */
const NEXT_TARGET: Partial<Record<BrainLayer, BrainMoveTarget>> = {
  dept: 'dept-core',
  'dept-core': 'core',
};

/** Fall back to v1 fields while the brain doesn't send `layer` yet. */
// Readable ring names; the move's `by` is a raw user id, so it is left off screen.
const MOVE_LABEL: Record<string, string> = {
  private: 'Private',
  dept: 'Department',
  'dept-core': 'Department core',
  core: 'Company core',
};

export const noteLayer = (note: BrainNote): BrainLayer | undefined => {
  if (note.layer) return note.layer;
  if (note.access === 'private') return 'private';
  if (note.area === 'core') return 'core';
  if (note.access === 'all') return 'dept-core';
  if (note.access === 'area') return 'dept';
  return undefined;
};

export const LayerBadge = ({ layer }: { layer?: BrainLayer }) => {
  if (!layer) return null;
  return (
    <Badge className={cn('whitespace-nowrap', LAYER_CLASS[layer])}>{LAYER_LABEL[layer]}</Badge>
  );
};

interface NoteActionsProps {
  organizationId: string;
  note: BrainNote;
}

const NoteActions = ({ organizationId, note }: NoteActionsProps) => {
  const queryClient = useQueryClient();
  const layer = noteLayer(note);
  const canMove = note.can_move ?? [];

  const action = useMutation({
    mutationFn: async (kind: 'commit' | 'promote' | 'request') => {
      if (kind === 'commit') return brainApi.commit(organizationId, note.id);
      const target = canMove.find((t) => t !== 'dept') ?? NEXT_TARGET[layer ?? 'dept'] ?? 'core';
      if (kind === 'promote') return brainApi.move(organizationId, note.id, target);
      return brainApi.requestPromotion(organizationId, note.id, target);
    },
    onSuccess: (_, kind) => {
      toast.success(
        kind === 'request' ? 'Promotion requested. The department lead decides.' : 'Note moved',
      );
      queryClient.invalidateQueries({ queryKey: ['brain-notes', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['brain-view', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['brain-graph', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['brain-promotion-requests', organizationId] });
    },
    onError: (error) => toast.error(brainErrorText(error)),
  });

  const busy = action.isPending;
  const spinner = busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />;

  if (layer === 'private') {
    if (!canMove.includes('dept') && note.can_move) return null;
    return (
      <Button size="sm" variant="outline" disabled={busy} onClick={() => action.mutate('commit')}>
        {spinner}
        Commit to my department
      </Button>
    );
  }

  const promoteTarget = canMove.find((t) => t !== 'dept');
  if (promoteTarget) {
    return (
      <Button size="sm" variant="outline" disabled={busy} onClick={() => action.mutate('promote')}>
        {spinner}
        <ArrowUpRight className="mr-1 h-3 w-3" />
        Promote to {TARGET_LABEL[promoteTarget]}
      </Button>
    );
  }

  if (layer === 'dept' || layer === 'dept-core') {
    return (
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => action.mutate('request')}>
        {spinner}
        Request promotion
      </Button>
    );
  }

  return null;
};

interface NoteListProps {
  organizationId: string;
  notes: BrainNote[];
  showActions?: boolean;
  className?: string;
}

export const NoteList = ({
  organizationId,
  notes,
  showActions = true,
  className,
}: NoteListProps) => (
  <ul className={cn('space-y-3', className)}>
    {notes.map((note) => {
      const layer = noteLayer(note);
      const lastMove = note.moved?.[note.moved.length - 1];
      return (
        <li key={note.id} className="flex items-start gap-2 text-sm">
          <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate font-medium">{note.title}</p>
              <LayerBadge layer={layer} />
            </div>
            <p className="text-xs text-muted-foreground">
              {[note.dept ?? note.area, note.type, note.date].filter(Boolean).join(' · ')}
            </p>
            {lastMove && (
              <p className="text-xs text-muted-foreground">
                Moved {MOVE_LABEL[lastMove.from] ?? lastMove.from} → {MOVE_LABEL[lastMove.to] ?? lastMove.to}
              </p>
            )}
            {showActions && <NoteActions organizationId={organizationId} note={note} />}
          </div>
        </li>
      );
    })}
  </ul>
);
