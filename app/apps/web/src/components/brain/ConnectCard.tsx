'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { brainApi } from './brain-api';

const CLAUDE_STEPS = [
  'Open Claude → Settings → Connectors.',
  'Click "Add custom connector".',
  'Paste your link and save.',
];

const CHATGPT_STEPS = [
  'Open chatgpt.com/plugins and click +.',
  'Choose "Create custom MCP server" and paste your link.',
  'Set Authentication to "No authentication" and save.',
];

const Steps = ({ title, steps }: { title: string; steps: string[] }) => (
  <div className="space-y-1">
    <p className="text-sm font-medium">{title}</p>
    <ol className="list-decimal space-y-0.5 pl-5 text-sm text-muted-foreground">
      {steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  </div>
);

/** The caller's personal MCP link: it only ever answers with what this person may read. */
export const ConnectCard = ({ organizationId }: { organizationId: string }) => {
  const [isCopied, setIsCopied] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['brain-mcp-link', organizationId],
    queryFn: () => brainApi.mcpLink(organizationId),
    retry: false,
  });

  const handleCopy = async () => {
    if (!data?.url) return;
    await navigator.clipboard.writeText(data.url);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Connect Claude / ChatGPT</CardTitle>
        <CardDescription>
          Your personal link. It answers only with what you are allowed to read. Don&apos;t share
          it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {isError && (
          <p className="text-sm text-destructive">Couldn&apos;t load your link. Try again soon.</p>
        )}
        {data?.url && (
          <div className="flex gap-2">
            <Input
              readOnly
              value={data.url}
              aria-label="Your MCP link"
              className="font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleCopy}
              aria-label="Copy link"
            >
              {isCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        )}
        <Steps title="Claude" steps={CLAUDE_STEPS} />
        <Steps title="ChatGPT" steps={CHATGPT_STEPS} />
      </CardContent>
    </Card>
  );
};
