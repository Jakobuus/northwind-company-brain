import { BadGatewayException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrainNote, BrainUploadResponse } from '@app-starter/shared';
import { BrainPolicyPayload } from './brain-policy';

const GENERIC_ERROR = 'The company brain is unavailable right now. Please try again.';

/** Thin HTTP client for the brain's internal API. Brain error bodies are logged, never forwarded. */
@Injectable()
export class BrainClient {
  private readonly logger = new Logger(BrainClient.name);

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return (this.config.get<string>('BRAIN_INTERNAL_URL') ?? 'http://localhost:8000').replace(/\/$/, '');
  }

  private async call<T>(
    path: string,
    init: RequestInit & { json?: unknown; deniedStatuses?: number[] },
  ): Promise<T> {
    const token = this.config.get<string>('BRAIN_SERVICE_TOKEN');
    if (!token) {
      this.logger.error('BRAIN_SERVICE_TOKEN is not set');
      throw new BadGatewayException(GENERIC_ERROR);
    }
    const headers: Record<string, string> = { 'X-Brain-Service': token };
    let body = init.body;
    if (init.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(init.json);
    }
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: init.method ?? 'GET',
        headers,
        body,
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        if (init.deniedStatuses?.includes(res.status)) {
          throw new ForbiddenException('You cannot do that with this note');
        }
        this.logger.warn(`brain ${init.method ?? 'GET'} ${path} -> ${res.status}`);
        throw new BadGatewayException(GENERIC_ERROR);
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof BadGatewayException || err instanceof ForbiddenException) throw err;
      this.logger.warn(`brain ${path} failed: ${(err as Error).message}`);
      throw new BadGatewayException(GENERIC_ERROR);
    }
  }

  async putPolicy(orgId: string, policy: BrainPolicyPayload): Promise<void> {
    await this.call(`/internal/orgs/${encodeURIComponent(orgId)}/policy`, { method: 'PUT', json: policy });
  }

  async viewUrl(orgId: string, person: string, ttlSeconds: number): Promise<string> {
    const r = await this.call<{ url: string }>(`/internal/orgs/${encodeURIComponent(orgId)}/view-token`, {
      method: 'POST',
      json: { person, ttl_seconds: ttlSeconds },
    });
    return r.url;
  }

  async mcpLink(orgId: string, person: string): Promise<string> {
    const r = await this.call<{ url: string }>(
      `/internal/orgs/${encodeURIComponent(orgId)}/mcp-link?person=${encodeURIComponent(person)}`,
      {},
    );
    return r.url;
  }

  async notes(orgId: string, person: string): Promise<BrainNote[]> {
    return this.call<BrainNote[]>(
      `/internal/orgs/${encodeURIComponent(orgId)}/notes?person=${encodeURIComponent(person)}`,
      {},
    );
  }

  /** Move a note between layers. The brain decides; 403/404 both read as "not allowed". */
  async moveNote(orgId: string, noteId: string, to: string, by: string): Promise<void> {
    await this.call(
      `/internal/orgs/${encodeURIComponent(orgId)}/notes/${encodeURIComponent(noteId)}/move`,
      { method: 'POST', json: { to, by }, deniedStatuses: [403, 404] },
    );
  }

  async importFile(
    orgId: string,
    file: { buffer: Buffer; originalname: string; mimetype?: string },
    fields: { area: string; access: string; author: string; allow: string[] },
  ): Promise<BrainUploadResponse> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file.buffer)]), file.originalname);
    form.append('area', fields.area);
    form.append('access', fields.access);
    form.append('author', fields.author);
    form.append('allow', fields.allow.join(','));
    return this.call<BrainUploadResponse>(`/internal/orgs/${encodeURIComponent(orgId)}/import`, {
      method: 'POST',
      body: form,
    });
  }
}
