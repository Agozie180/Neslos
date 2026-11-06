# Verification record

Updated **6 November 2026**: the [current vault commerce report](VAULT-COMMERCE-DEPLOYMENT-2026-11-06.md) records the deployed upgrade, preserved state and real testnet payment/limit/replay receipts. The expanded contract suite passed 25 unit tests and two sandbox suites. [Inference preflight](INFERENCE-LIVE-REVIEW-2026-11-06.md) verified provider hardware but did not establish full approval or a paid response. [TDX hosting](TDX-DEPLOYMENT-STATUS.md) and funded confidential settlement remain incomplete. [GitHub CI](https://github.com/Agozie180/Neslos/actions/workflows/verify.yml) covers the exact pushed revisions.

## Earlier foundation-audit snapshot

The following counts, artifact and initial testnet snapshot are retained from the earlier [foundation audit](AUDIT-2026-11-06.md). They are historical; the current deployed artifact and later checks are linked above.

| Check | Result | Reproduce |
| --- | --- | --- |
| Application, policy, API, private runtime, SDK, owner recovery and cryptographic tests | **285 passed**, 0 failed/skipped across 29 files | `npm run verify` |
| Strict TypeScript, frontend and API/TEE compilation | **Passed** | `npm run verify` |
| Contract unit tests | **13 passed**, 0 failed | `npm run test:contract:unit` |
| Deployed local NEAR sandbox suite | **1 passed**, 0 failed; multiple real local transactions and receipts | `npm run test:contract` |
| Chromium desktop/mobile and source-selection tests | **6 passed**, 0 failed | `npm run test:browser` |
| Dedicated TEE image | Rebuilt and smoke-tested on **6 November**; restricted UID-1000 Linux/amd64 container refuses bootstrap private commands and rejects a fake quote | [Build and smoke commands](TEE-RUNBOOK.md#build-and-verify-locally) |
| Earlier main revision on a clean GitHub runner: application and contract jobs | **Both passed** at source commit `4739ce41fd2673b702411dad38a4cc5ae699c37d`; this predates the private owner/TEE changes | [Run 41702140067](https://github.com/Agozie180/Neslos/actions/runs/41702140067) |

Runtime: Node 24.22.2; Rust 1.93.0; cargo-near 0.22.0; near-sdk 5.29.0. The contract build and sandbox ran in WSL Ubuntu. Package versions and transitive resolutions are in the checked-in lockfiles.

Tests generate fresh reports and timestamps in `artifacts/`. Application/contract verification starts by invalidating the old success report and records a run ID, base revision and source-content digest. The WSL wrapper serializes workspace use and copies only changed outputs for the task it ran. Generated JSON reports are ignored by Git so a source checkout is not mistaken for a new verification run. The public testnet evidence in `deploy/` is retained with transaction hashes and the block at which final state was verified.

The 4 November owner-workspace build adds structured strategy vetoes, durable inference reservations, interrupted-paid-job protection, bounded scheduling, journal migration/segments and exact funding/storage plans. New owner browser tests use an explicit synthetic API transport; they do not establish live cloud execution. The container smoke check still reports `genuineHardwareVerified:false`. See [operation and recovery](OWNER-WORKSPACE.md).

## Contract artifact

```text
File:        artifacts/policy_vault.wasm
Size:        203266 bytes
Build:       host non-reproducible-wasm
SHA-256:     c15ce323dccfc8d7f8d026c1e9bc51f8ef383b61065cd4682b8579cae6a32c46
```

The sandbox deploys that compiled artifact and a minimal **test fixture token**. Its output includes:

```text
SANDBOX_EVIDENCE: recipient=150000000; failed_dispatch_restored=true; nonce=2; usage=150000000; paused=true; owner_recovered=50000000; real_funds=false
```

The test asserts balances and state after each operation. The terminal line alone is not proof; [test source](../contracts/policy-vault/tests/sandbox.rs), artifact and reproducible execution are the evidence. The 6 November run completed in 104.666 seconds, including builds, 13 unit tests and the sandbox. This is a single-run measurement. The new contract rejects stale/missing resume versions and preserves unconditional emergency pause; it changes the WASM hash without changing state layout or authorization wire format.

## Public testnet proof

The owner-controlled [vault.neslos.testnet](https://testnet.nearblocks.io/address/vault.neslos.testnet) uses [token.neslos.testnet](https://testnet.nearblocks.io/address/token.neslos.testnet), a minimal fixture token. [Deployment evidence](../deploy/testnet.json) records the original transactions and code. At the earlier foundation-audit snapshot, the downloaded vault SHA-256 was `196460a40676c7901143a9adf63ce61f63e25bf862e0acb4d9d51ff491e32b73`. The later [state-preserving upgrade](../deploy/testnet-upgrade-20261106.json) supersedes that code and includes the resume fix. Earlier timeout observations are historical; the new proof has its own finalized receipt checks.

[Proof evidence](../deploy/testnet-proof.json), finalized on 3 November at `2026-11-03T17:32:18.128Z`, contains 12 transaction links. Four expected rejections are recorded as failed chain transactions; that is the successful result of those negative tests.

| Operation | Verified outcome |
| --- | --- |
| Allow 150 test tokens | Recipient received 150; daily usage became 150 |
| Request 201 / replay the first authorization | Rejected with `PER_ACTION_LIMIT` / `NONCE`; no extra spending |
| Transfer to an unregistered account | FT dispatch failed; allowance restored; nonce advanced to 2 |
| Lower daily cap below existing usage | Usage stayed 150; further spending rejected with `DAILY_LIMIT` |
| Restore policy and record settlement | Usage retained; the first record became `Settled` |
| Pause and attempt another authorization | Rejected with `PAUSED` |
| Owner recovery | 50 tokens returned to owner; final vault balance 800, owner balance 200 |

Final state at the recorded block: paused, policy version 5, nonce 2, daily usage 150 and remaining allowance 350. The proof recovered from an RPC interruption by reconciling the original transaction hashes before continuing. Local tests cover transport retries, saved-transaction conflicts, unresolved outcomes, concurrent submission, and invalid proof checkpoints.

This uses a local executor key and public routing. It does not claim TEE execution, private recipients, real USDC, or a 1Click settlement. The default browser remains a separate rehearsal; the local owner workspace supports real chain reads and reviewed private operations when configured. [Owner CLI and recovery instructions](DEPLOYMENT.md#owner-testnet-cli).

## What the tests establish

| Boundary | Evidence |
| --- | --- |
| Exact budget and shared allowance | Canonical integer inputs, u128 boundaries, concurrent proposals, policy updates preserving usage |
| Exact authorization | Shared Rust/TypeScript Borsh digest; field substitution, replay, wrong network and stale policy rejection |
| Failure accounting | Real failed FT transfer; callback caller protection; original UTC day refund; oversized success stays charged |
| Owner authority | Non-owner policy changes rejected; pause prevents spending; recovery sends only to owner |
| Private routing | Unsigned quote refusal; official SDK hash-coverage checks for recipient type, recipient and output minimum |
| Attestation boundary | Binding fixture tests for nonce, keys, all pinned measurements and debug mode; malformed quotes rejected by the real verifier |
| Encrypted channel | RFC 9180 HPKE round trip; wrong key, context and altered ciphertext rejection |
| Private runtime | Allowed output-asset selection, policy/nonce changes, queued expiry, signed prepare/observe results, durable restart/idempotency and stopping after journal I/O failure; external services are fixtures |
| Published SDK boundaries | NEAR RPC encoding/decoding against fixture responses, 1Click Ed25519 verification with a test signer, dstack Unix socket protocol, and rejection of a fake quote by the real DCAP verifier |
| Verification tooling | Failed subprocesses replace old success; unrelated tasks and unchanged cached artifacts cannot overwrite newer evidence |
| Private owner workflow | Actual HPKE client/runtime exchange against fixture hardware/services; lost reply recovery, checkpoint-bound multi-page audit export, signed receipt opening, and bounded rate-limit retry |
| Private transaction workflow | Exact signed-call reconstruction; substituted receiver/amount rejected; plan hash/mainnet opt-in; changed policy rejection; saved transaction reconciliation after timeout |
| Private research | Testnet research produces no quote or authorization; fixture NEAR AI orchestration requires encrypted requests, provider-TEE signatures and known market references |
| Audit | AES-GCM, Ed25519 and hash-chain checks; tamper/reorder/truncation rejection against retained evidence; journal restore |
| Browser/API | Cross-session isolation, CSRF/origin checks, blocked/allowed flow, preserved allowance, browser verification, mobile layout and a late live response unable to overwrite selected reference data |

The attestation binding fixture is **not a genuine Intel quote**. Passing those tests establishes rejection/binding behavior, not a hardware deployment. Browser screenshots in `artifacts/` were inspected at desktop and mobile widths; the browser tests report no uncaught errors in the complete mission flow and no horizontal overflow in the mobile checks.

## Live integration observations

- The Rhea feed was queried successfully. The retained 1 November response contains 18 raw markets; 10 pass the supported-token normalizer. Rhea does not provide an upstream observation timestamp.
- The 1Click confidential dry quote probe returned **HTTP 401 without `ONECLICK_JWT`**. A verified live quote has not been obtained here.
- Official 1Click SDK 0.1.26 excludes `confidentiality` from its signed subset. Neslos requires the signed `CONFIDENTIAL_INTENTS` recipient type. [Regression tests](../tests/intents.test.ts) reproduce that distinction.
- The live npm production audit reports three low-severity package entries stemming from one transitive `elliptic` advisory. See [security notes](../SECURITY.md).

## Evidence still required for live claims

The testnet owner vault and fixture-token proof are deployed. There is still no provisioned Neslos TDX instance, independently approved live measurement set, verified live NEAR AI response, funded Intents deposit or mainnet settlement receipt. The TEE process prepares calls; the private owner CLI can submit an explicitly reviewed plan. Both the earlier rehearsal Docker build and the new TEE image build passed. Its negative hardware test must report `genuineHardwareVerified:false`. GitHub CI status is tracked in [STATUS](STATUS.md).

The next validation stage is to provision the reviewed private runtime, verify its identity independently, pin that key in an owner-controlled vault, obtain an authenticated signed quote, and explicitly authorize a bounded funded demonstration. Keep public-chain and provider visibility disclosures in that demonstration. See [deployment](DEPLOYMENT.md) and [privacy](PRIVACY.md).
