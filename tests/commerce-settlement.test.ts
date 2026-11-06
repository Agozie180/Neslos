import { describe, expect, it } from 'vitest';
import { verifyAgentSettlement, verifyLendingTransaction, verifyVaultCommerceTransaction } from '../src/core/commerce-settlement.js';
import { NATIVE_USDC } from '../src/core/research.js';
import { vaultCommerceCall, type CommerceRequest } from '../src/core/vault-commerce.js';

const delegate = { delegate_action: { sender_id: 'owner.near', receiver_id: NATIVE_USDC, nonce: '123', max_block_height: '456', actions: [{ FunctionCall: { method_name: 'ft_transfer', args: Buffer.from(JSON.stringify({ receiver_id: 'market.near', amount: '100000' })).toString('base64'), gas: '30000000000000', deposit: '1' } }], public_key: 'ed25519:fixture' }, signature: 'ed25519:fixture-signature' };
const expected = { hash: 'fixture-hash', relayer: 'relayer.near', delegate, sender: 'owner.near', payee: 'market.near', amount: '100000' };
function outcome() {
  return { final_execution_status: 'FINAL', status: { SuccessValue: '' }, transaction: { hash: expected.hash, signer_id: expected.relayer, receiver_id: 'owner.near', actions: [{ Delegate: structuredClone(delegate) }] }, receipts_outcome: [{ id: 'receipt', outcome: { executor_id: NATIVE_USDC, status: { SuccessValue: '' }, logs: ['EVENT_JSON:' + JSON.stringify({ standard: 'nep141', version: '1.0.0', event: 'ft_transfer', data: [{ old_owner_id: expected.sender, new_owner_id: expected.payee, amount: expected.amount }] })] } }] };
}
describe('external agent payment settlement', () => {
  it('matches the signed delegate and a successful token transfer in the finalized transaction', () => {
    expect(verifyAgentSettlement(outcome(), expected)).toMatchObject({ settlementVerified: true, transactionHash: expected.hash, receiptId: 'receipt', amount: '100000' });
  });
  it('rejects a provider status, pending transaction or failed transfer receipt', () => {
    expect(() => verifyAgentSettlement({ delivered: true }, expected)).toThrow();
    expect(() => verifyAgentSettlement({ ...outcome(), final_execution_status: 'EXECUTED' }, expected)).toThrow();
    const v = outcome(); v.receipts_outcome[0]!.outcome.status = { Failure: {} } as never;
    expect(() => verifyAgentSettlement(v, expected)).toThrow('PAYMENT_TRANSFER_NOT_PROVEN');
  });
  it('rejects a substituted transaction, delegate, recipient, amount or token contract', () => {
    expect(() => verifyAgentSettlement(outcome(), { ...expected, hash: 'other-hash' })).toThrow('PAYMENT_TRANSACTION_BINDING');
    const v = outcome(); v.transaction.actions[0]!.Delegate.delegate_action.nonce = '999';
    expect(() => verifyAgentSettlement(v, expected)).toThrow('PAYMENT_DELEGATE_BINDING');
    for (const change of [{ payee: 'attacker.near' }, { amount: '999999' }]) expect(() => verifyAgentSettlement(outcome(), { ...expected, ...change })).toThrow('PAYMENT_TRANSFER_NOT_PROVEN');
    const fake = outcome(); fake.receipts_outcome[0]!.outcome.executor_id = 'fake-token.near';
    expect(() => verifyAgentSettlement(fake, expected)).toThrow('PAYMENT_TRANSFER_NOT_PROVEN');
  });
});

describe('lending transaction verification', () => {
  const call = { receiverId: NATIVE_USDC, methodName: 'ft_transfer_call', args: { receiver_id: 'contract.main.burrow.near', amount: '100000', msg: '' }, gas: '180000000000000', deposit: '1' };
  const e = { hash: expected.hash, sender: expected.sender, call, operation: 'supply' as const, protocol: 'contract.main.burrow.near', amount: '100000' };
  const tx = () => ({ ...outcome(), status: { SuccessValue: Buffer.from(JSON.stringify('100000')).toString('base64') }, transaction: { hash: e.hash, signer_id: e.sender, receiver_id: call.receiverId, actions: [{ FunctionCall: { method_name: call.methodName, args: Buffer.from(JSON.stringify(call.args)).toString('base64'), gas: Number(call.gas), deposit: call.deposit } }] } });
  it('requires the exact signed call and full amount accepted by the resolver', () => {
    expect(verifyLendingTransaction(tx(), e)).toBe(true);
    expect(() => verifyLendingTransaction({ ...tx(), status: { SuccessValue: Buffer.from(JSON.stringify('0')).toString('base64') } }, e)).toThrow('LENDING_SUPPLY_NOT_FULLY_ACCEPTED');
    expect(() => verifyLendingTransaction(tx(), { ...e, call: { ...call, args: { ...call.args, amount: '200000' } } })).toThrow('LENDING_TRANSACTION_BINDING');
  });
});

describe('vault commerce receipt verification', () => {
  const request: CommerceRequest = { domain: 'neslos:commerce:v1', network: 'testnet', vault: 'vault.testnet', policy_version: '3', nonce: '7', action: 0, amount: '100', target: 'merchant.testnet', venue: 'merchant', venue_salt: 'a'.repeat(64), counterparty_salt: 'b'.repeat(64), quoted_at_ms: '1000', expires_at_ms: '61000', quote_hash: 'c'.repeat(64), audit_hash: 'd'.repeat(64) };
  function fixture(r = request) {
    const call = vaultCommerceCall(r), expected = { hash: 'vault-payment-hash', owner: 'owner.testnet', vault: r.vault, token: 'token.testnet', call, request: r };
    const tx = { final_execution_status: 'FINAL', status: { SuccessValue: Buffer.from('true').toString('base64') },
      transaction: { hash: expected.hash, signer_id: expected.owner, receiver_id: r.vault, actions: [{ FunctionCall: { method_name: call.methodName, args: Buffer.from(JSON.stringify(call.args)).toString('base64'), gas: Number(call.gas), deposit: call.deposit } }] },
      receipts_outcome: [{ id: 'token-receipt', outcome: { executor_id: expected.token, status: { SuccessValue: '' } as Record<string, unknown>, logs: ['EVENT_JSON:' + JSON.stringify({ standard: 'nep141', version: '1.0.0', event: 'ft_transfer', data: [{ old_owner_id: r.action === 2 ? r.target : r.vault, new_owner_id: r.action === 2 ? r.vault : r.target, amount: r.amount }] })] } }] };
    return { tx, expected };
  }
  it('requires the exact owner->vault transaction and fixed-token vault->payee transfer', () => {
    const { tx, expected } = fixture();
    expect(verifyVaultCommerceTransaction(tx, expected)).toBe(true);
    expect(() => verifyVaultCommerceTransaction(tx, { ...expected, owner: 'other.testnet' })).toThrow('COMMERCE_TRANSACTION_BINDING');
    expect(() => verifyVaultCommerceTransaction(tx, { ...expected, token: 'fake.testnet' })).toThrow('COMMERCE_TRANSFER_NOT_PROVEN');
    const directOwner = structuredClone(tx); directOwner.receipts_outcome[0]!.outcome.logs[0] = directOwner.receipts_outcome[0]!.outcome.logs[0]!.replace('vault.testnet', 'owner.testnet');
    expect(() => verifyVaultCommerceTransaction(directOwner, expected)).toThrow('COMMERCE_TRANSFER_NOT_PROVEN');
  });
  it('does not confuse final transaction success with callback payment success', () => {
    const { tx, expected } = fixture();
    tx.status.SuccessValue = Buffer.from('false').toString('base64');
    expect(verifyVaultCommerceTransaction(tx, expected)).toBe(false);
    tx.status.SuccessValue = Buffer.from('"100"').toString('base64');
    expect(() => verifyVaultCommerceTransaction(tx, expected)).toThrow('COMMERCE_DISPATCH_UNPROVEN');
  });
  it('accepts an actual transfer_call receipt that returns its resolver promise, with a fully accepted callback', () => {
    const { tx, expected } = fixture({ ...request, action: 1, venue: 'rhea', target: 'contract.1689937928.burrow.testnet' });
    tx.receipts_outcome[0]!.outcome.status = { SuccessReceiptId: 'resolver-receipt' };
    expect(verifyVaultCommerceTransaction(tx, expected)).toBe(true);
    tx.receipts_outcome[0]!.outcome.status = { SuccessReceiptId: 'resolver-receipt', Failure: {} };
    expect(() => verifyVaultCommerceTransaction(tx, expected)).toThrow('COMMERCE_TRANSFER_NOT_PROVEN');
  });
  it('requires withdrawal tokens to return from Rhea to the vault', () => {
    const { tx, expected } = fixture({ ...request, action: 2, venue: 'rhea', target: 'contract.1689937928.burrow.testnet' });
    expect(verifyVaultCommerceTransaction(tx, expected)).toBe(true);
    tx.receipts_outcome[0]!.outcome.logs[0] = tx.receipts_outcome[0]!.outcome.logs[0]!.replace('vault.testnet', 'owner.testnet');
    expect(() => verifyVaultCommerceTransaction(tx, expected)).toThrow('COMMERCE_TRANSFER_NOT_PROVEN');
  });
});
