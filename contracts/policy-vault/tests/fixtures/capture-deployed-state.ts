/** Read-only public chain fixture capture; never loads credentials or signs. */
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { nearProvider } from '../../../../src/core/near.js';
const provider = nearProvider('testnet');
const state = await provider.viewContractState({ contractId: 'vault.neslos.testnet', prefix: '', blockQuery: { finality: 'final' } });
const code = await provider.viewContractCode({ contractId: 'vault.neslos.testnet', blockQuery: { blockId: state.block_hash } });
const codeSha256 = createHash('sha256').update(code.code).digest('hex');
if (codeSha256 !== '196460a40676c7901143a9adf63ce61f63e25bf862e0acb4d9d51ff491e32b73') throw new Error('LEGACY_CODE_CHANGED');
await writeFile(new URL('./deployed-v1-state.json', import.meta.url), JSON.stringify({ network: 'testnet', vault: 'vault.neslos.testnet', capturedAt: new Date().toISOString(), codeSha256, state }, null, 2) + '\n');
console.log(JSON.stringify({ blockHash: state.block_hash, entries: state.values.length }));
