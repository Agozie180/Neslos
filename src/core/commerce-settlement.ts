import { z } from 'zod';
import { canonical } from './crypto.js';
import { NATIVE_USDC, fetchJson } from './research.js';
import { nearAccount } from './wire.js';
import { rpcUrls } from './near.js';
import { commerceRequestSchema, vaultCommerceCall, type CommerceRequest } from './vault-commerce.js';

const status = z.object({ SuccessValue: z.string() }).strict();
const receiptSuccess = z.union([status, z.object({ SuccessReceiptId: z.string() }).strict()]);
const outcomeSchema = z.object({
  final_execution_status: z.literal('FINAL'), status,
  transaction: z.object({ hash: z.string(), signer_id: nearAccount, receiver_id: nearAccount, actions: z.array(z.unknown()) }).passthrough(),
  receipts_outcome: z.array(z.object({ id: z.string(), outcome: z.object({ executor_id: nearAccount, status: z.unknown(), logs: z.array(z.string()) }).passthrough() }).passthrough()),
}).passthrough();

function stableRpc(value: unknown): unknown {
  if (typeof value === 'number') { if (!Number.isSafeInteger(value)) throw new Error('PAYMENT_UNSAFE_INTEGER'); return String(value); }
  if (Array.isArray(value)) return value.map(stableRpc);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stableRpc(v)]));
  return value;
}

/** A transaction hash must match its exact signed delegate and a successful token receipt. */
export function verifyAgentSettlement(outcome: unknown, expected: { hash: string; relayer: string; delegate: unknown; sender: string; payee: string; amount: string }) {
  const value = outcomeSchema.parse(outcome);
  if (value.transaction.hash !== expected.hash || value.transaction.signer_id !== expected.relayer) throw new Error('PAYMENT_TRANSACTION_BINDING');
  const matches = value.transaction.actions.filter(a => {
    const parsed = z.object({ Delegate: z.unknown() }).safeParse(a);
    return parsed.success && canonical(stableRpc(parsed.data.Delegate)) === canonical(stableRpc(expected.delegate));
  });
  if (matches.length !== 1) throw new Error('PAYMENT_DELEGATE_BINDING');
  const receipt = matchingTransfer(value.receipts_outcome, expected.sender, expected.payee, expected.amount);
  if (!receipt) throw new Error('PAYMENT_TRANSFER_NOT_PROVEN');
  return { settlementVerified: true as const, transactionHash: expected.hash, receiptId: receipt.id, token: NATIVE_USDC, sender: expected.sender, payee: expected.payee, amount: expected.amount, verifiedAt: new Date().toISOString() };
}

function matchingTransfer(receipts: z.infer<typeof outcomeSchema>['receipts_outcome'], sender: string, payee: string, amount: string, token = NATIVE_USDC) {
  return receipts.find(r => r.outcome.executor_id === token && receiptSuccess.safeParse(r.outcome.status).success && r.outcome.logs.some(log => {
    if (!log.startsWith('EVENT_JSON:')) return false;
    try {
      const event = z.object({ standard: z.literal('nep141'), event: z.literal('ft_transfer'), data: z.array(z.object({ old_owner_id: nearAccount, new_owner_id: nearAccount, amount: z.string() })) }).parse(JSON.parse(log.slice(11)));
      return event.data.some(d => d.old_owner_id === sender && d.new_owner_id === payee && d.amount === amount);
    } catch { return false; }
  }));
}

export function verifyLendingTransaction(outcome: unknown, expected: { hash: string; sender: string; call: { receiverId: string; methodName: string; args: unknown; gas: string; deposit: string }; operation: 'supply' | 'withdraw'; protocol: string; amount: string }) {
  const v = outcomeSchema.parse(outcome), c = expected.call;
  const action = { FunctionCall: { method_name: c.methodName, args: Buffer.from(JSON.stringify(c.args)).toString('base64'), gas: c.gas, deposit: c.deposit } };
  if (v.transaction.hash !== expected.hash || v.transaction.signer_id !== expected.sender || v.transaction.receiver_id !== c.receiverId || canonical(stableRpc(v.transaction.actions)) !== canonical([action])) throw new Error('LENDING_TRANSACTION_BINDING');
  if (expected.operation === 'supply') {
    // NEP-141 ft_resolve_transfer returns the amount USED, including any refund.
    let used: unknown;
    try { used = JSON.parse(Buffer.from(v.status.SuccessValue, 'base64').toString('utf8')); } catch { throw new Error('LENDING_USED_AMOUNT_UNKNOWN'); }
    if (used !== expected.amount) throw new Error('LENDING_SUPPLY_NOT_FULLY_ACCEPTED');
  } else if (!matchingTransfer(v.receipts_outcome, expected.protocol, expected.sender, expected.amount)) throw new Error('LENDING_WITHDRAWAL_NOT_PROVEN');
  return true;
}

/** Bind an owner->vault call to a successful vault callback and the fixed token's actual transfer. */
export function verifyVaultCommerceTransaction(outcome: unknown, expected: { hash: string; owner: string; vault: string; token: string; call: { receiverId: string; methodName: string; args: unknown; gas: string; deposit: string }; request: CommerceRequest }) {
  const v = outcomeSchema.parse(outcome), r = commerceRequestSchema.parse(expected.request), c = expected.call;
  if (r.vault !== expected.vault || canonical(c) !== canonical(vaultCommerceCall(r))) throw new Error('COMMERCE_RECEIPT_CALL_BINDING');
  const action = { FunctionCall: { method_name: c.methodName, args: Buffer.from(JSON.stringify(c.args)).toString('base64'), gas: c.gas, deposit: c.deposit } };
  if (v.transaction.hash !== expected.hash || v.transaction.signer_id !== expected.owner || v.transaction.receiver_id !== expected.vault || canonical(stableRpc(v.transaction.actions)) !== canonical([action])) throw new Error('COMMERCE_TRANSACTION_BINDING');
  let completed: unknown;
  try { completed = JSON.parse(Buffer.from(v.status.SuccessValue, 'base64').toString('utf8')); }
  catch { throw new Error('COMMERCE_DISPATCH_UNPROVEN'); }
  // A finalized, successful transaction can still have a false protocol callback.
  if (completed === false) return false;
  if (completed !== true) throw new Error('COMMERCE_DISPATCH_UNPROVEN');
  const sender = r.action === 2 ? r.target : expected.vault, payee = r.action === 2 ? expected.vault : r.target;
  if (!matchingTransfer(v.receipts_outcome, sender, payee, r.amount, expected.token)) throw new Error('COMMERCE_TRANSFER_NOT_PROVEN');
  return true;
}

export async function fetchPaymentTransaction(hash: string, relayer: string) {
  z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,64}$/).parse(hash); nearAccount.parse(relayer);
  const response = await fetchJson(rpcUrls.mainnet, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'neslos-payment-proof', method: 'EXPERIMENTAL_tx_status', params: { tx_hash: hash, sender_account_id: relayer, wait_until: 'FINAL' } }) }, 2_000_000);
  return z.object({ result: z.unknown() }).parse(response).result;
}
