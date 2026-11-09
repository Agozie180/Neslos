import { parseArgs } from 'node:util';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { sourceIdentity } from './evidence.mjs';
import { assertPhalaComposePayloadSize } from './phala-compose.mjs';

const { values } = parseArgs({ options: { image: { type: 'string' }, out: { type: 'string' }, 'testnet-vault': { type: 'string' } } });
if (!values.image || !/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/.test(values.image) || !values.out) throw new Error('Use --image REGISTRY/IMAGE@sha256:64_HEX_DIGEST --out DIRECTORY. Mutable tags are refused.');
const vault = values['testnet-vault'];
if (vault !== undefined && (vault.length > 64 || vault.trim() !== vault || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(vault))) throw new Error('TESTNET_VAULT_REQUIRED: use a valid named .testnet account.');
const root = fileURLToPath(new URL('..', import.meta.url));
const template = readFileSync(resolve(root, 'deploy/tee/compose.yaml'), 'utf8');
let compose = template.replace('${NESLOS_TEE_IMAGE:?Set a published linux/amd64 image with @sha256 digest}', values.image);
// Bind the requested chain target into the measured Compose, rather than leaving
// it substitutable through a later encrypted-environment update.
if (vault !== undefined) compose = compose
  .replace('NESLOS_NETWORK=${NESLOS_NETWORK:-testnet}', 'NESLOS_NETWORK=testnet')
  .replace('NESLOS_VAULT_ACCOUNT=${NESLOS_VAULT_ACCOUNT:-}', 'NESLOS_VAULT_ACCOUNT=' + vault);
const composePayloadBytes = assertPhalaComposePayloadSize(compose);
const directory = resolve(values.out); mkdirSync(directory, { recursive: true, mode: 0o700 });
writeFileSync(resolve(directory, 'compose.yaml'), compose, { flag: 'wx', mode: 0o600 });
const manifest = { format: 'neslos-tee-deployment-v1', generatedAt: new Date().toISOString(), image: values.image,
  composeSha256: createHash('sha256').update(compose).digest('hex'), composePayloadBytes, source: sourceIdentity(),
  ...(vault === undefined ? {} : { target: { network: 'testnet', vault } }),
  status: 'prepared-not-deployed', note: 'This file is not hardware evidence. Review the full platform app-compose, init scripts, OS measurements and key provider before trusting a quote.' };
writeFileSync(resolve(directory, 'deployment.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ directory, ...manifest }, null, 2));
