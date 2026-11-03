import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Account, baseEncode, KeyPair, type Action, type KeyPairString } from 'near-api-js';
import { z } from 'zod';
import { nearProvider, retryNearRead, type NearNetwork } from '../core/near.js';
import { nearAccount } from '../core/wire.js';

export const json = (value: unknown) => JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n';
export async function writePrivateJson(path: string, value: unknown, exclusive = false) {
  await mkdir(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  const target = exclusive ? path : path + '.pending';
  const file = await open(target, exclusive ? 'wx' : 'w', 0o600);
  try { await file.writeFile(json(value)); await file.sync(); } finally { await file.close(); }
  if (!exclusive) await rename(target, path);
  if (process.platform !== 'win32') {
    const directory = await open(dirname(resolve(path)), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
}

export async function connectOwner(network: NearNetwork, credentialFile: string) {
  const credentials = z.object({ account_id: nearAccount, public_key: z.string(), private_key: z.string() }).parse(JSON.parse(await readFile(credentialFile, 'utf8')));
  const key = KeyPair.fromString(credentials.private_key as KeyPairString);
  if (key.getPublicKey().toString() !== credentials.public_key) throw new Error('OWNER_KEY_MISMATCH');
  const provider = nearProvider(network);
  if (await retryNearRead(() => provider.getNetworkId()) !== network) throw new Error('RPC_NETWORK_MISMATCH');
  const access = await retryNearRead(() => provider.viewAccessKey({ accountId: credentials.account_id, publicKey: key.getPublicKey(), finalityQuery: { finality: 'final' } }));
  if (access.permission !== 'FullAccess') throw new Error('Owner governance requires the owner full-access key.');
  return { account: new Account(credentials.account_id, provider, credentials.private_key as KeyPairString), provider, publicKey: key.getPublicKey(), network };
}

type TransactionAccount = Pick<Account, 'accountId' | 'createSignedTransaction' | 'provider'>;
export interface TransactionRecord {
  format: 'neslos-owner-transaction-v1'; network: NearNetwork; signer: string; receiver: string;
  fingerprint: string; hash: string; signedTransaction: string;
  state: 'prepared' | 'final'; outcome?: unknown;
}

export function transactionOutcome(response: unknown): { success: boolean; final: boolean } {
  const result = response as { final_execution_status?: string; status?: unknown };
  const status = result.status;
  return { final: result.final_execution_status === 'FINAL', success: !!status && typeof status === 'object' && 'SuccessValue' in status };
}

/** Persist the exact SDK-signed transaction before broadcasting. Re-entry only observes its hash. */
export async function submitOnce(account: TransactionAccount, network: NearNetwork, journalFile: string, receiver: string, actions: Action[]) {
  nearAccount.parse(receiver);
  const fingerprint = createHash('sha256').update(json({ network, signer: account.accountId, receiver, actions })).digest('hex');
  let existing: TransactionRecord | undefined;
  try { existing = JSON.parse(await readFile(journalFile, 'utf8')) as TransactionRecord; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (existing) {
    if (existing.format !== 'neslos-owner-transaction-v1' || existing.network !== network || existing.signer !== account.accountId || existing.receiver !== receiver || existing.fingerprint !== fingerprint) throw new Error('TRANSACTION_CONFLICT: this operation already has different signed inputs.');
    if (existing.state === 'final') return existing;
    try {
      const outcome = await retryNearRead(() => account.provider.viewTransactionStatus({ txHash: existing.hash, accountId: account.accountId, waitUntil: 'FINAL' }));
      if (!transactionOutcome(outcome).final) throw new Error('Not final.');
      const record: TransactionRecord = { ...existing, state: 'final', outcome };
      await writePrivateJson(journalFile, record);
      return record;
    } catch { throw new Error('TRANSACTION_UNKNOWN: retain the journal and reconcile ' + existing.hash + '; no replacement transaction was sent.'); }
  }
  // SDK preparation only reads the access-key nonce/block. It does not broadcast.
  const signed = await retryNearRead(() => account.createSignedTransaction({ receiverId: receiver, actions }));
  const hash = baseEncode(createHash('sha256').update(signed.transaction.encode()).digest());
  const record: TransactionRecord = { format: 'neslos-owner-transaction-v1', network, signer: account.accountId, receiver, fingerprint, hash, signedTransaction: Buffer.from(signed.encode()).toString('base64'), state: 'prepared' };
  // Exclusive creation also prevents two processes from broadcasting the same logical operation.
  await writePrivateJson(journalFile, record, true);
  let outcome: unknown;
  try { outcome = await account.provider.sendTransactionUntil(signed, 'FINAL'); }
  catch { throw new Error('TRANSACTION_UNKNOWN: reconcile ' + hash + ' from the saved journal before doing anything else.'); }
  if (!transactionOutcome(outcome).final) throw new Error('TRANSACTION_PENDING: observe ' + hash + '; do not recreate the payment.');
  const completed: TransactionRecord = { ...record, state: 'final', outcome };
  await writePrivateJson(journalFile, completed);
  return completed;
}
