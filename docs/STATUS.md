# Neslos status — 6 November 2026

**Vault commerce is deployed and verified on testnet; integrated private execution is not yet demonstrated.** The [deployment report](VAULT-COMMERCE-DEPLOYMENT-2026-11-06.md) and [foundation audit](AUDIT-2026-11-06.md) record the evidence and limitations.

| Layer | Current evidence |
| --- | --- |
| Application/private-runtime software | 334 tests pass on Windows with 4 platform skips; strict TypeScript and production builds pass. Linux CI exercises the platform-specific checks; current local run details are in `artifacts/app-verification.json` |
| Browser | 6 desktop/mobile tests pass; rehearsal and fixture-backed owner workflows |
| Contract | 25 Rust unit tests and two local NEAR sandbox suites pass, including actual old-state compatibility and NEP-141 event checks |
| TEE package | Updated Linux/amd64 image builds and passes restricted-container fake-hardware rejection; not a genuine TDX deployment |
| Public testnet | Same vault upgraded; exact payment, daily-limit rejection and replay rejection verified; policy restored and paused at version 9 |
| Private infrastructure | Phala rejected the provisioning request with a terms-of-use restriction; no CVM launched |
| Live data | 10 normalized live Rhea markets, 2 default-policy eligible; lending reader works |
| Private settlement | Wallet ownership authentication and private-balance reads work; partner key, executable quote and funded settlement still pending; no mainnet funds spent |
| Provider inference | Genuine gateway/model/GPU evidence passed; independent RTMR0 ACPI reconstruction remains unresolved; no paid inference call |
| Publishing | GitHub repo private; configured demo URL returns 404; no submission evidence established |

Each application/contract verification report records its own source-content digest and run ID. [Remote CI](https://github.com/Agozie180/Neslos/actions/workflows/verify.yml) identifies the exact checked revision. Historical counts and earlier artifacts are retained in the [verification record](PROOF.md).

Current compiled and downloaded deployed vault SHA-256: `545e140a2f452f609ba55b5623d1d48994bde32335c0a7fc05acd644e7cf8aa0`. The fixture token was separately upgraded to emit standard transfer events; both upgrades preserved their full raw state. Mainnet deployment has not been attempted.

Owner browser/CLI features include exact transaction review, policy allowlists, storage/funding, private research/audit, finite research/observation schedules and retained-hash recovery. Schedules never submit payments. New public commerce goes through the vault's on-chain limits. Agent Market's incompatible wallet-delegate payment rail is disabled; historical recovery remains available.

Next: resolve the [Phala restriction](TDX-DEPLOYMENT-STATUS.md), obtain the [provider VM configuration](INFERENCE-LIVE-REVIEW-2026-11-06.md) for complete boot approval, and configure [partner authentication](CONFIDENTIAL-AUTH.md). Mainnet vault deployment also requires a separately reviewed storage-funding plan. Then demonstrate the complete private flow and finish submission. Deadline: **14 November 2026, 23:59 UTC / 15 November, 00:59 Lagos**.
