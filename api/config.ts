// api/config.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
// NodeNext: use relative path + .js extension for local TS modules
import type {
  GetConfigResponse,
  NetworkConfig,
  ISODateString,
  WsUrl,
  HttpUrl,
} from '../types/api.js';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  // Optional: override launch time from env
  const RELEASE_AT = process.env.Q_RELEASE_AT ?? '2025-11-30T17:00:00Z';

  const config: NetworkConfig = {
    chainName: 'Devnet-0',
    tokenSymbol: 'QTR',
    tokenDecimals: 12,
    ss58Prefix: 73,
    rpcWS: 'wss://rpc.devnet-0.quantara.xyz' as WsUrl,
    releaseAt: new Date(RELEASE_AT).toISOString() as ISODateString,
    explorer: {
      homepage: '/explorer/' as HttpUrl,            // if proxied/hosted under your domain
      account: '/explorer/account/{address}',
      tx: '/explorer/tx/{hash}',
    },
    links: {
      wallet: '/wallet/',
      faucet: '/faucet/',
      status: '/status/',
      explorer: '/explorer/',
    },
  };

  const payload: GetConfigResponse = { ok: true, data: config };

  // Cache a bit; this rarely changes
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.status(200).json(payload);
}
