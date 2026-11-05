import { Card, CardContent } from '@/components/ui/card';
import type { BrainLayer } from '@/components/brain/brain-api';
import { RING_DOT } from './shared';

const RINGS: { layer: BrainLayer; title: string; who: string }[] = [
  { layer: 'core', title: 'Company core', who: 'Everyone reads it' },
  { layer: 'dept-core', title: 'Department core', who: 'Everyone reads it' },
  { layer: 'dept', title: 'Department internal', who: 'The department, plus people granted access' },
  { layer: 'private', title: 'Private', who: 'Only the author' },
];

/** The four rings in one row: who reads what, from the centre outward. */
export function RingsLegend() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {RINGS.map((ring, index) => (
        <Card key={ring.layer}>
          <CardContent className="flex items-start gap-3 py-4">
            <span
              className={`mt-1 h-3 w-3 shrink-0 rounded-full ${RING_DOT[ring.layer]}`}
              aria-hidden
            />
            <div className="min-w-0">
              <p className="text-sm font-medium">
                <span className="mr-1.5 text-muted-foreground">{index + 1}</span>
                {ring.title}
              </p>
              <p className="text-xs text-muted-foreground">{ring.who}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
