import { readFile } from 'node:fs/promises';
import { teePolicySchema, verifyTeeEvidence } from '../src/core/attestation.js';
const [evidenceFile, policyFile, expectedNonce] = process.argv.slice(2);
if (!evidenceFile || !policyFile || !expectedNonce) throw new Error('Usage: npm run verify:attestation -- evidence.json independently-pinned-policy.json <your-fresh-challenge>');
const [evidence, pinned] = await Promise.all([readFile(evidenceFile, 'utf8'), readFile(policyFile, 'utf8')]);
console.log(JSON.stringify(await verifyTeeEvidence(JSON.parse(evidence), teePolicySchema.parse(JSON.parse(pinned)), expectedNonce), null, 2));
