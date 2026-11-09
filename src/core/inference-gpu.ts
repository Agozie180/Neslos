import { setTimeout } from 'node:timers/promises';
import { createGpuEvidenceVerifier, type GpuEvidenceVerifier } from '@nearai/inference-sdk/node';

/** Retain the exact NVIDIA response across a bounded clock-skew wait. A retry
 * that asks NRAS to mint another token can perpetually receive a future iat.
 * The SDK still checks NVIDIA's signature, issuer, algorithm, all time claims,
 * nonce and overall result. No clock tolerance or verification bypass is used.
 */
export function createNrasGpuVerifier(): GpuEvidenceVerifier {
  return async payload => {
    const response = await fetch('https://nras.attestation.nvidia.com/v3/attest/gpu', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: payload,
      redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    if (!response.ok || !response.body) throw new Error('INFERENCE_NRAS_UNAVAILABLE');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > 1_000_000) throw new Error('INFERENCE_NRAS_SIZE');
      chunks.push(chunk);
    }
    // A private in-memory data URL lets the unmodified SDK re-read these exact
    // bytes; its JWKS still comes exclusively from NVIDIA's official endpoint.
    const verify = createGpuEvidenceVerifier({ nrasUrl: 'data:application/json;base64,' + Buffer.concat(chunks).toString('base64') });
    try { await verify(payload); }
    catch (error) {
      const failure = (error as { failure?: { code?: string; details?: { reason?: string } } })?.failure;
      if (failure?.code !== 'gpu.jwt_verification_failed' || failure.details?.reason !== 'not_yet_valid') throw error;
      await setTimeout(3000);
      await verify(payload);
    }
  };
}
