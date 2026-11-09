import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QuoteRequest, type QuoteResponse } from '@defuse-protocol/one-click-sdk-typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { confidentialImplicitId } from '../src/owner/confidential-auth.js';
import { confidentialPreflightFailure, runConfidentialPreflight, type ConfidentialPreflightOptions } from '../src/owner/confidential-preflight.js';
import { runConfidentialPreflightCli } from '../scripts/confidential.js';
import { quotePublicKey, signFixture } from './fixtures/quote.js';

vi.mock('@defuse-protocol/one-click-sdk-typescript', async original => {
  const sdk = await original<typeof import('@defuse-protocol/one-click-sdk-typescript')>();
  // Exercise real SDK Ed25519 verification, with the repository's public TEST key.
  return { ...sdk, verifyQuoteSignature: (response: QuoteResponse) => sdk.verifyQuoteSignature(response, quotePublicKey) };
});

const NOW = Date.parse('2026-11-06T18:00:00.000Z');
const AMOUNT = '1000000000000000000000';
const ASSET = 'imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:nep141:wrap.near';
const PARTNER = 'fixture-sensitive-partner-jwt';
const PUBLIC_KEY = 'ed25519:8rVvtHWFr8hasdQGGD5WiQBTyr4iH2ruEPPVfj491RPN';
const OWNER = 'fixture-owner.near';
const ID = confidentialImplicitId(PUBLIC_KEY);
const DEPOSIT = '22'.repeat(32);
const API = 'https://1click.chaindefuser.com/v0';
const output = async () => join(await mkdtemp(join(tmpdir(), 'neslos-confidential-preflight-')), 'evidence.json');
const options = (out: string, mode: 'dry' | 'live' = 'dry'): ConfidentialPreflightOptions => ({ ownerAccount: OWNER, publicKey: PUBLIC_KEY, mode, out });

function quote(request: QuoteRequest): QuoteResponse {
  return signFixture({
    correlationId: 'fixture-private-correlation', timestamp: new Date(NOW).toISOString(), signature: '', quoteRequest: request,
    quote: {
      amountIn: AMOUNT, minAmountIn: AMOUNT, amountOut: AMOUNT, minAmountOut: AMOUNT,
      amountInFormatted: '0.001', amountOutFormatted: '0.001', amountInUsd: '0.001', amountOutUsd: '0.001', timeEstimate: 10,
      ...(!request.dry ? { refundFee: '0', withdrawFee: '0', depositAddress: DEPOSIT,
        deadline: new Date(Date.parse(request.deadline) + 3 * 86400000).toISOString() } : {}),
    },
  });
}

function generated(deadline: string) {
  const nonce = Buffer.from('5628f6c600e110f317' + '00'.repeat(8) + 'ff'.repeat(15), 'hex');
  nonce.writeBigUInt64LE(BigInt(Date.parse(deadline)) * 1_000_000n, 9);
  return { correlationId: 'fixture-private-intent-correlation', intent: { standard: 'raw_ed25519', payload: JSON.stringify({
    verifying_contract: 'intents.far', signer_id: ID, deadline, nonce: nonce.toString('base64'),
    intents: [{ intent: 'transfer', receiver_id: DEPOSIT, tokens: { [ASSET]: AMOUNT } }],
  }) } };
}

function provider(status = 200, change?: (body: Record<string, any>, url: string) => Record<string, any>) {
  let deadline = '';
  return vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    const endpoint = String(url), request = JSON.parse(String(init?.body));
    let body: Record<string, any>;
    if (endpoint === API + '/quote') {
      body = quote(request);
      deadline = body.quote.deadline;
    } else if (endpoint === API + '/generate-intent') body = generated(deadline);
    else throw new Error('Unexpected non-proof network endpoint');
    return Response.json(change ? change(body, endpoint) : body, { status });
  });
}

beforeEach(() => { vi.stubEnv('ONECLICK_JWT', PARTNER); vi.spyOn(Date, 'now').mockReturnValue(NOW); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('read-only confidential owner preflight', () => {
  it.each([200, 201])('keeps HTTP %i dry quotes private and puts partner authentication only in its header', async status => {
    const out = await output(), fetchImpl = provider(status);
    const summary = await runConfidentialPreflight(options(out), fetchImpl);
    expect(summary).toEqual({ mode: 'dry', quoteAsset: 'wNEAR', quoteAmount: '0.001', maxLossBps: 0,
      shieldQuoteValidated: true, unshieldQuoteValidated: true, unsignedRecoveryIntentValidated: false, savedPrivately: true, signatures: 0, transactions: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchImpl.mock.calls) {
      expect(url).toBe(API + '/quote');
      expect(init).toMatchObject({ method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', accept: 'application/json', 'X-API-Key': PARTNER } });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(Object.keys(init?.headers ?? {}).sort()).toEqual(['X-API-Key', 'accept', 'content-type']);
      expect(String(init?.body)).not.toContain(PARTNER);
      expect(JSON.parse(String(init?.body))).toMatchObject({ dry: true, amount: AMOUNT, originAsset: 'nep141:wrap.near', destinationAsset: 'nep141:wrap.near', slippageTolerance: 0 });
    }
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body))).toMatchObject({ recipient: ID, refundTo: OWNER, depositType: 'ORIGIN_CHAIN', recipientType: 'CONFIDENTIAL_INTENTS' });
    expect(JSON.parse(String(fetchImpl.mock.calls[1]![1]?.body))).toMatchObject({ recipient: OWNER, refundTo: ID, depositType: 'CONFIDENTIAL_INTENTS', recipientType: 'DESTINATION_CHAIN' });
    const savedText = await readFile(out, 'utf8'), saved = JSON.parse(savedText);
    expect(saved.state).toBe('validated'); expect(saved.exchanges).toHaveLength(2);
    expect(saved.exchanges[0].quote.fees).toEqual({ evidence: 'https-estimate', refundFee: null, withdrawFee: null });
    expect(JSON.parse(Buffer.from(saved.exchanges[0].response.bodyBase64, 'base64').toString('utf8'))).toEqual(saved.exchanges[0].response.body);
    expect(savedText).not.toContain(PARTNER);
    for (const sensitive of [OWNER, ID, PUBLIC_KEY, DEPOSIT, PARTNER, 'fixture-private-correlation']) expect(JSON.stringify(summary)).not.toContain(sensitive);
    if (process.platform !== 'win32') expect((await stat(out)).mode & 0o777).toBe(0o600);
  });

  it.each([200, 201])('validates the exact unsigned recovery payload on HTTP %i with only three proof calls', async status => {
    const out = await output(), fetchImpl = provider(status);
    expect(await runConfidentialPreflight(options(out, 'live'), fetchImpl)).toMatchObject({ mode: 'live', unsignedRecoveryIntentValidated: true, signatures: 0, transactions: 0 });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([API + '/quote', API + '/quote', API + '/generate-intent']);
    const generateRequest = JSON.parse(String(fetchImpl.mock.calls[2]![1]?.body));
    expect(generateRequest).toEqual({ type: 'swap_transfer', standard: 'raw_ed25519', signerId: ID, depositAddress: DEPOSIT });
    const saved = JSON.parse(await readFile(out, 'utf8'));
    expect(saved.recoveryIntent.intent).toEqual(saved.exchanges[2].response.body.intent);
    expect(saved.recoveryIntent.signingDeadline).toBe('2026-11-06T18:03:00.000Z');
    expect(saved.recoveryIntent.signatureValidUntil).toBe('2026-11-09T18:03:00.000Z');
    for (const [, init] of fetchImpl.mock.calls) {
      expect(String(init?.body)).not.toMatch(/signedData|signed_intents|private_key|accessToken|refreshToken/);
      expect(init?.headers).toEqual({ 'content-type': 'application/json', accept: 'application/json', 'X-API-Key': PARTNER });
    }
  });

  it.each(['signature', 'route', 'expiry', 'loss'])('saves a refused %s quote and stops before requesting the next proof', async failure => {
    const out = await output(), fetchImpl = provider(200, body => {
      if (failure === 'signature') { body.quote.amountOut = '1'; return body; }
      if (failure === 'route') body.quoteRequest.recipient = 'attacker.near';
      if (failure === 'expiry') body.quote.deadline = '2026-11-10T18:03:00.000Z';
      if (failure === 'loss') body.quote.refundFee = '1';
      return signFixture(body as QuoteResponse);
    });
    const error = await runConfidentialPreflight(options(out, 'live'), fetchImpl).catch(error => error);
    expect(confidentialPreflightFailure(error)).toEqual({ failure: 'CONFIDENTIAL_PREFLIGHT_QUOTE_INVALID', savedPrivately: true, signatures: 0, transactions: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(await readFile(out, 'utf8'));
    expect(saved.state).toBe('failed'); expect(saved.exchanges[0].response.body).toBeDefined(); expect(saved.recoveryIntent).toBeUndefined();
  });

  it('refuses an unsigned recovery transfer rebound to another receiver without exposing the payload', async () => {
    const out = await output(), fetchImpl = provider(201, (body, url) => {
      if (url.endsWith('/generate-intent')) {
        const payload = JSON.parse(body.intent.payload); payload.intents[0].receiver_id = 'attacker.near'; body.intent.payload = JSON.stringify(payload);
      }
      return body;
    });
    const error = await runConfidentialPreflight(options(out, 'live'), fetchImpl).catch(error => error);
    expect(confidentialPreflightFailure(error)).toEqual({ failure: 'CONFIDENTIAL_PREFLIGHT_INTENT_INVALID', savedPrivately: true, signatures: 0, transactions: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const saved = JSON.parse(await readFile(out, 'utf8')); expect(saved.exchanges[2].response.body.intent.payload).toContain('attacker.near');
    expect(String(error) + JSON.stringify(error)).not.toContain('attacker.near');
  });

  it('bounds a streamed response, cancels it, and retains only a bounded private prefix', async () => {
    const out = await output(), cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(131000).fill(120)); controller.enqueue(new Uint8Array(1024).fill(121));
    }, cancel });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
    const error = await runConfidentialPreflight(options(out), fetchImpl).catch(error => error);
    expect(confidentialPreflightFailure(error).failure).toBe('CONFIDENTIAL_PREFLIGHT_RESPONSE_TOO_LARGE');
    expect(cancel).toHaveBeenCalledTimes(1); expect(fetchImpl).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(await readFile(out, 'utf8')), captured = saved.exchanges[0].response;
    expect(captured.truncated).toBe(true); expect(captured.bodyBytes).toBe(131072);
    expect(Buffer.from(captured.bodyBase64, 'base64')).toHaveLength(131072);
  });

  it.each([202, 401, 500])('preserves private HTTP %i error evidence without echo or retry', async status => {
    const out = await output(), sensitive = 'fixture-sensitive-provider-' + OWNER;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(sensitive, { status }));
    const error = await runConfidentialPreflight(options(out), fetchImpl).catch(error => error);
    expect(confidentialPreflightFailure(error)).toEqual({ failure: 'CONFIDENTIAL_PREFLIGHT_HTTP', httpStatus: status, savedPrivately: true, signatures: 0, transactions: 0 });
    expect(String(error) + JSON.stringify(error)).not.toContain(sensitive); expect(fetchImpl).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(await readFile(out, 'utf8'));
    expect(Buffer.from(saved.exchanges[0].response.bodyBase64, 'base64').toString('utf8')).toBe(sensitive);
  });

  it('redacts malformed JSON and transport errors while retaining failure evidence', async () => {
    for (const kind of ['json', 'network']) {
      const out = await output(), fetchImpl = vi.fn<typeof fetch>();
      if (kind === 'json') fetchImpl.mockResolvedValue(new Response('fixture-sensitive-invalid-json'));
      else fetchImpl.mockRejectedValue(new Error('fixture-sensitive-network-' + PARTNER));
      const error = await runConfidentialPreflight(options(out), fetchImpl).catch(error => error);
      expect(confidentialPreflightFailure(error)).toMatchObject({ failure: kind === 'json' ? 'CONFIDENTIAL_PREFLIGHT_INVALID_JSON' : 'CONFIDENTIAL_PREFLIGHT_NETWORK', savedPrivately: true });
      expect(String(error) + JSON.stringify(error)).not.toContain('fixture-sensitive'); expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(JSON.parse(await readFile(out, 'utf8')).state).toBe('failed');
    }
  });

  it('refuses an existing evidence file before network access and preserves its exact bytes', async () => {
    const out = await output(), fetchImpl = provider(), original = 'existing-private-evidence';
    await writeFile(out, original);
    await expect(runConfidentialPreflight(options(out), fetchImpl)).rejects.toThrow('CONFIDENTIAL_PREFLIGHT_OUTPUT_EXISTS');
    expect(fetchImpl).not.toHaveBeenCalled(); expect(await readFile(out, 'utf8')).toBe(original);
  });

  it('rejects missing partner auth and spending/configuration parameters before a request', async () => {
    const out = await output(), fetchImpl = provider(); vi.stubEnv('ONECLICK_JWT', '');
    await expect(runConfidentialPreflight(options(out), fetchImpl)).rejects.toThrow('CONFIDENTIAL_PREFLIGHT_PARTNER_AUTH_REQUIRED');
    expect(JSON.parse(await readFile(out, 'utf8')).exchanges).toEqual([]);
    for (const extra of [{ signer: {} }, { amount: '1000000000000000000001' }, { endpoint: 'https://attacker.invalid' }, { token: PARTNER }, { maxLossBps: 1001 }]) {
      await expect(runConfidentialPreflight({ ...options(out), ...extra } as ConfidentialPreflightOptions, fetchImpl)).rejects.toThrow('CONFIDENTIAL_PREFLIGHT_INPUT');
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('confidential preflight CLI', () => {
  async function metadata() {
    const directory = await mkdtemp(join(tmpdir(), 'neslos-confidential-cli-'));
    const credentials = join(directory, 'credentials.json'), session = join(directory, 'session.json'), out = join(directory, 'evidence.json');
    // Invalid private values prove this path cannot depend on loading a signing key or bearer session.
    await writeFile(credentials, JSON.stringify({ account_id: OWNER, public_key: PUBLIC_KEY, private_key: 'fixture-sensitive-NOT-A-KEY' }));
    await writeFile(session, JSON.stringify({ format: 'neslos-confidential-user-session-v1', recipient: ID, publicKey: PUBLIC_KEY,
      accessExpiresAt: '2000-01-01T00:00:00.000Z', accessToken: 'fixture-sensitive-session-access', refreshToken: 'fixture-sensitive-session-refresh' }));
    return { credentials, session, out };
  }

  it('uses only public file metadata and prints a sanitized summary', async () => {
    const { credentials, session, out } = await metadata(), fetchImpl = provider(), stdout = vi.spyOn(console, 'log').mockImplementation(() => {}), stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetchImpl);
    expect(await runConfidentialPreflightCli(['preflight', '--credentials', credentials, '--session', session, '--out', out])).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2); expect(stderr).not.toHaveBeenCalled();
    const printed = stdout.mock.calls.flat().join('');
    expect(JSON.parse(printed)).toMatchObject({ mode: 'dry', savedPrivately: true, signatures: 0, transactions: 0 });
    for (const sensitive of ['fixture-sensitive', OWNER, PUBLIC_KEY, ID, out]) expect(printed).not.toContain(sensitive);
    const evidence = await readFile(out, 'utf8'); expect(evidence).not.toContain('fixture-sensitive');
  });

  it('accepts an explicit public identity and blocks a mismatched saved session before any request', async () => {
    const { session, out } = await metadata(), fetchImpl = provider(), stdout = vi.spyOn(console, 'log').mockImplementation(() => {}), stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetchImpl);
    await writeFile(session, JSON.stringify({ format: 'neslos-confidential-user-session-v1', recipient: 'ff'.repeat(32), publicKey: PUBLIC_KEY }));
    expect(await runConfidentialPreflightCli(['preflight', '--owner-account', OWNER, '--public-key', PUBLIC_KEY, '--session', session, '--out', out])).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled(); expect(stdout).not.toHaveBeenCalled();
    expect(JSON.parse(String(stderr.mock.calls[0]![0]))).toMatchObject({ failure: 'CONFIDENTIAL_PREFLIGHT_IDENTITY', savedPrivately: false, signatures: 0, transactions: 0 });
  });

  it('rejects ambiguous and unsupported arguments with a fixed error before reading metadata', async () => {
    const fetchImpl = provider(), stderr = vi.spyOn(console, 'error').mockImplementation(() => {}); vi.stubGlobal('fetch', fetchImpl);
    for (const args of [
      ['preflight'], ['submit', '--out', 'evidence.json'], ['preflight', '--live', '--dry'],
      ['preflight', '--live', '--live'], ['preflight', '--owner-account', OWNER],
      ['preflight', '--owner-account', OWNER, '--public-key', PUBLIC_KEY, '--credentials', 'fixture-sensitive-file'],
      ['preflight', '--endpoint', 'https://fixture-sensitive.invalid'], ['preflight', '--max-loss-bps', '0.5'],
      ['preflight', '--signer', 'fixture-sensitive-signer'],
    ]) expect(await runConfidentialPreflightCli(args)).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    for (const [message] of stderr.mock.calls) expect(JSON.parse(String(message))).toEqual({ failure: 'CONFIDENTIAL_PREFLIGHT_ARGUMENTS', savedPrivately: false, signatures: 0, transactions: 0 });
  });
});
