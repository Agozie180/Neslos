# Neslos status — 6 November 2026

**Vault commerce is deployed and verified on testnet; integrated private execution is not yet demonstrated.** The [deployment report](VAULT-COMMERCE-DEPLOYMENT-2026-11-06.md) and [foundation audit](AUDIT-2026-11-06.md) record the evidence and limitations.

| Layer | Current evidence |
| --- | --- |
| Application/private-runtime software | 382 tests pass on Windows with 4 platform skips; strict TypeScript and production builds pass. Linux CI exercises the platform-specific checks; current local run details are in `artifacts/app-verification.json` |
| Browser | 6 desktop/mobile tests pass; rehearsal and fixture-backed owner workflows |
| Contract | 25 Rust unit tests and two local NEAR sandbox suites pass, including actual old-state compatibility and NEP-141 event checks |
| TEE package | Updated Linux/amd64 image builds and passes restricted-container fake-hardware rejection; not a genuine TDX deployment |
| Public testnet | Same vault upgraded; exact payment, daily-limit rejection and replay rejection verified; policy restored and paused at version 9 |
| Private infrastructure | Local oversized-bundle guards fixed; Phala's terms-of-use restriction remains subject to provider review; no CVM launched |
| Live data | 10 normalized live Rhea markets, 2 default-policy eligible; lending reader works |
| Private settlement | Ownership authentication, no-spend session refresh and private-balance reads work; the free partner key is missing, and quote/recovery-route viability and funded settlement remain unverified; no mainnet funds spent |
| Provider inference | Genuine gateway/model/GPU evidence passed; both VMs' MRTD/RTMR0–2 and all 26 RTMR0 event digests combined were independently reproduced; current model runtime/history approval remains unresolved; no paid inference call |
| Publishing | GitHub repo private; configured demo URL returns 404; no submission evidence established |

Each application/contract verification report records its own source-content digest and run ID. [Remote CI](https://github.com/Agozie180/Neslos/actions/workflows/verify.yml) identifies the exact checked revision. Historical counts and earlier artifacts are retained in the [verification record](PROOF.md).

Current compiled and downloaded deployed vault SHA-256: `545e140a2f452f609ba55b5623d1d48994bde32335c0a7fc05acd644e7cf8aa0`. The fixture token was separately upgraded to emit standard transfer events; both upgrades preserved their full raw state. Mainnet deployment has not been attempted.

The [inference review](INFERENCE-LIVE-REVIEW-2026-11-06.md) separates reproduced boot measurements from current runtime and deployment-history approval. The original and current model reports share a signer: selecting that signer filters reports, but does not establish a unique VM or deployment.

Owner browser/CLI features include exact transaction review, policy allowlists, storage/funding, private research/audit, finite research/observation schedules and retained-hash recovery. Schedules never submit payments. New public commerce goes through the vault's on-chain limits. Agent Market's incompatible wallet-delegate payment rail is disabled; historical recovery remains available.

Next: review the current model runtime/history trust scope, seek a legitimate resolution of the [Phala restriction](TDX-DEPLOYMENT-STATUS.md), and configure [partner authentication](CONFIDENTIAL-AUTH.md) before testing quote and recovery viability. The [testnet research](CONFIDENTIAL-TESTNET-RESEARCH-2026-11-06.md) confirms eligibility in every track without mandatory Intents integration. Roughly 2.4 NEAR is an estimated code-storage stake for an optional mainnet vault, before state/gas costs; it is not a hackathon or settlement fee. The existing testnet proof can support submission while the full private flow remains explicitly unfinished. Deadline: **14 November 2026, 23:59 UTC / 15 November, 00:59 Lagos**.
