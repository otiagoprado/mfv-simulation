/**
 * Projetos na nuvem: armazenamento dos projetos MFV em um servidor Supabase (Postgres + REST + Auth),
 * acessado direto do navegador, sem dependências. Veja docs/NUVEM-SUPABASE.md para criar o servidor.
 *
 * Configuração: variáveis de build VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ou, sem rebuild,
 * os valores informados na própria tela (gravados no navegador).
 */

export interface CloudConfig {
  url: string;
  anonKey: string;
}

export interface CloudSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch em segundos
  email: string;
}

export interface CloudProjectSummary {
  id: string;
  name: string;
  client: string;
  updatedAt: string;
}

export interface CloudProjectRecord<T = unknown> extends CloudProjectSummary {
  workspace: T;
}

const CONFIG_KEY = 'mfv-cloud-config:v1';
const SESSION_KEY = 'mfv-cloud-session:v1';
const TABLE = 'mfv_projects';

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

function normalizeUrl(url: string) {
  return url.trim().replace(/\/+$/, '');
}

export function loadCloudConfig(): CloudConfig | null {
  try {
    const stored = localStorage.getItem(CONFIG_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<CloudConfig>;
      if (parsed.url && parsed.anonKey) return { url: normalizeUrl(parsed.url), anonKey: parsed.anonKey.trim() };
    }
  } catch { /* armazenamento indisponível */ }
  const url = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;
  if (url && anonKey) return { url: normalizeUrl(url), anonKey: anonKey.trim() };
  return null;
}

export function saveCloudConfig(config: CloudConfig | null) {
  try {
    if (config) localStorage.setItem(CONFIG_KEY, JSON.stringify({ url: normalizeUrl(config.url), anonKey: config.anonKey.trim() }));
    else localStorage.removeItem(CONFIG_KEY);
  } catch { /* armazenamento indisponível */ }
}

export function loadCloudSession(): CloudSession | null {
  try {
    const stored = localStorage.getItem(SESSION_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<CloudSession>;
    if (parsed.accessToken && parsed.refreshToken && parsed.expiresAt) {
      return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken, expiresAt: parsed.expiresAt, email: parsed.email ?? '' };
    }
  } catch { /* armazenamento indisponível */ }
  return null;
}

export function saveCloudSession(session: CloudSession | null) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* armazenamento indisponível */ }
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  user?: { email?: string };
}

function sessionFromTokens(tokens: TokenResponse, fallbackEmail = ''): CloudSession {
  const expiresAt = tokens.expires_at ?? Math.floor(Date.now() / 1000) + (tokens.expires_in ?? 3600);
  return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt, email: tokens.user?.email ?? fallbackEmail };
}

/**
 * Ao voltar do link mágico, o Supabase devolve os tokens no fragmento da URL
 * (#access_token=…&refresh_token=…). Lê, grava e limpa a URL.
 */
export function consumeSessionFromUrl(): CloudSession | null {
  const hash = window.location.hash;
  if (!hash.includes('access_token=')) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return null;
  const expiresIn = Number(params.get('expires_in') ?? 3600);
  const expiresAt = Number(params.get('expires_at')) || Math.floor(Date.now() / 1000) + expiresIn;
  const session: CloudSession = { accessToken, refreshToken, expiresAt, email: emailFromJwt(accessToken) };
  saveCloudSession(session);
  history.replaceState(null, '', window.location.pathname + window.location.search);
  return session;
}

function emailFromJwt(token: string) {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const parsed = JSON.parse(json) as { email?: string };
    return parsed.email ?? '';
  } catch {
    return '';
  }
}

export class CloudError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

async function readError(response: Response, fallback: string) {
  try {
    const body = await response.json() as { message?: string; msg?: string; error_description?: string; error?: string; details?: string; hint?: string };
    const message = body.message ?? body.msg ?? body.error_description ?? body.error ?? fallback;
    return new CloudError(translateMessage(message, response.status), response.status);
  } catch {
    return new CloudError(translateMessage(fallback, response.status), response.status);
  }
}

function translateMessage(message: string, status: number) {
  const lower = message.toLowerCase();
  if (status === 401 || lower.includes('jwt') || lower.includes('invalid token')) return 'Sessão expirada. Entre de novo com seu e-mail.';
  if (lower.includes('rate limit')) return 'Muitas tentativas em pouco tempo. Aguarde um minuto e tente de novo.';
  if (lower.includes('relation') && lower.includes('does not exist')) return 'A tabela mfv_projects ainda não existe no servidor. Rode o SQL do guia docs/NUVEM-SUPABASE.md.';
  if (lower.includes('row-level security')) return 'Permissão negada pelo servidor (RLS). Confira as políticas da tabela mfv_projects.';
  if (lower.includes('signups not allowed')) return 'Este e-mail não está autorizado. Peça ao administrador para criar o usuário no Supabase.';
  if (lower.includes('otp') && lower.includes('expired')) return 'O código expirou. Peça um novo link.';
  if (lower.includes('token has expired or is invalid')) return 'Código inválido ou expirado. Peça um novo link.';
  if (lower.includes('failed to fetch')) return 'Sem conexão com o servidor. Verifique a internet e a URL configurada.';
  return message;
}

export class CloudClient {
  private config: CloudConfig;
  private session: CloudSession | null;
  private onSession: (session: CloudSession | null) => void;

  constructor(config: CloudConfig, session: CloudSession | null, onSession: (session: CloudSession | null) => void) {
    this.config = config;
    this.session = session;
    this.onSession = onSession;
  }

  get email() {
    return this.session?.email ?? '';
  }

  get signedIn() {
    return this.session !== null;
  }

  private authHeaders(withUser = true): Record<string, string> {
    const headers: Record<string, string> = { apikey: this.config.anonKey, 'Content-Type': 'application/json' };
    if (withUser && this.session) headers.Authorization = `Bearer ${this.session.accessToken}`;
    return headers;
  }

  private setSession(session: CloudSession | null) {
    this.session = session;
    saveCloudSession(session);
    this.onSession(session);
  }

  /** Envia o link mágico (e código, se o modelo de e-mail incluir {{ .Token }}). */
  async requestMagicLink(email: string) {
    const redirectTo = window.location.origin + window.location.pathname;
    const response = await this.fetch(`${this.config.url}/auth/v1/otp`, {
      method: 'POST', headers: this.authHeaders(false),
      body: JSON.stringify({ email, create_user: true, options: { email_redirect_to: redirectTo } }),
    });
    if (!response.ok) throw await readError(response, 'Não foi possível enviar o e-mail.');
  }

  /** Entra com o código de 6 dígitos recebido por e-mail. */
  async verifyCode(email: string, code: string) {
    const response = await this.fetch(`${this.config.url}/auth/v1/verify`, {
      method: 'POST', headers: this.authHeaders(false),
      body: JSON.stringify({ type: 'email', email, token: code.trim() }),
    });
    if (!response.ok) throw await readError(response, 'Código inválido.');
    const tokens = await response.json() as TokenResponse;
    this.setSession(sessionFromTokens(tokens, email));
  }

  async signOut() {
    if (this.session) {
      try {
        await this.fetch(`${this.config.url}/auth/v1/logout`, { method: 'POST', headers: this.authHeaders() });
      } catch { /* a sessão local é descartada mesmo assim */ }
    }
    this.setSession(null);
  }

  private async ensureFreshSession() {
    if (!this.session) throw new CloudError('Entre com seu e-mail para usar os projetos na nuvem.', 401);
    const now = Math.floor(Date.now() / 1000);
    if (this.session.expiresAt - now > 60) return;
    const response = await this.fetch(`${this.config.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: this.authHeaders(false),
      body: JSON.stringify({ refresh_token: this.session.refreshToken }),
    });
    if (!response.ok) {
      this.setSession(null);
      throw new CloudError('Sessão expirada. Entre de novo com seu e-mail.', 401);
    }
    const tokens = await response.json() as TokenResponse;
    this.setSession(sessionFromTokens(tokens, this.session.email));
  }

  private async fetch(input: string, init: RequestInit) {
    try {
      return await fetch(input, init);
    } catch (error) {
      throw new CloudError(translateMessage(error instanceof Error ? error.message : 'Failed to fetch', 0));
    }
  }

  private async rest(path: string, init: RequestInit & { prefer?: string } = {}) {
    await this.ensureFreshSession();
    const headers = this.authHeaders();
    if (init.prefer) headers.Prefer = init.prefer;
    const response = await this.fetch(`${this.config.url}/rest/v1/${path}`, { ...init, headers });
    if (response.status === 401) {
      this.setSession(null);
      throw new CloudError('Sessão expirada. Entre de novo com seu e-mail.', 401);
    }
    if (!response.ok) throw await readError(response, 'O servidor recusou a operação.');
    return response;
  }

  /** Busca por nome ou cliente (sem distinguir maiúsculas); vazio lista os mais recentes. */
  async search(term: string, limit = 60): Promise<CloudProjectSummary[]> {
    const params = new URLSearchParams({ select: 'id,name,client,updated_at', order: 'updated_at.desc', limit: String(limit) });
    const cleaned = term.trim().replace(/[%*,()]/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned) params.set('or', `(name.ilike.*${cleaned}*,client.ilike.*${cleaned}*)`);
    const response = await this.rest(`${TABLE}?${params.toString()}`);
    const rows = await response.json() as { id: string; name: string; client: string | null; updated_at: string }[];
    return rows.map((row) => ({ id: row.id, name: row.name, client: row.client ?? '', updatedAt: row.updated_at }));
  }

  async load<T>(id: string): Promise<CloudProjectRecord<T>> {
    const params = new URLSearchParams({ select: 'id,name,client,updated_at,workspace', id: `eq.${id}` });
    const response = await this.rest(`${TABLE}?${params.toString()}`, { prefer: 'return=representation' });
    const rows = await response.json() as { id: string; name: string; client: string | null; updated_at: string; workspace: T }[];
    const row = rows[0];
    if (!row) throw new CloudError('Projeto não encontrado. Ele pode ter sido excluído.', 404);
    return { id: row.id, name: row.name, client: row.client ?? '', updatedAt: row.updated_at, workspace: row.workspace };
  }

  async create(name: string, client: string, workspace: unknown): Promise<CloudProjectSummary> {
    const response = await this.rest(TABLE, {
      method: 'POST', prefer: 'return=representation',
      body: JSON.stringify({ name: name.trim(), client: client.trim(), workspace }),
    });
    const [row] = await response.json() as { id: string; name: string; client: string | null; updated_at: string }[];
    return { id: row.id, name: row.name, client: row.client ?? '', updatedAt: row.updated_at };
  }

  async update(id: string, patch: { name?: string; client?: string; workspace?: unknown }): Promise<CloudProjectSummary> {
    const response = await this.rest(`${TABLE}?id=eq.${id}`, {
      method: 'PATCH', prefer: 'return=representation',
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    });
    const [row] = await response.json() as { id: string; name: string; client: string | null; updated_at: string }[];
    if (!row) throw new CloudError('Projeto não encontrado. Ele pode ter sido excluído em outro computador.', 404);
    return { id: row.id, name: row.name, client: row.client ?? '', updatedAt: row.updated_at };
  }

  async remove(id: string) {
    await this.rest(`${TABLE}?id=eq.${id}`, { method: 'DELETE' });
  }
}
