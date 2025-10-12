// api/config.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

// NodeNext: keep .js on local type-only imports
import type {
  GetConfigResponse,
  NetworkConfig,
  ISODateString,
  WsUrl,
  HttpUrl,
} from '../types/api.js';

// ─────────────────────────────────────────────────────────────────────────────
// CORS (tiny, env-driven)
function setCors(req: VercelRequest, res: VercelResponse) {
  const allow =
    process.env.ALLOWED_ORIGINS ||
    process.env.CORS_ALLOWED_ORIGINS ||
    '*';

  const origin = (req.headers.origin as string) || '';
  const list = allow.split(',').map(s => s.trim()).filter(Boolean);

  const allowedOrigin = list.includes('*')
    ? (origin || '*')
    : (list.includes(origin) ? origin : (list[0] || '*'));

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400'); // cache preflight 24h
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
export default function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'HEAD') {
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=60');
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  // Release time (safe parse with fallback)
  const FALLBACK_ISO = '2025-11-30T17:00:00Z';
  const envRelease = process.env.Q_RELEASE_AT ?? FALLBACK_ISO;
  const parsed = new Date(envRelease);
  const releaseIso: ISODateString = (
    isNaN(parsed.getTime()) ? new Date(FALLBACK_ISO) : parsed
  ).toISOString() as ISODateString;

  // RPC is optional (no RPC yet is fine). Accept FAUCET_RPC_URL or RPC_WS.
  const rpcEnv = (process.env.FAUCET_RPC_URL || process.env.RPC_WS || '').trim();
  const rpcWS = (rpcEnv && /^wss?:\/\//i.test(rpcEnv) ? rpcEnv : '') as WsUrl;

  // Optional absolute links if PUBLIC_BASE_URL is set
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const abs = (p: string) => (base ? `${base}${p}` : p);

  const config: NetworkConfig = {
    chainName: 'Devnet-0',
    tokenSymbol: 'QTR',
    tokenDecimals: 12,
    ss58Prefix: 73,
    rpcWS, // '' when not configured; UI should handle gracefully
    releaseAt: releaseIso,
    explorer: {
      // If your HttpUrl type requires absolute URLs, set PUBLIC_BASE_URL.
      homepage: abs('/explorer/') as HttpUrl,
      account: abs('/explorer/account/{address}'),
      tx:      abs('/explorer/tx/{hash}'),
    },
    links: {
      wallet:   abs('/wallet/'),
      faucet:   abs('/faucet/'),
      status:   abs('/status/'),
      explorer: abs('/explorer/'),
    },
  };

  const payload: GetConfigResponse = { ok: true, data: config };

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // Cache for 5 minutes, allow SWR for 60s
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=60');
  return res.status(200).json(payload);
}
