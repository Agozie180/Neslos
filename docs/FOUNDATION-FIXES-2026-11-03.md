# Foundation fixes — 3 November 2026

Historical fix record. The subsequent [private owner/TEE work](TEE-RUNBOOK.md) implements the owner CLI, audit operations and deployment package; [STATUS](STATUS.md) contains current verification counts and remaining gaps.

The [foundation audit](AUDIT-2026-11-03.md) found four reproducible defects. All four are fixed locally on `main`, based on `4739ce41fd2673b702411dad38a4cc5ae699c37d`. This work preserves the existing vault and adds regression coverage around the private runtime and published SDKs. It does not complete the original private multi-agent product.

## Changes and evidence

| Finding | Change | Verification |
| --- | --- | --- |
| F1: selecting a prohibited output before considering allowed alternatives | Rank with the on-chain output-asset allowlist and include exclusion reasons; pass the same eligibility set to research | Runtime selects lower-ranked allowed USDT over prohibited USDC; no eligible asset fails before quote acquisition |
| F2: `KNOWN_DEPOSIT_TX` becomes unknown | Map it to pending; use a `Map` so unexpected status names cannot resolve JavaScript prototype properties | All documented statuses, an unknown status, `__proto__`, malformed/mismatched evidence and transport failure |
| F3: non-login WSL chooses old Cargo | Put rustup's Cargo on the Linux PATH | Full contract build, 12 unit tests and sandbox suite pass through the previously failing wrapper invocation |
| F4: stale cached evidence overwrites fresh reports | Limit copies to changed task outputs; invalidate old application/contract success before checking; record failures, run IDs and source identity; lock the shared Linux workspace | Subprocess failure regressions and stale-copy tests; unit-only contract checks no longer attribute an old WASM |
| Token discovery rejects documented nullable metadata | Accept null `contractAddress`; retain exact asset ID, chain and decimal checks | Mixed token-list fixture passes without using contractAddress as asset authority |
| Journal I/O failure leaves tentative state in memory | Sync the journal directory on Linux; stop further commands after persistence fails and recover through restart | Actual filesystem failure produces no authorization response; later commands are refused until restart |
| Authenticated requests can expire in the queue | Check expiry again when execution starts | A barrier-controlled queued request expires and produces no second quote |

Regression sources: [runtime](../tests/runtime.test.ts), [1Click integration](../tests/intents-integration.test.ts), [tooling](../tests/tooling.test.ts), [NEAR SDK](../tests/near-sdk.test.ts), [dstack SDK](../tests/dstack-sdk.test.ts). Quote signatures use a public deterministic **test-only** identity; production verification still uses the official provider key.

## Verification in Ubuntu WSL

Run from this Windows checkout, one command at a time:

```powershell
wsl.exe -d Ubuntu --exec bash /mnt/c/Users/USER/Neslos/scripts/ubuntu.sh verify
wsl.exe -d Ubuntu --exec bash /mnt/c/Users/USER/Neslos/scripts/ubuntu.sh test:browser
wsl.exe -d Ubuntu --exec bash /mnt/c/Users/USER/Neslos/scripts/ubuntu.sh test:contract
```

| Check | Observed result |
| --- | --- |
| Application verification | 141 tests across 13 files; 0 failures; strict TypeScript, frontend and server/TEE/owner builds pass |
| Browser verification | 3 Chromium tests pass; desktop and mobile screenshots inspected |
| Contract verification | 12 unit tests and 1 real local NEAR sandbox suite pass; virtual balances only |
| Vault WASM | 202344 bytes; SHA-256 `196460a40676c7901143a9adf63ce61f63e25bf862e0acb4d9d51ff491e32b73` |

The latest application run finished at `2026-11-03T20:05:47.601Z`, run ID `67aa6ed9-03ec-4fc3-9050-25cf473c67a6`. The browser wrapper finished at `2026-11-03T20:06:51.544Z`, run ID `a86b7aae-80e0-4dfe-8fc9-cd855607d691`. Both recorded source-content digest `29b2cbdd8a97d37d2840c7c277ae7895488dae934a3cbf200b087ca318ee8cc4`.

The contract run finished at `2026-11-03T19:59:36.019Z`, run ID `7a7d0126-9be4-4e0b-ba4f-bcbd7ad06fd9`. Its source digest differs because it preceded the queued-expiry test and formatting changes; contract sources and tooling did not change afterwards. Reports remain in ignored `artifacts/`. The source digest covers code, tests and selected build inputs, not documentation or private configuration; it is local provenance, not hardware attestation or proof of a reproducible build. The earlier green GitHub CI run does not verify this unpushed working tree.

## NEAR and TEE SDK assessment

The pinned integrations already use the relevant published SDKs:

| SDK | What was exercised | What remains unverified |
| --- | --- | --- |
| `near-api-js` 7.4.0 | Real transport/decoding with fixture RPC responses; finalized block pinning and invalid state rejection. Existing public testnet proof is separate evidence. | Owner-operated private runtime transaction workflow |
| `@defuse-protocol/one-click-sdk-typescript` 0.1.26 | Real quote hashing and Ed25519 verification with a test signer; binding, amount/floor, time, memo and settlement checks | Successful live signed confidential quote and funded settlement |
| `@phala/dstack-sdk` 0.5.8 | Published SDK against a local Unix socket fixture; key purposes and exact challenge/key report-data binding | Genuine hardware key derivation and quote issuance |
| `@phala/dcap-qvl` 0.7.0 | Real verifier rejects fake quote bytes and prevents runtime startup | Acceptance of a genuine fresh quote with independently established measurements |
| `@nearai/inference-sdk` 0.2.1 | Existing encrypted/verified research adapter remains in place; runtime tests exercise inference failure using fixtures | Verified live encrypted inference; real researcher orchestration coverage |

The literal `near/TEEs` GitHub endpoint returned 404 in this review, so no package by that name was assumed. The official [NEAR AI private-ml-sdk](https://github.com/nearai/private-ml-sdk) describes self-hosted confidential inference requiring an Intel TDX host and compatible NVIDIA confidential GPU, with dstack-vmm recommended. It is deployment infrastructure, not a way to turn this ordinary WSL instance into a TEE.

This Ubuntu environment has neither `/var/run/dstack.sock` nor `/dev/tdx_guest`. Tests establish protocol and rejection behavior, not successful hardware attestation. The 1Click provider still receives routing information; Neslos does not attest the provider's computation.

## Remaining work in dependency order

1. Build the owner private client and authenticated audit export/open: verified endpoint configuration, encrypted prepare/observe, transaction review, durable submission/reconciliation, policy/pause/recovery, and receipt verification. Each new settlement poll needs a fresh ID; retrying the same request retains its ID.
2. Package the private runtime with persistent storage, reviewed image and measurement establishment, then provision genuine hardware and capture verified NEAR AI evidence. A responding socket or copied example measurements cannot establish trust.
3. Obtain a live signed confidential quote, establish owner control of the recipient, and demonstrate dispatch/settlement within an explicitly authorized spending bound. Testnet remains eligible for the hackathon; 1Click has no testnet.
4. Make structured research findings affect strategy within deterministic constraints, and connect the interface to real policy/runtime/settlement evidence. Current model reports do not control selection.
5. Implement actual lending deposits/withdrawals and position accounting to earn the discovered yield. Allocation reserves alone do not do this. Scheduling, paid external agents and total operating-cost caps also remain unfinished.
6. Prepare public source, a reproducible demo/video and the required submission with accurate evidence and human details.

No public-chain transaction, infrastructure provisioning, push, publication or submission was performed during these fixes.
