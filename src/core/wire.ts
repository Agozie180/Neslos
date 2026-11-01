import type { KeyObject } from 'node:crypto';
import { z } from 'zod';
import { sha256, signHash } from './crypto.js';
import { units } from './amounts.js';

export const nearAccount = z.string().min(2).max(64).regex(/^(([a-z0-9]+[-_])*[a-z0-9]+\.)*([a-z0-9]+[-_])*[a-z0-9]+$/);
export const hashHex = z.string().regex(/^[a-f0-9]{64}$/);
const uint64 = z.string().regex(/^(0|[1-9][0-9]*)$/).refine(v => BigInt(v) <= 0xffffffffffffffffn);
const uint128 = z.string().refine(v => { try { units(v); return true; } catch { return false; } });
export const authorizationSchema = z.object({
  domain: z.literal('neslos:authorize:v1'), network: z.enum(['testnet', 'mainnet']), vault: nearAccount,
  policy_version: uint64, nonce: uint64, amount: uint128, quoted_output: uint128, minimum_output: uint128,
  slippage_bps: z.number().int().min(0).max(1000), quoted_at_ms: uint64, expires_at_ms: uint64,
  venue_commitment: hashHex, strategy_venue_commitment: hashHex.nullable(), counterparty_commitment: hashHex,
  deposit_account: nearAccount, output_asset: z.string().min(1).max(200), quote_hash: hashHex,
  confidential: z.boolean(), action: z.union([z.literal(0), z.literal(1)]), audit_hash: hashHex,
}).strict();
export type Authorization = z.infer<typeof authorizationSchema>;
export const chainPolicySchema = z.object({
  daily_limit: uint128, per_action_limit: uint128, max_slippage_bps: z.number().int().min(0).max(1000),
  max_quote_age_ms: uint64, venue_commitments: z.array(hashHex).min(1).max(32),
  counterparty_commitments: z.array(hashHex).min(1).max(32), output_assets: z.array(z.string().min(1).max(200)).min(1).max(16),
  require_confidential: z.boolean(), paused: z.boolean(),
}).strict();
export type ChainPolicy = z.infer<typeof chainPolicySchema>;
export const vaultConfigSchema = z.object({ owner_id: nearAccount, token_id: nearAccount, network: z.enum(['mainnet', 'testnet']), executor_public_key: hashHex, policy: chainPolicySchema, policy_version: uint64 }).strict();
export const chainBudgetSchema = z.object({ day: uint64, used: uint128, remaining: uint128, policy_version: uint64, next_nonce: uint64, paused: z.boolean() }).strict();

function integer(value: string | number, bytes: number): Buffer {
  let n = BigInt(value);
  if (n < 0n || n >= (1n << BigInt(bytes * 8))) throw new Error('Wire integer overflow.');
  const out = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i++) { out[i] = Number(n & 255n); n >>= 8n; }
  return out;
}
function string(value: string): Buffer { const b = Buffer.from(value, 'utf8'); return Buffer.concat([integer(b.length, 4), b]); }

/** Exact Borsh serialization of contracts/policy-vault/src/lib.rs::Authorization. */
export function authorizationBytes(input: Authorization): Buffer {
  const a = authorizationSchema.parse(input);
  return Buffer.concat([
    string(a.domain), string(a.network), string(a.vault), integer(a.policy_version, 8), integer(a.nonce, 8),
    integer(a.amount, 16), integer(a.quoted_output, 16), integer(a.minimum_output, 16), integer(a.slippage_bps, 2),
    integer(a.quoted_at_ms, 8), integer(a.expires_at_ms, 8), string(a.venue_commitment),
    a.strategy_venue_commitment === null ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), string(a.strategy_venue_commitment)]),
    string(a.counterparty_commitment), string(a.deposit_account), string(a.output_asset), string(a.quote_hash),
    Buffer.from([a.confidential ? 1 : 0, a.action]), string(a.audit_hash),
  ]);
}
export function signAuthorization(a: Authorization, key: KeyObject) { const hash = sha256(authorizationBytes(a)); return { authorization: a, signature: signHash(hash, key), hash }; }
export interface SettlementWire { domain: 'neslos:settlement:v1'; network: 'mainnet' | 'testnet'; vault: string; nonce: string; quote_hash: string; outcome: 0 | 1 | 2; audit_hash: string }
export function settlementBytes(s: SettlementWire): Buffer {
  nearAccount.parse(s.vault); uint64.parse(s.nonce); hashHex.parse(s.quote_hash); hashHex.parse(s.audit_hash);
  if (s.domain !== 'neslos:settlement:v1' || !['mainnet', 'testnet'].includes(s.network) || ![0, 1, 2].includes(s.outcome)) throw new Error('Invalid settlement.');
  return Buffer.concat([string(s.domain), string(s.network), string(s.vault), integer(s.nonce, 8), string(s.quote_hash), Buffer.from([s.outcome]), string(s.audit_hash)]);
}
