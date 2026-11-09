import { z } from 'zod';
import { canonical, sha256 } from '../core/crypto.js';
import { hashHex, nearAccount } from '../core/wire.js';
import { confidentialImplicitId } from './confidential-auth.js';
import { validateConfidentialQuote, type ConfidentialProofQuote } from './confidential-quote.js';

// Production FAR constants documented at:
// https://docs.near-intents.org/integration/market-makers/confidential-intents.md
// Authentication uses intents.near and its live salt; this spending payload uses FAR.
const CONTRACT = 'intents.far';
const SALT = Buffer.from('e110f317', 'hex');
const ASSET = 'imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:nep141:wrap.near';
const AMOUNT = '1000000000000000000000'; // This owner's fixed 0.001 wNEAR proof only.
const MAGIC = Buffer.from([0x56, 0x28, 0xf6, 0xc6]);

export type ConfidentialWithdrawalContext = {
  ownerAccount: string;
  confidentialId: string;
  publicKey: string;
  amount: string;
  maxLossBps: number;
};

const contextSchema = z.object({
  ownerAccount: nearAccount, confidentialId: hashHex, publicKey: z.string().min(1).max(100),
  amount: z.literal(AMOUNT), maxLossBps: z.number().int().min(0).max(1000),
}).strict();
const generatedSchema = z.object({
  intent: z.object({ standard: z.literal('raw_ed25519'), payload: z.string().min(1).max(4096) }).strict(),
  correlationId: z.string().min(1).max(200),
}).strict();
const payloadSchema = z.object({
  verifying_contract: z.literal(CONTRACT), signer_id: hashHex,
  deadline: z.iso.datetime().max(24), nonce: z.string().length(44),
  intents: z.tuple([z.object({
    intent: z.literal('transfer'), receiver_id: nearAccount,
    tokens: z.object({ [ASSET]: z.literal(AMOUNT) }).strict(),
  }).strict()]),
}).strict();

export type ConfidentialWithdrawalIntent = Readonly<{
  format: 'neslos-confidential-owner-withdrawal-intent-v1';
  intent: Readonly<{ standard: 'raw_ed25519'; payload: string }>;
  payloadHash: string;
  quoteHash: string;
  /** Local cutoff for any later signing/submission, not the signature's on-chain expiration. */
  signingDeadline: string;
  /** The generated payload may remain executable for three days after the local cutoff. */
  signatureValidUntil: string;
}>;

/**
 * Validates an unsigned owner recovery proof only; does not authorize, sign or submit it.
 * Context must be local owner input, never the provider's echoed request.
 * Generated raw_ed25519 payload bytes are retained exactly, as required by:
 * https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/signed-intent-execution.md
 */
export function validateConfidentialWithdrawalIntent(
  generated: unknown,
  quote: ConfidentialProofQuote,
  input: ConfidentialWithdrawalContext,
  now = Date.now(),
): ConfidentialWithdrawalIntent {
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('CONFIDENTIAL_INTENT_TIME');
  const approved = contextSchema.safeParse(input);
  if (!approved.success) throw new Error('CONFIDENTIAL_INTENT_CONTEXT');
  try {
    if (confidentialImplicitId(approved.data.publicKey) !== approved.data.confidentialId) throw new Error();
  } catch { throw new Error('CONFIDENTIAL_INTENT_IDENTITY'); }

  // Re-check the provider signature and every route field. A serialized type or a
  // signatureVerified flag is not proof; neither is a modified execution summary.
  let checked: ConfidentialProofQuote;
  try {
    const { ownerAccount, confidentialId, amount, maxLossBps } = approved.data;
    checked = validateConfidentialQuote(quote.response, quote.request, {
      direction: 'unshield', ownerAccount, confidentialId, amount, maxLossBps, dry: false,
    }, now);
    if (canonical(checked) !== canonical(quote)) throw new Error();
  } catch { throw new Error('CONFIDENTIAL_INTENT_QUOTE'); }
  if (checked.dry || !checked.execution) throw new Error('CONFIDENTIAL_INTENT_QUOTE');

  const envelope = generatedSchema.safeParse(generated);
  if (!envelope.success) throw new Error('CONFIDENTIAL_INTENT_RESPONSE');
  const payload = envelope.data.intent.payload;
  let parsed: z.infer<typeof payloadSchema>;
  try {
    if (Buffer.byteLength(payload, 'utf8') > 4096) throw new Error();
    const decoded: unknown = JSON.parse(payload);
    // The observed API emits compact JSON. Refuse duplicate keys, hidden fields,
    // alternate escapes and other ambiguous encodings without rewriting the bytes.
    if (JSON.stringify(decoded) !== payload) throw new Error();
    parsed = payloadSchema.parse(decoded);
  } catch { throw new Error('CONFIDENTIAL_INTENT_PAYLOAD'); }
  if (parsed.signer_id !== approved.data.confidentialId) throw new Error('CONFIDENTIAL_INTENT_IDENTITY');
  if (parsed.intents[0].receiver_id !== checked.execution.depositAddress) throw new Error('CONFIDENTIAL_INTENT_DEPOSIT');

  const deadline = Date.parse(parsed.deadline);
  if (!Number.isFinite(deadline) || new Date(deadline).toISOString() !== parsed.deadline
    || parsed.deadline !== checked.execution.depositAddressExpiresAt
    || deadline <= now || Date.parse(checked.execution.deadline) <= now) throw new Error('CONFIDENTIAL_INTENT_DEADLINE');

  // SDK VersionedNonceBuilder v0: magic(4), version(1), salt(4), deadlineNs(8 LE),
  // opaque entropy(15). The authentication timestamp overlay is not required here.
  // https://github.com/defuse-protocol/sdk-monorepo/blob/main/packages/intents-sdk/src/intents/expirable-nonce.ts
  const nonce = Buffer.from(parsed.nonce, 'base64');
  if (nonce.length !== 32 || nonce.toString('base64') !== parsed.nonce
    || !nonce.subarray(0, 4).equals(MAGIC) || nonce[4] !== 0
    || !nonce.subarray(5, 9).equals(SALT)
    || nonce.readBigUInt64LE(9) !== BigInt(deadline) * 1_000_000n) throw new Error('CONFIDENTIAL_INTENT_NONCE');

  return Object.freeze({
    format: 'neslos-confidential-owner-withdrawal-intent-v1' as const,
    intent: Object.freeze({ standard: 'raw_ed25519' as const, payload }),
    payloadHash: sha256(payload), quoteHash: checked.hash,
    signingDeadline: checked.execution.deadline, signatureValidUntil: parsed.deadline,
  });
}
