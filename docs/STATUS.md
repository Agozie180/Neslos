# Neslos implementation status

Latest work: [Private owner workflow and TEE deployment runbook](TEE-RUNBOOK.md). The CLI now verifies the executor before encrypting commands, preserves request IDs across lost replies, exports/checks the private audit, verifies plaintext receipt openings, and plans/submits exact NEAR calls with durable transaction recovery. It supports executor pinning, policy updates, pause and owner withdrawal. A private research command can run with a testnet vault without creating a quote or payment. The browser remains a rehearsal.

A dedicated Linux/amd64 TEE image and dstack Compose template are implemented, including an attestation-only bootstrap, non-root process, persistent journal and immutable image bundle generator. Verification repeated on **4 November 2026** passed **165 application tests across 17 files**, strict TypeScript, production builds, **3 browser tests**, and **12 contract unit tests plus 1 sandbox suite** in Ubuntu WSL. The TEE image build and restricted-container smoke check also passed: bootstrap rejects private calls, and the real verifier refuses the fake quote. Contract sources are unchanged. [GitHub CI runs](https://github.com/Agozie180/Neslos/actions/workflows/verify.yml) record results for each pushed revision.

The [foundation fixes](FOUNDATION-FIXES-2026-11-03.md) remain in place. Genuine remote hardware execution, independently approved measurements, live encrypted inference and funded private settlement are still unverified. Next: obtain a CPU TDX instance/credits and NEAR AI credentials, follow the runbook, and capture actual evidence. Research-driven strategy decisions, lending positions, browser integration and unattended operation remain unfinished parts of the original brief. The runbook distinguishes NEAR AI's $10 builder credit, Phala's conditional promotion, and OutLayer's separate WASI trial; no free hosting entitlement or live instance has been assumed.

## Earlier progress — 3 November 2026

The interrupted testnet deployment and proof are complete. The [vault](https://testnet.nearblocks.io/address/vault.neslos.testnet) is paused. [Deployment evidence](../deploy/testnet.json) and [12 proof receipts](../deploy/testnet-proof.json) record the downloaded code hashes, expected rejections, failed-transfer refund, retained allowance, settlement and owner recovery. This is a public fixture-token demonstration with a local executor, not a TEE or Intents demonstration.

The owner CLI now uses the official NEAR SDK, saves signed transactions before broadcast, reconciles saved hashes after interruption, and resumes proof steps only when finalized receipts and current state agree. Typed SDK errors distinguish a missing account from a failed lookup. Read retries handle Node's transport errors; transaction recovery never creates a replacement payment on a timeout. Ubuntu source/build isolation and public-evidence copying are in `scripts/ubuntu.sh`.

Application verification passed **91 tests across 8 files**, strict TypeScript, frontend and server/TEE/owner compilation in Ubuntu. **3 browser tests** passed after installing Linux Chromium. The contract passed **12 unit tests and 1 sandbox suite** locally on 2 November and again in GitHub CI on 3 November. The deployed vault code matches the reviewed artifact.

The concurrency-test correction, CI `libudev-dev` prerequisite, and rehearsal-prompt wording are fixed. [GitHub Actions run 41693429252](https://github.com/Agozie180/Neslos/actions/runs/41693429252) passed both application and contract jobs on source commit `8d2db211d09b145d3cb70197a5ca30b7ed8c1bc7`. This includes a clean npm install, application tests/build, Linux Chromium tests, cargo-near installation, both WASM builds, contract tests and evidence uploads. Work is saved on branch `fix/testnet-deployment-recovery`; this status update changes documentation only.

Remaining work: the private-runtime owner client and audit access, TEE deployment packaging and integration tests, genuine hardware/NEAR AI/Intents evidence, public demo/video and hackathon submission. The repository is still private. Testnet-only work does not require a mainnet demonstration. Scheduling, external paid agents and lending-position management remain later scope.

## Historical review — 2 November 2026

The remainder of this file records the original audit before the fixes and testnet work above.

Reviewed source revision `39ec1a6727c447c7f44e34458447e95ea96c7dd8`, local execution, Docker packaging, and the latest GitHub Actions run. This review did not change application code, publish the repository, deploy a vault, or move funds.

The local rehearsal is implemented and builds successfully. The remaining work is primarily CI reliability, an owner-facing live workflow, live integration evidence, and publication. Credentials alone will not connect the existing browser to the private runtime.

## Checks performed

| Check | Result on 2 November |
| --- | --- |
| `npm run verify` | Passed: 76 tests across 7 files, strict TypeScript, frontend build, server/TEE compilation |
| `npm run test:browser` | Passed: 3 Chromium tests covering the mission/audit workflow, mobile layout, and source-selection race |
| `npm run test:contract` | Passed in WSL: both WASM builds, 12 unit tests, 1 local NEAR sandbox suite |
| Vault artifact | 202344 bytes; SHA-256 `196460a40676c7901143a9adf63ce61f63e25bf862e0acb4d9d51ff491e32b73` |
| `docker build -t neslos-audit:2026-11-02 .` | Passed using the existing Dockerfile and a fresh Linux dependency install |
| Container startup smoke check | Passed with no external network or published ports: health, homepage, session state, and 10 reference markets |
| `npm audit --omit=dev --json` | 3 low-severity package entries from the existing transitive `elliptic` advisory; no automated fix available |
| GitHub CI | Latest run failed in both jobs; causes below |
| Repository publication | GitHub reports `private`; repository homepage is unset |

Local application and contract verification JSON is regenerated in `artifacts/`. Docker startup testing does not establish HTTPS production hosting or hardware attestation. Local success does not override the failing CI result.

## Fix first

1. **Make the concurrency test deterministic.** [tests/api.test.ts](../tests/api.test.ts), lines 81–87, launches three $150 missions against a $500 daily limit, then requires exactly one success. Asynchronous fixture reads and stage delays do not guarantee all proposals capture the same nonce. CI observed two successful missions, which is within the spending limit. Use an explicit barrier to test competing proposals with the same nonce, and separately test contention against a deliberately insufficient allowance. Assert total charged usage and nonce uniqueness independently of scheduling. This CI failure is not evidence of an overspend.

2. **Install the contract CLI's Linux prerequisite in CI.** [.github/workflows/verify.yml](../.github/workflows/verify.yml), line 38, compiles `cargo-near` before installing `libudev-dev`. The actual failure is `hidapi v2.6.6: Unable to find libudev`; contract tests never start. Install the prerequisite or use a pinned, checksum-verified CLI release, then obtain a green clean-runner build. Document the prerequisite in the Linux setup instructions too.

3. **Correct or implement mission-prompt behavior in rehearsal.** [README.md](../README.md), line 52, says the typed objective informs research. [src/core/orchestrator.ts](../src/core/orchestrator.ts), lines 35–39, passes only research data and policy to the deterministic researchers and ranking function. The prompt is retained in the mission and audit, but does not affect this research or selection. Either implement a defined prompt-aware research behavior or describe the rehearsal prompt as a recorded objective. The separate live researcher does receive the prompt.

4. **Refresh verification claims after fixing CI.** README and PROOF still say Docker and GitHub CI have not run. Docker now passes; CI has run and failed. Keep those distinct and link the new evidence rather than claiming all checks are green.

CI evidence: [run 41337279129](https://github.com/Agozie180/Neslos/actions/runs/41337279129), at the reviewed source revision.

## Implementation needed for a usable live product

| Gap | Current implementation | Work remaining |
| --- | --- | --- |
| Owner client and wallet workflow | `privateCommand()` is a Node library helper; no application or script calls it. Browser/API are explicitly rehearsal-only. | Provide an owner-controlled client or CLI for endpoint/measurement configuration, attestation verification, encrypted commands, and secure owner credentials. |
| On-chain governance and funding UI | Contract exposes policy changes, executor pinning, pause, and owner withdrawal; browser edits only its in-memory ledger. | Add owner-signed vault setup, token storage registration, funding, policy updates, pause/recovery, and on-chain state display. |
| Transaction submission and settlement | Private runtime prepares `authorize` and `record_settlement` FunctionCalls. It never submits them. | Add an owner review/sign/submit workflow or an explicitly authorized relayer, transaction receipt tracking, and repeated settlement observation. Preserve the existing no-blind-resend behavior. |
| Private audit access | Runtime persists an encrypted journal; its command schema exposes only `prepare` and `observe`. The existing audit screen reads rehearsal sessions. | Add authenticated private audit export/open operations and an owner verification/decryption workflow for live receipts. |
| Private runtime deployment packaging | A rehearsal Dockerfile exists; `deploy/` is empty. Deployment steps are mostly manual prose. | Supply a concrete reviewed TEE deployment manifest, compiled entrypoint, socket/volume permissions, persistent journal, secrets injection, and health/recovery instructions. |
| Runtime orchestration tests | Crypto, binding, policy, API, and contract primitives are tested. No test exercises `PrivateRuntime`, `privateCommand`, `PrivateResearchers`, `readVault`, or `IntentsClient.status` together. | Cover prepare/observe, changed policy/nonce, verified inference failure, journal restart/idempotency, pending/unknown settlement, and signature-valid quote success paths. Keep simulated dependencies clearly labelled. |
| Long-running operation | Rehearsal is memory-only; private journal is capped at 32 MB and completed commands at 1000. | Implement/document tested archive and rotation with retained checkpoints, recovery, monitoring, and appropriate operational limits before unattended service. |

Relevant sources: [private client](../src/core/private-client.ts), [private runtime](../src/tee/runtime.ts), [TEE entrypoint](../src/tee/index.ts), [browser API](../src/web/api.ts), [rehearsal server](../src/server/app.ts), [Dockerfile](../Dockerfile).

## Integration setup and evidence still needed

These adapters contain real implementation, but the repository does not supply evidence of a successful live end-to-end execution:

- Provision a genuine Intel TDX/dstack instance; independently approve measurements, verify a fresh quote, and pin the executor key in the vault.
- Configure approved NEAR AI model/gateway measurements and credentials; capture a verified encrypted inference response.
- Configure `ONECLICK_JWT`; obtain and verify a signed confidential dry quote. The existing documented probe returned HTTP 401. A successful confidential quote was not established by this review.
- Deploy and initialize an owner-controlled testnet vault with a test token; preserve explorer links, deployed code hash, configuration, and transaction evidence. Local sandbox deployment already works.
- For actual Intents execution, separately authorize a bounded mainnet demonstration and retain dispatch/settlement evidence. **1Click has no testnet.** Testnet-only hackathon work is eligible according to the captured event brief; funded mainnet execution is not required just to demonstrate the local product.
- Review the still-present dependency advisory against the live verification path and track an upstream fix. The current audit reports no moderate, high, or critical entries.

No live provisioning, credentials, deployment, or funded execution was performed during this review.

## Features explicitly not implemented

These are listed as later scope in [ARCHITECTURE.md](ARCHITECTURE.md), rather than missing requirements for the current reserve/payment rehearsal:

- Scheduled or unattended missions.
- Hiring and paying actual external agents for completed jobs.
- Additional spending assets beyond the vault's fixed token and the live adapter's native NEAR USDC input.
- Actual Rhea lending deposits, withdrawals, position monitoring, or rebalancing. An allocation reserve does not open a lending position.
- Execution adapters for the additional DeFiLlama research rows; these remain research-only.

## Publication and submission

- The GitHub repository remains private. Public source is required by the captured hackathon brief.
- No hosted demo URL is configured in the repository metadata. Hosting is optional for the local-only submission route; provide reproducible instructions and a video in that case.
- The repository contains a demo script and screenshots; a recorded demo/public X demo link and final submission evidence remain pending in its documentation.
- Final submission needs the human's actual team, contact, payout information, chosen tracks, required links, and consent. The captured brief gives the deadline as **14 November 2026, 23:59 UTC / 15 November, 00:59 Lagos**. Recheck the live brief before submitting.

Recommended sequence: repair CI and the prompt claim, finish an owner-operated live client if live execution is in scope, validate the credentialed integrations, then publish the evidence and prepare the submission. Scheduling, paid external jobs, and lending-position management can remain future scope.
