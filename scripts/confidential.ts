import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { hashHex, nearAccount } from '../src/core/wire.js';
import { confidentialImplicitId } from '../src/owner/confidential-auth.js';
import { confidentialPreflightFailure, ConfidentialPreflightError, runConfidentialPreflight } from '../src/owner/confidential-preflight.js';

const PUBLIC_KEY = z.string().min(1).max(100);
const credentialsMetadata = z.object({ account_id: nearAccount, public_key: PUBLIC_KEY });
const sessionMetadata = z.object({ format: z.literal('neslos-confidential-user-session-v1'), recipient: hashHex, publicKey: PUBLIC_KEY });
const DEFAULT_CREDENTIALS = '.private/near/mainnet/settlement.json';
const DEFAULT_SESSION = '.private/confidential-user-session.json';
const MAX_METADATA_BYTES = 131072;
const HELP = 'Usage: npm run confidential -- preflight [--dry|--live] --out PATH\n'
  + '  [--owner-account PUBLIC_ACCOUNT --public-key PUBLIC_KEY | --credentials PATH]\n'
  + '  [--session PATH] [--max-loss-bps 0]\n'
  + 'Quotes a fixed 0.001 wNEAR shield and unshield. Live also validates an unsigned recovery intent.\n'
  + 'Reads ONECLICK_JWT from the environment; never signs, deposits or submits.\n'
  + 'Saved credentials and session supply public identity metadata only. Evidence output must be new.';

async function readMetadata(path: string): Promise<unknown> {
  const file = await open(resolve(path), 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_METADATA_BYTES) throw new Error();
    const buffer = Buffer.alloc(MAX_METADATA_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > MAX_METADATA_BYTES) throw new Error();
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size))) as unknown;
  } finally { await file.close(); }
}

function parseOptions(args: string[]) {
  try {
    const parsed = parseArgs({ args, strict: true, allowPositionals: true, tokens: true, options: {
      'owner-account': { type: 'string' }, 'public-key': { type: 'string' }, credentials: { type: 'string' },
      session: { type: 'string', default: DEFAULT_SESSION }, out: { type: 'string' },
      live: { type: 'boolean', default: false }, dry: { type: 'boolean', default: false },
      'max-loss-bps': { type: 'string', default: '0' }, help: { type: 'boolean', short: 'h', default: false },
    } });
    const seen = new Set<string>();
    for (const token of parsed.tokens) if (token.kind === 'option') {
      if (seen.has(token.name)) throw new Error();
      seen.add(token.name);
    }
    const v = parsed.values;
    if (parsed.positionals.length > 1 || (parsed.positionals[0] && parsed.positionals[0] !== 'preflight')) throw new Error();
    if (v.live && v.dry) throw new Error();
    const explicitAccount = v['owner-account'] !== undefined, explicitKey = v['public-key'] !== undefined;
    if (explicitAccount !== explicitKey || (explicitAccount && v.credentials !== undefined)) throw new Error();
    if (!/^(0|[1-9][0-9]{0,3})$/.test(v['max-loss-bps']) || Number(v['max-loss-bps']) > 1000) throw new Error();
    if (v.out !== undefined && (!v.out.trim() || v.out.includes('\0'))) throw new Error();
    return { ...v, help: v.help || args.length === 0 };
  } catch { throw new ConfidentialPreflightError('CONFIDENTIAL_PREFLIGHT_ARGUMENTS'); }
}

/** Exported for offline CLI tests; it never constructs a signer or uses a session token. */
export async function runConfidentialPreflightCli(args: string[]): Promise<number> {
  try {
    const v = parseOptions(args);
    if (v.help) { console.log(HELP); return 0; }
    if (!v.out) throw new ConfidentialPreflightError('CONFIDENTIAL_PREFLIGHT_ARGUMENTS');
    let ownerAccount: string, publicKey: string;
    if (v['owner-account'] !== undefined && v['public-key'] !== undefined) {
      ownerAccount = v['owner-account']; publicKey = v['public-key'];
    } else {
      try {
        const metadata = credentialsMetadata.parse(await readMetadata(v.credentials ?? DEFAULT_CREDENTIALS));
        ownerAccount = metadata.account_id; publicKey = metadata.public_key;
      } catch { throw new ConfidentialPreflightError('CONFIDENTIAL_PREFLIGHT_CREDENTIALS'); }
    }
    let confidentialId: string;
    try { nearAccount.parse(ownerAccount); confidentialId = confidentialImplicitId(publicKey); }
    catch { throw new ConfidentialPreflightError('CONFIDENTIAL_PREFLIGHT_IDENTITY'); }
    let savedIdentity: z.infer<typeof sessionMetadata>;
    try { savedIdentity = sessionMetadata.parse(await readMetadata(v.session)); }
    catch { throw new ConfidentialPreflightError('CONFIDENTIAL_PREFLIGHT_SESSION'); }
    if (savedIdentity.recipient !== confidentialId || savedIdentity.publicKey !== publicKey) throw new ConfidentialPreflightError('CONFIDENTIAL_PREFLIGHT_IDENTITY');
    console.log(JSON.stringify(await runConfidentialPreflight({ ownerAccount, publicKey, mode: v.live ? 'live' : 'dry', maxLossBps: Number(v['max-loss-bps']), out: v.out })));
    return 0;
  } catch (error) { console.error(JSON.stringify(confidentialPreflightFailure(error))); return 1; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runConfidentialPreflightCli(process.argv.slice(2));
