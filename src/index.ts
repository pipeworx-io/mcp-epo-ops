interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * EPO Open Patent Services MCP
 *
 * Auth: OAuth2 client_credentials. _apiKey = "<consumer_key>:<consumer_secret>".
 * Bearer token cached per consumer_key (20-min TTL).
 *
 * API docs: https://developers.epo.org/
 * Base: https://ops.epo.org/3.2/rest-services/
 *
 * Free tier: 4 GB/week download quota; rate-limited to 10 req/min.
 */


const TOKEN_URL = 'https://ops.epo.org/3.2/auth/accesstoken';
const API_URL = 'https://ops.epo.org/3.2/rest-services';

const tools: McpToolExport['tools'] = [
  {
    name: 'search_patents',
    description:
      'Search published patents using CQL (EPO Common Query Language). Returns a paginated list of publication numbers matching the query. Example queries: "ta=hydrogen", "in=Tesla", "pa=apple", "txt=neural network AND pd>=2020".',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'EPO CQL — fields: ta (title-abstract), ti (title), ab (abstract), txt (any text), in (inventor), pa (applicant), cl (classification), pn (publication number), ap (application number), pr (priority), pd (publication date), ad (application date).',
        },
        range: {
          type: 'string',
          description: 'Result range "start-end" (1-indexed). Max 100 per page. Default "1-25".',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_biblio',
    description: 'Bibliographic data for a patent — title, inventors, applicants, dates, classifications.',
    inputSchema: {
      type: 'object',
      properties: {
        number: { type: 'string', description: 'Patent number in epodoc format, e.g. "EP1234567"' },
      },
      required: ['number'],
    },
  },
  {
    name: 'get_family',
    description: 'INPADOC family — related patent applications worldwide for the same underlying invention.',
    inputSchema: {
      type: 'object',
      properties: {
        number: { type: 'string', description: 'Patent number, epodoc format' },
      },
      required: ['number'],
    },
  },
  {
    name: 'get_abstract',
    description: 'Abstract text for a patent.',
    inputSchema: {
      type: 'object',
      properties: {
        number: { type: 'string', description: 'Patent number, epodoc format' },
      },
      required: ['number'],
    },
  },
  {
    name: 'get_claims',
    description: 'Claims text for a patent.',
    inputSchema: {
      type: 'object',
      properties: {
        number: { type: 'string', description: 'Patent number, epodoc format' },
      },
      required: ['number'],
    },
  },
];

interface CachedToken {
  access_token: string;
  expires_at: number;
}
const TOKEN_CACHE = new Map<string, CachedToken>();
const TOKEN_TTL_MS = 18 * 60 * 1000; // refresh slightly before EPO's 20-min lifetime

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const apiKey = (args._apiKey as string | undefined)?.trim();
  if (!apiKey) {
    throw new Error(
      'EPO OPS requires OAuth credentials. Pass ?_apiKey=<consumer_key>:<consumer_secret>. Register at https://developers.epo.org/.',
    );
  }
  const colon = apiKey.indexOf(':');
  if (colon < 1 || colon === apiKey.length - 1) {
    throw new Error('EPO _apiKey must be "consumer_key:consumer_secret".');
  }
  const k = apiKey.slice(0, colon);
  const s = apiKey.slice(colon + 1);
  const token = await getAccessToken(k, s);

  switch (name) {
    case 'search_patents':
      return searchPatents(token, args);
    case 'get_biblio':
      return epoGet(token, `/published-data/publication/epodoc/${encodeURIComponent(reqStr(args, 'number', '"EP1234567"'))}/biblio`);
    case 'get_family':
      return epoGet(token, `/family/publication/epodoc/${encodeURIComponent(reqStr(args, 'number', '"EP1234567"'))}`);
    case 'get_abstract':
      return epoGet(token, `/published-data/publication/epodoc/${encodeURIComponent(reqStr(args, 'number', '"EP1234567"'))}/abstract`);
    case 'get_claims':
      return epoGet(token, `/published-data/publication/epodoc/${encodeURIComponent(reqStr(args, 'number', '"EP1234567"'))}/claims`);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function getAccessToken(key: string, secret: string): Promise<string> {
  const cached = TOKEN_CACHE.get(key);
  if (cached && cached.expires_at > Date.now()) return cached.access_token;
  const basic = btoa(`${key}:${secret}`);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`EPO OAuth: ${res.status} ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: string | number };
  if (!data.access_token) throw new Error('EPO OAuth: response missing access_token');
  const ttl = (Number(data.expires_in) || 1200) * 1000;
  TOKEN_CACHE.set(key, {
    access_token: data.access_token,
    expires_at: Date.now() + Math.min(ttl, TOKEN_TTL_MS),
  });
  return data.access_token;
}

async function epoGet<T = unknown>(token: string, path: string, params?: URLSearchParams): Promise<T> {
  const url = `${API_URL}${path}${params?.toString() ? `?${params}` : ''}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (res.status === 404) throw new Error(`EPO: not found (${path})`);
  if (res.status === 401 || res.status === 403) throw new Error('EPO: unauthorized — check credentials');
  if (res.status === 429) throw new Error('EPO: rate-limit (HTTP 429)');
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`EPO error: ${res.status} ${t.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function searchPatents(token: string, args: Record<string, unknown>) {
  const params = new URLSearchParams({ q: String(args.query) });
  const range = (args.range as string) ?? '1-25';
  const url = `${API_URL}/published-data/search?${params}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-OPS-Range': range },
  });
  if (res.status === 404) throw new Error('EPO: no matches');
  if (res.status === 401 || res.status === 403) throw new Error('EPO: unauthorized');
  if (res.status === 429) throw new Error('EPO: rate-limit');
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`EPO error: ${res.status} ${t.slice(0, 200)}`);
  }
  return res.json();
}

function reqStr(args: Record<string, unknown>, key: string, example: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`Required argument "${key}" is missing. Pass a string like ${example}.`);
  }
  return v;
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
