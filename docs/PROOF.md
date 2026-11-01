# Verification record

Recorded **1 November 2026** in the local Windows/WSL workspace. These are local test results, not live deployment or hardware evidence.

| Check | Result | Reproduce |
| --- | --- | --- |
| Application, policy, API and cryptographic tests | **76 passed**, 0 failed across 7 files | `npm run verify` |
| Strict TypeScript, frontend and API/TEE compilation | **Passed** | `npm run verify` |
| Contract unit tests | **12 passed**, 0 failed | `npm run test:contract:unit` |
| Deployed local NEAR sandbox suite | **1 passed**, 0 failed; multiple real local transactions and receipts | `npm run test:contract` |
| Chromium desktop/mobile and source-selection tests | **3 passed**, 0 failed | `npm run test:browser` |

Runtime: Node 24.22.2; Rust 1.93.0; cargo-near 0.22.0; near-sdk 5.29.0. The contract build and sandbox ran in WSL Ubuntu. Package versions and transitive resolutions are in the checked-in lockfiles.

The successful application verification was recorded at `2026-11-01T18:12:22.051Z`; the full contract verification at `2026-11-01T17:40:50.041Z`. Tests generate fresh reports in `artifacts/`. Those generated reports are ignored by Git so a source checkout is not mistaken for a new verification run.

## Contract artifact

```text
File:        artifacts/policy_vault.wasm
Size:        202344 bytes
Build:       host non-reproducible-wasm
SHA-256:     196460a40676c7901143a9adf63ce61f63e25bf862e0acb4d9d51ff491e32b73
```

The sandbox deploys that compiled artifact and a minimal **test fixture token**. Its output includes:

```text
SANDBOX_EVIDENCE: recipient=150000000; failed_dispatch_restored=true; nonce=2; usage=150000000; paused=true; owner_recovered=50000000; real_funds=false
```

The test asserts balances and contract state after each operation. The terminal line alone is not the proof; the [test source](../contracts/policy-vault/tests/sandbox.rs), compiled artifact and reproducible execution are the evidence. The sandbox test took 87.89 seconds in this run; total build and contract test time was 185.30 seconds. These are single-run measurements, not performance benchmarks.

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
| Audit | AES-GCM, Ed25519 and hash-chain checks; tamper/reorder/truncation rejection against retained evidence; journal restore |
| Browser/API | Cross-session isolation, CSRF/origin checks, blocked/allowed flow, preserved allowance, browser verification, mobile layout and a late live response unable to overwrite selected reference data |

The attestation binding fixture is **not a genuine Intel quote**. Passing those tests establishes rejection/binding behavior, not a hardware deployment. Browser screenshots in `artifacts/` were inspected at desktop and mobile widths; the browser tests report no uncaught errors in the complete mission flow and no horizontal overflow in the mobile checks.

## Live integration observations

- The Rhea feed was queried successfully. The retained 1 November response contains 18 raw markets; 10 pass the supported-token normalizer. Rhea does not provide an upstream observation timestamp.
- The 1Click confidential dry quote probe returned **HTTP 401 without `ONECLICK_JWT`**. A verified live quote has not been obtained here.
- Official 1Click SDK 0.1.26 excludes `confidentiality` from its signed subset. Neslos requires the signed `CONFIDENTIAL_INTENTS` recipient type. [Regression tests](../tests/intents.test.ts) reproduce that distinction.
- The live npm production audit reports three low-severity package entries stemming from one transitive `elliptic` advisory. See [security notes](../SECURITY.md).

## Evidence still required for live claims

There is no provisioned TDX instance, independently approved live measurement set, verified live NEAR AI response, deployed owner vault, funded Intents deposit or mainnet settlement receipt in this workspace. The TEE process prepares calls; it does not submit them. Docker and GitHub CI have not run here.

The next validation stage is to provision the reviewed private runtime, verify its identity independently, pin that key in an owner-controlled vault, obtain an authenticated signed quote, and explicitly authorize a bounded funded demonstration. Keep public-chain and provider visibility disclosures in that demonstration. See [deployment](DEPLOYMENT.md) and [privacy](PRIVACY.md).
