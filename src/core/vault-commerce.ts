import { z } from 'zod';
import { units } from './amounts.js';
import { commitment, sha256 } from './crypto.js';
import { readVault } from './near.js';
import { hashHex, nearAccount } from './wire.js';
import { RHEA_CONTRACTS } from './lending.js';

const atomic = z.string().refine(v => { try { units(v); return true; } catch { return false; } });
const u64 = z.string().regex(/^(0|[1-9][0-9]*)$/).refine(v => BigInt(v) <= 0xffffffffffffffffn);
export const commerceRequestSchema = z.object({
  domain: z.literal('neslos:commerce:v1'), network: z.enum(['mainnet', 'testnet']), vault: nearAccount,
  policy_version: u64, nonce: u64, action: z.union([z.literal(0), z.literal(1), z.literal(2)]), amount: atomic,
  target: nearAccount, venue: z.string().min(1).max(100), venue_salt: hashHex, counterparty_salt: hashHex,
  quoted_at_ms: u64, expires_at_ms: u64, quote_hash: hashHex, audit_hash: hashHex,
}).strict();
export type CommerceRequest = z.infer<typeof commerceRequestSchema>;
export type CommerceVaultState = Awaited<ReturnType<typeof readVault>>;
export const COMMERCE_DEPOSIT = '10000000000000000000000'; // 0.01 NEAR record storage; principal is the vault's fixed token.
export const COMMERCE_GAS = '300000000000000';

/** Fixed entry point: no arbitrary token, method, arguments, collateral, debt or receiver payload. */
export function vaultCommerceCall(input: CommerceRequest) {
  const request = commerceRequestSchema.parse(input);
  if (units(request.amount) === 0n) throw new Error('COMMERCE_ZERO_AMOUNT');
  if (request.target === request.vault) throw new Error('COMMERCE_SELF_PAYMENT');
  if (request.action !== 0 && (request.venue !== 'rhea' || request.target !== RHEA_CONTRACTS[request.network])) throw new Error('COMMERCE_RHEA_BINDING');
  return { receiverId: request.vault, methodName: 'execute_commerce_v1', args: { request }, gas: COMMERCE_GAS, deposit: COMMERCE_DEPOSIT };
}

/** Informative preflight. The contract repeats these limits atomically at execution. */
export function assertCommerceState(request: CommerceRequest, state: CommerceVaultState, owner: string, token: string, now = Date.now()) {
  vaultCommerceCall(request);
  const p = state.config.policy;
  if (state.config.network !== request.network || state.config.owner_id !== owner || state.config.token_id !== token) throw new Error('COMMERCE_VAULT_BINDING');
  if (p.require_confidential) throw new Error('COMMERCE_PRIVATE_POLICY');
  if (p.paused || state.budget.paused) throw new Error('COMMERCE_VAULT_PAUSED');
  if (state.config.policy_version !== request.policy_version || state.budget.policy_version !== request.policy_version || state.budget.next_nonce !== request.nonce) throw new Error('COMMERCE_STATE_CHANGED');
  if (!p.venue_commitments.includes(commitment('venue', request.venue, request.venue_salt)) || !p.counterparty_commitments.includes(commitment('counterparty', request.target, request.counterparty_salt))) throw new Error('COMMERCE_ALLOWLIST_BINDING');
  if (!p.output_assets.includes('nep141:' + token)) throw new Error('COMMERCE_OUTPUT_ASSET');
  const amount = units(request.amount);
  if (amount > units(p.per_action_limit) || amount > units(state.budget.remaining)) throw new Error('COMMERCE_CHAIN_BUDGET_EXHAUSTED');
  if (request.action !== 2 && amount > units(state.balance)) throw new Error('COMMERCE_VAULT_BALANCE');
  const quoted = BigInt(request.quoted_at_ms), expiry = BigInt(request.expires_at_ms), time = BigInt(now);
  if (quoted > time || time - quoted > BigInt(p.max_quote_age_ms) || expiry <= time || expiry <= quoted || expiry - quoted > 300_000n) throw new Error('COMMERCE_PLAN_STALE');
}

/** Exact Borsh encoding of CommerceRequestV1; binds get_record.authorization_hash to this request. */
export function commerceRequestBytes(input: CommerceRequest): Buffer {
  const r = commerceRequestSchema.parse(input);
  const integer = (v: string | number, bytes: number) => {
    let n = BigInt(v); if (n < 0n || n >= 1n << BigInt(bytes * 8)) throw new Error('COMMERCE_WIRE_OVERFLOW');
    const b = Buffer.alloc(bytes); for (let i = 0; i < bytes; i++) { b[i] = Number(n & 255n); n >>= 8n; } return b;
  };
  const string = (v: string) => { const b = Buffer.from(v, 'utf8'); return Buffer.concat([integer(b.length, 4), b]); };
  return Buffer.concat([string(r.domain), string(r.network), string(r.vault), integer(r.policy_version, 8), integer(r.nonce, 8), integer(r.action, 1), integer(r.amount, 16), string(r.target), string(r.venue), string(r.venue_salt), string(r.counterparty_salt), integer(r.quoted_at_ms, 8), integer(r.expires_at_ms, 8), string(r.quote_hash), string(r.audit_hash)]);
}
export function commerceRequestHash(request: CommerceRequest) { return sha256(commerceRequestBytes(request)); }
