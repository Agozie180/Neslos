# Privacy and trust boundaries

Neslos protects private agent inputs and recipient openings in an attested executor, while a NEAR contract bounds USDC spending. The public rehearsal does not run inside a TEE.

## What each boundary enforces

| Boundary | Enforced behavior | Trust remaining |
| --- | --- | --- |
| NEAR policy vault | Exact USDC daily and per-action caps, pause, policy version, nonce, authorization expiry, allowlist membership, destination-asset restriction, minimum output, executor signature | NEAR consensus, the configured token, owner governance |
| Attested executor | Opens salted recipient/venue commitments, verifies a 1Click quote, checks live research, selects an action, signs its exact Borsh bytes | Intel TDX, dstack key derivation, independently approved code/OS measurements |
| NEAR AI | Encrypted research inputs, gateway TLS binding, strict UpToDate TCB, model GPU evidence, pinned deployment measurements, verified provider_tee response | Approved model deployment, Intel/NVIDIA attestation roots and verification SDKs |
| Private channel | RFC 9180 HPKE with X25519, HKDF-SHA256 and AES-256-GCM; reply signature bound to attested executor | Owner must verify fresh evidence before sending a credential or private input |
| Confidential Intents | Signed confidential-recipient routing, encrypted private orchestration, confidential output account | The quote provider and Confidential Intents service; Neslos does not independently attest the 1Click HTTPS endpoint |
| Audit | AES-256-GCM payloads, Ed25519 signatures, ordered content hashes, durable encrypted TEE journal | Completeness and rollback resistance need an externally retained or on-chain checkpoint |

The on-chain cap still constrains the authorized amount if an executor key is compromised. **Hidden recipient and venue semantics depend on the pinned TEE.** The contract checks commitment membership; it cannot open a private recipient commitment or prove that a quote deposit address maps to that hidden recipient.

The minimum output is compared to the signed quoted output. This enforces slippage against that quote, not fair market value against an independent price oracle. Requesting one basis point less than the owner's maximum leaves room for provider rounding; Neslos uses a ceiling when calculating its hard output floor.

## What remains visible

On NEAR, input amounts, token transfers, contract policy parameters, nonces, output asset/minimums, commitments and event timestamps are public. Funding and withdrawal timing can permit correlation. Audit metadata exposes event type, time and count.

The quote provider sees the fields required to route a quote, including assets, amount, refund account and recipient. HTTPS and a provider signature do not by themselves prove all provider-side processing took place in a TEE.

A public Rhea lending position remains public. The implemented action funds an **allocation reserve**; it does not open or manage a lending position. The rehearsal guardian rejects public lending when confidentiality is required.

## A verified flag is not verification

The live runtime refuses simulator endpoints. It validates Intel quote signatures and collateral with DCAP, requires UpToDate TCB, rejects debug mode, binds a fresh challenge and both public keys to report data, and compares all pinned MRTD/RTMR values. Missing pins or unapproved measurements stop startup.

The owner obtains expected measurements independently from the reviewed OS/application build. Copying measurements from an untrusted server into the policy is not a verification procedure.

The NEAR AI SDK checks attestation before sending a request. Neslos then verifies the response signature before using the model's answer and rejects gateway-only model responses. Model output cannot change balances, compute budget authority or sign a transfer.

## 1Click signature coverage finding

The installed official 1Click SDK 0.1.26 excludes the confidentiality field from its signed request subset. It includes recipientType and recipient. Therefore Neslos requires recipientType = CONFIDENTIAL_INTENTS, validates the request echo over the fixed HTTPS endpoint, and verifies the official provider signature. It does not infer confidential routing from an unsigned flag alone.

Reproduce the coverage finding in tests/intents.test.ts. The fixture is synthetic and intentionally unsigned; it is not a captured market quote.

## Failure behavior

- Reserve allowance on chain **before** dispatching the external FT transfer.
- Only an actual failed FT receipt restores its original day's allowance.
- An oversized successful FT return is still successful. It cannot replenish allowance.
- No replay, policy update, key rotation or pause resets the nonce or today's usage.
- Unknown status remains charged. A provider timeout never triggers a second deposit.
- A late refund does not replenish daily allowance automatically.
- The owner can recover tokens to their own account after pausing the vault. This is an owner authority, separate from agent spending.
- Rehearsal sessions hold no real keys or assets; they expire after two hours and are memory-only.
- A TEE restart restores and verifies its encrypted journal. Filesystem rollback cannot be solved by an encrypted file alone; compare on-chain records/checkpoints and retain evidence independently.

## Budget scope

The hard budget asset is native USDC on NEAR, in six-decimal integer units, on a UTC calendar-day basis. NEAR gas, storage, TEE hosting and inference credits have separate budgets. Authorize attaches 0.01 NEAR for bounded record storage and the FT call's one yoctoNEAR. The funding asset contract is immutable.

This is a hackathon implementation, with adversarial and local-chain tests. It has not received an independent security audit or demonstrated funded mainnet settlement.
