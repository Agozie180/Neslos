# Neslos roadmap

Updated **9 November 2026**.

Neslos is being built into an owner-controlled agent treasury: private research, explicit spending rules, and payments whose outcome the owner can verify. The next engineering priority is to connect the separately verified components into one complete workflow while preserving the vault's spending limits and recovery guarantees.

This roadmap records planned work and the evidence required to call it complete. [Current status](docs/STATUS.md) and the [verification record](docs/PROOF.md) identify what has already been demonstrated. Post-hackathon milestones are ordered by dependency; their dates depend on validation results, provider support and available resources.

## Foundation already demonstrated

| Capability | Evidence and scope |
| --- | --- |
| Usable control room | [Live rehearsal](https://neslos.vercel.app): blocked overspending, an allowed mission and browser audit verification; simulated funds |
| Spending enforcement on NEAR | [Testnet vault proof](docs/VAULT-COMMERCE-DEPLOYMENT-2026-11-06.md): real receipts, shared limits, replay rejection and preserved state across upgrades |
| Private agent research | [Three signed researcher reports inside verified TDX](docs/NEAR-PRIVATE-RESEARCH-2026-11-09.md), with encrypted audit, restart persistence and exhausted-budget rejection |
| Confidential provider round trip | [Full 0.001 NEAR principal returned](docs/CONFIDENTIAL-SETTLEMENT-2026-11-09.md). Native charges exceeded the stated cap; this establishes the owner-wallet route, with a failed cost-control check |

## Delivery milestones

### 1. Publish a reproducible hackathon release

**Target: 14 November 2026, 23:59 UTC.**

- Publish the reviewed source and complete the recorded demonstration and human-published X post.
- Finalize team/contact details, payout account, track selection and consent, then submit the reviewed application once.
- Keep the public rehearsal accessible through judging, with the dated private-research and chain evidence linked alongside it.

**Complete when:** a reviewer can follow the README from a fresh checkout, reproduce the blocked/allowed demo and audit checks, and reach the evidence supporting each submitted claim. Retain the public post URL and submission confirmation. [Submission checklist](docs/DEMO.md#submission-preparation).

### 2. Correct native-fee estimation before another funded run

**Next engineering priority.**

Include current protocol account-creation charges, gas pricing and applicable storage costs in native-transfer preflight. Refuse signing when the maximum cost cannot be established within the owner's cap. The previous round trip cost **0.0071149895375 NEAR against a 0.004 NEAR cap**; the estimate omitted account-creation charges.

**Complete when:** regression cases cover existing and newly created destinations, changed protocol costs and insufficient fee allowance. The retained failed-cap case must be rejected before signing. Any later funded check must reconcile the estimate with finalized charges without increasing its cap after execution.

### 3. Validate the live owner browser

Exercise the local owner workspace against a freshly verified private runtime: executor verification, research, signed audit opening and recovery after a connection interruption. Preserve the original request ID when recovering work.

**Complete when:** a dated browser run demonstrates these operations, rejects the wrong owner and exhausted inference allowance, and records no duplicate inference charge during recovery. Use a finite TDX session and retire it afterward. Existing owner-browser tests use fixtures; the completed live research proof used the client/CLI.

### 4. Prove one complete private-vault payment

After fee preflight and owner-browser validation, exercise research → proposal → guardian → attested authorization → mainnet vault dispatch → settlement observation → encrypted audit using a separately reviewed, tightly bounded payment.

**Complete when:** retained evidence binds the same operation across those stages and reconciles vault allowance and principal. For a route ending in a private ledger, label private credit as provider testimony and verify a finalized public withdrawal receipt for the recovery leg. Policy violations must stop before dispatch; interrupted submission must recover the saved transaction without a replacement payment. Provider status alone is insufficient proof of delivery.

### 5. Validate a funded Rhea lending cycle

Use an explicitly public policy for a small supply and withdrawal through the vault's existing owner-commerce path.

**Complete when:** position-share changes and exact token-transfer receipts establish both directions, the shared allowance remains enforced, and a confidential policy rejects the public lending operation. An allocation reserve remains distinct from a lending position. [Commerce design](docs/COMMERCE.md).

### 6. Meet the conditions for a broader custody pilot

Resolve or replace the [known transitive dependency advisory](SECURITY.md) with a tested solution, commission an independent security review, and close material findings. Exercise backup restoration, retained-checkpoint verification, key rotation, emergency pause and transaction recovery under failure.

**Complete when:** review findings and their resolution are documented, recovery drills preserve accounting and audit history, and the pilot has explicit operating limits and a costed hosting plan. The hackathon proof does not establish these conditions.

## Integrations that depend on external support

- **Agent Market:** enable paid jobs only after a supported payment rail can enforce the Neslos vault's policy. Its current wallet-delegate rail is incompatible and remains disabled.
- **Stronger model identity:** investigate independently measured model weights and effective runtime identity. Completion requires verifiable provider evidence or a reviewed immutable deployment. The current NEAR AI policy explicitly trusts provider administration; the Tinfoil investigation is not an integrated backend.
- **Additional spending assets:** consider expansion after the fixed-token payment and recovery path is proved. Each asset needs explicit units, accounting rules and integration evidence.

## How progress will be recorded

Each completed milestone should link its reviewed revision, relevant checks, dated live evidence, actual costs and remaining limitations in [STATUS.md](docs/STATUS.md). Failed checks remain visible. Live verification uses finite hosting windows and separate reviewed budgets for hosting, inference and transactions. The public demo and archived proof remain reviewable without continuous TDX rental.
