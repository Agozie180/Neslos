> **What it is:** Neslos is a vault workflow in which three research agents assess opportunities, a strategist proposes an action, a deterministic guardian checks the owner's policy, and a NEAR vault enforces that policy.
> **What is real:** NEAR testnet has public vault limit/replay receipts and a separate owner-wallet Rhea supply/withdrawal cycle with fake USDC. NEAR mainnet has a separate 0.001 NEAR owner-wallet Confidential Intents round trip whose 0.004 NEAR fee cap failed.
> **What is simulated:** The public and local rehearsal use simulated funds and a reference market capture dated 1 November 2026.
> **What is not proven:** The real Rhea cycle used `neslos.testnet` directly rather than `vault.neslos.testnet`; no mainnet Neslos vault, no single private research → vault → settlement transaction, and no independently measured model-weight bytes.

# Neslos

[![Verify Neslos](https://github.com/Agozie180/Neslos/actions/workflows/verify.yml/badge.svg?branch=main)](https://github.com/Agozie180/Neslos/actions/workflows/verify.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tests: 645 passed](https://img.shields.io/badge/tests-645%20passed-brightgreen.svg)](docs/PROOF.md)
[![NEAR testnet](https://img.shields.io/badge/NEAR-testnet-00c08b.svg)](docs/VAULT-COMMERCE-DEPLOYMENT-2026-11-06.md)
[![NEAR mainnet](https://img.shields.io/badge/NEAR-mainnet-000000.svg)](docs/CONFIDENTIAL-SETTLEMENT-2026-11-09.md)
[![Rhea funded cycle](https://img.shields.io/badge/Rhea-funded%20cycle-4c6ef5.svg)](docs/RHEA-TESTNET-VALIDATION-2026-11-12.md)
[![Phala Intel TDX](https://img.shields.io/badge/Phala-Intel%20TDX-6f42c1.svg)](docs/TDX-DEPLOYMENT-STATUS.md)
[![NEAR AI private research](https://img.shields.io/badge/NEAR%20AI-private%20research-00c08b.svg)](docs/NEAR-PRIVATE-RESEARCH-2026-11-09.md)

NEAR HACKATHON: Security · Privacy · DeFi · Swarms

[Live rehearsal](https://neslos.vercel.app) · [90-second path](#try-it-in-90-seconds) · [Demo video](artifacts/neslos-demo.webm) · [Claims → evidence](#claims--evidence) · [Reproduce](#reproduce) · [Current status](docs/STATUS.md)

![Neslos control room showing a rejected overspend, a completed $150 rehearsal, and $350 remaining](docs/images/control-room.png)

## Try it in 90 seconds

Open [neslos.vercel.app](https://neslos.vercel.app).

1. Open **Policy vault**. The default policy is $500 per day, $200 per action, and 50 bps maximum slippage.
2. Return to **Control room** and select **Use the reproducible reference dataset**.
3. Select **Overspend**. The $501 request is rejected and the allowance remains $500.
4. Run the **$150 allocation reserve**. The rehearsal completes and the allowance becomes $350.
5. Open **Evidence room** and follow the finalized Rhea [supply transaction](https://testnet.nearblocks.io/txns/6Fsge4MMh4Y936XujgLo8N69xWouu7tgAbzDSJ4FGDRV) and [withdrawal transaction](https://testnet.nearblocks.io/txns/J8xQfmf8xxPMYMGauqz54XQkSUXB6jkXWfWWyAqCgm7x). The funded NEAR testnet cycle supplied 0.1 fake USDC and returned the full principal to `neslos.testnet`.
6. Open **Audit trail**, select **Verify integrity**, then **Test a tampered copy**. The original verifies and the tampered copy is rejected.

The `$150` challenge and the funded Rhea cycle are separate records. The challenge reproduces the policy and audit behavior; the Rhea transactions are the real lending execution on NEAR testnet. The same path is available locally at `http://127.0.0.1:5173/#challenge` after `npm run dev`. [Demo video](artifacts/neslos-demo.webm).

## Claims → evidence

This table contains the factual project claims made in this README. Dated records remain separate when they used different networks, assets, custody paths, or execution environments.

| Claim | Network | Exact file or tx link | Command to reproduce |
| --- | --- | --- | --- |
| Neslos implements three research roles, a strategist, a deterministic guardian, and a policy-enforcing vault. | Source/local, no chain | [Research roles](src/core/research.ts) · [Strategy](src/core/strategy.ts) · [Guardian](src/core/policy.ts) · [Vault](contracts/policy-vault/src/lib.rs) | `npm run verify` |
| The public and local application are a rehearsal with simulated funds. | Local/Vercel, no chain | [Rehearsal server](src/server/index.ts) · [Boundary test](tests/e2e/challenge.spec.ts) | `npm run verify:boundary` |
| The reproducible market capture is dated 1 November 2026. | Reference data, no chain | [Rhea fixture](fixtures/rhea-2026-11-01.json) | `npm run verify:evidence` |
| The default rehearsal policy is $500/day, $200/action, and 50 bps maximum slippage. | Local/Vercel, no chain | [Default policy](src/core/policy.ts) | `npm run verify:evidence` |
| The Boundary challenge rejects $501 and leaves $500 available. | Local/Vercel, no chain | [Boundary test](tests/e2e/challenge.spec.ts) | `npm run verify:boundary` |
| The Boundary challenge allows $150 and leaves $350 available. | Local/Vercel, no chain | [Boundary test](tests/e2e/challenge.spec.ts) | `npm run verify:boundary` |
| The original rehearsal audit history verifies in the browser. | Local/Vercel, no chain | [Browser verifier](src/web/verify.ts) · [Boundary test](tests/e2e/challenge.spec.ts) | `npm run verify:boundary` |
| A tampered rehearsal audit copy is rejected in the browser. | Local/Vercel, no chain | [Browser verifier](src/web/verify.ts) · [Boundary test](tests/e2e/challenge.spec.ts) | `npm run verify:boundary` |
| Security: the vault completed an allowed fixture-token payment. | NEAR testnet | [Allowed payment tx](https://testnet.nearblocks.io/txns/AtQ8joUuaVkeZsukPj6HLTaE5qj7ApMBFyNTJ3mWLNgX) · [Record](deploy/testnet-commerce-proof-20261106.json) | `npm run verify:evidence` |
| Security: the vault rejected a payment that exceeded the remaining daily limit. | NEAR testnet | [Daily-limit rejection tx](https://testnet.nearblocks.io/txns/2MYWSFeJPo5zs3oRGnKx1UM186Tu52gskNG74NwNsgnN) · [Record](deploy/testnet-commerce-proof-20261106.json) | `npm run verify:evidence` |
| Security: the vault rejected replay of an earlier authorization. | NEAR testnet | [Replay rejection tx](https://testnet.nearblocks.io/txns/HkWPdR8g1KRRKtFZxwqNCcFcYir9ZdHdSb9YXYruH3JK) · [Record](deploy/testnet-commerce-proof-20261106.json) | `npm run verify:evidence` |
| DeFi: `neslos.testnet` supplied 0.1 fake USDC to Rhea and received the full principal on withdrawal; this was an owner-wallet cycle, not vault custody. | NEAR testnet | [Supply tx](https://testnet.nearblocks.io/txns/6Fsge4MMh4Y936XujgLo8N69xWouu7tgAbzDSJ4FGDRV) · [Withdraw tx](https://testnet.nearblocks.io/txns/J8xQfmf8xxPMYMGauqz54XQkSUXB6jkXWfWWyAqCgm7x) · [Record](deploy/rhea-funded-cycle-20261112/record.json) | `npm run verify:rhea` |
| Privacy: three private research agents returned signed reports covering two live markets inside independently verified Intel TDX. | NEAR AI, no chain transaction | [Research result](deploy/near-private-research-20261109/research-proof.json) · [Verification record](deploy/near-private-research-20261109/record.json) | `npm run verify:evidence` |
| Privacy: the private research result survived restart and another job was rejected after the inference allowance was exhausted. | NEAR AI, no chain transaction | [Restart result](deploy/near-private-research-20261109/restart-proof.json) | `npm run verify:evidence` |
| Privacy: the reviewed policy trusts provider administration of routing, runtime, and model weights; loaded model-weight bytes were not independently proved. | NEAR AI, no chain transaction | [Trust field and archive](deploy/near-private-research-20261109/record.json) · [Trust review](docs/MODEL-DEPLOYMENT-AUDIT-2026-11-09.md) | `npm run verify:evidence` |
| Swarms: three specialist research reports feed a strategist whose constraints can narrow or veto a proposal. | Source plus NEAR AI archive, no chain transaction | [Research result](deploy/near-private-research-20261109/research-proof.json) · [Strategy constraints](src/core/strategy.ts) | `npm run verify:evidence` |
| A separate owner-wallet Confidential Intents round trip returned 0.001 native NEAR to the original owner. | NEAR mainnet | [Return tx](https://nearblocks.io/txns/C4o7c1XW35uHmrSmffYGMHaEfxyJEFZ6qdAspqQmipJB) · [Result](deploy/confidential-settlement-20261109/result.json) | `npm run verify:evidence` |
| The same mainnet round trip charged 0.0071149895375 NEAR against a stated 0.004 NEAR cap, so the fee-cap result failed. | NEAR mainnet | [Result](deploy/confidential-settlement-20261109/result.json) · [Report](docs/CONFIDENTIAL-SETTLEMENT-2026-11-09.md) | `npm run verify:evidence` |
| A mainnet Neslos vault, one bound private research → vault → settlement transaction, and a vault-custodied Rhea cycle remain unproved. | Cross-environment boundary | [Integrated review](docs/INTEGRATED-PAYMENT-REVIEW-2026-11-12.md) | `npm run verify:evidence` |
| The 6 November commerce record is a version 9 snapshot; four later governance transactions restored the same testnet vault at version 13 without changing balances, nonce, or consumption. | NEAR testnet | [Commerce snapshot](deploy/testnet-commerce-proof-20261106.json) · [Restoration record](deploy/near-private-research-20261109/vault-restoration.json) | `npm run verify:evidence` |
| Source revision `dc529f0d7c882c3cc91a81b0fd7d01e509b15c78` passed 645 tests with five platform-specific skips, strict TypeScript checks, and production web/server builds on 12 November 2026. | Local/GitHub CI, no chain | [Commit checks](https://github.com/Agozie180/Neslos/commit/dc529f0/checks) · [Verification record](docs/PROOF.md) | `npm run verify` |
| The required local Node version is 24.22.2. | Local, no chain | [.node-version](.node-version) · [Package engine](package.json) | `node --version` |

## Reproduce

Use exactly **Node 24.22.2**. The pin is stored in [.node-version](.node-version), `package.json`, and `package-lock.json`.

```sh
git clone https://github.com/Agozie180/Neslos.git
cd Neslos
nvm install 24.22.2
nvm use 24.22.2
node --version
npm ci
npx playwright install chromium
```

Expected setup results:

| Command | Expected output or result |
| --- | --- |
| `node --version` | Exactly `v24.22.2` |
| `npm ci` | Exit code 0; dependencies are installed from `package-lock.json` without changing it |
| `npx playwright install chromium` | Exit code 0; Chromium is installed or already present |

Run the deterministic checks:

```sh
npm run verify:boundary
npm run verify:evidence
npm run verify
npm run verify:rhea
```

Expected results:

| Command | Expected output |
| --- | --- |
| `npm run verify:boundary` | Final line exactly: `BOUNDARY_RESULT $501=rejected $150=allowed remaining=$350 original=verified tamper-test=failed-as-expected` |
| `npm run verify:evidence` | One `README_EVIDENCE` JSON line with `node:"24.22.2"`, testnet vault/Rhea fields, `researchers:3`, `loadedWeightBytesProven:false`, mainnet `principalNear:"0.001"`, and `feeCapPassed:false` |
| `npm run verify` | `Test Files 46 passed \| 2 skipped (48)` and `Tests 645 passed \| 5 skipped (650)`; TypeScript and production web/server builds exit 0 |
| `npm run verify:rhea` | JSON containing `"ok": true`, `"readOnly": true`, `"network": "testnet"`, and `"fullyReturned": true`; this command needs access to the NEAR testnet RPC |

For the interactive local rehearsal:

```sh
npm run dev
```

Expected startup output includes `Neslos rehearsal API: http://127.0.0.1:8787` and Vite's `http://127.0.0.1:5173` URL. Open `http://127.0.0.1:5173/#challenge`. The health endpoint at `http://127.0.0.1:8787/api/health` reports `mode: "rehearsal"` and `realFunds: false`.

## Documentation

| Document | Contents |
| --- | --- |
| [Status](docs/STATUS.md) · [Verification record](docs/PROOF.md) | Current evidence, dated checks, and remaining boundaries |
| [Architecture](docs/ARCHITECTURE.md) · [Vault specification](contracts/policy-vault/README.md) | Components, trust boundaries, and contract invariants |
| [90-second demo](docs/DEMO.md) · [Competition package](docs/SUBMISSION.md) | Rehearsal path, recording, and submission materials |
| [Rhea evidence reproduction](docs/JUDGE-RHEA-REPRODUCTION.md) | Credential-free, read-only verification of the funded testnet receipts |
| [Private research report](docs/NEAR-PRIVATE-RESEARCH-2026-11-09.md) · [Privacy boundaries](docs/PRIVACY.md) | TDX evidence and declared trust assumptions |
| [Deployment](docs/DEPLOYMENT.md) · [TEE runbook](docs/TEE-RUNBOOK.md) | Local checks and optional private-session procedures |
