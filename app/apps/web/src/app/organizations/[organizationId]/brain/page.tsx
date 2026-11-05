'use client';

import { use, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { brainApi } from '@/components/brain/brain-api';

interface PageProps {
  params: Promise<{ organizationId: string }>;
}

// View links are short-lived signed tokens; fetch a fresh one well before it expires.
const VIEW_REFRESH_MS = 20 * 60 * 1000;

// The map frame uses the local brain so a dropped public tunnel cannot blank it.
const LOCAL_BRAIN = (process.env.NEXT_PUBLIC_BRAIN_LOCAL_URL || 'http://localhost:8000').replace(/\/+$/, '');
const localFrameUrl = (url: string) => {
  try {
    const u = new URL(url);
    return `${LOCAL_BRAIN}${u.pathname}${u.search}${u.hash}`;
  } catch {
    return url;
  }
};


export default function BrainPage({ params }: PageProps) {
  const { organizationId } = use(params);

  const view = useQuery({
    queryKey: ['brain-view', organizationId],
    queryFn: () => brainApi.view(organizationId),
    refetchInterval: VIEW_REFRESH_MS,
    refetchOnWindowFocus: false,
    staleTime: VIEW_REFRESH_MS,
    retry: false,
  });

  // Demo only: "view as" cast for the map. 403/404/error just means no hash.
  const personas = useQuery({
    queryKey: ['brain-demo-personas', organizationId],
    queryFn: () => brainApi.demoPersonas(organizationId),
    retry: false,
    refetchInterval: VIEW_REFRESH_MS,
    refetchOnWindowFocus: false,
    staleTime: VIEW_REFRESH_MS,
  });

  const personasHash = useMemo(() => {
    const list = personas.data;
    if (!Array.isArray(list) || list.length === 0) return '';
    const payload = list.map((p) => ({
      id: p.id,
      name: p.name,
      title: p.title,
      dept: p.dept,
      url: localFrameUrl(p.url),
    }));
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let bin = '';
    bytes.forEach((b) => {
      bin += String.fromCharCode(b);
    });
    const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return b64;
  }, [personas.data]);

  // Brain, Frameworks and How it works share this one frame; the tab only changes the hash
  // (the map listens for hashchange), so switching tabs never reloads the frame.
  const searchParams = useSearchParams();
  const rawView = searchParams?.get('view');
  const mapView = rawView === 'frameworks' || rawView === 'how' ? rawView : 'brain';
  const frameSrc = view.data?.url
    ? `${localFrameUrl(view.data.url).split('#')[0]}#view=${mapView}${personasHash ? `&personas=${personasHash}` : ''}`
    : '';

  return (
    <section
      className="flex h-[calc(100vh-4rem)] w-full flex-col overflow-hidden bg-card"
      aria-label="Brain map"
    >
      {view.isLoading && (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {view.isError && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <p>The brain isn&apos;t reachable right now.</p>
          <Button variant="outline" size="sm" onClick={() => view.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Try again
          </Button>
        </div>
      )}
      {frameSrc && (
        <iframe src={frameSrc} title="Company Brain map" className="h-full w-full flex-1 border-0" />
      )}
    </section>
  );
}
