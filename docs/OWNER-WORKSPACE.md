# Local owner workspace

`npm run owner` starts the owner application on **127.0.0.1:8788** and prints a private startup link. Open that link on the same computer. The `/owner` application reads real finalized vault state and works with the approved private runtime. The public application at `/` remains a separate rehearsal.

Run `npm run build` first. The owner server needs the built web assets and Node 24.22.2. On this Windows workspace the npm wrapper selects the compatible local Node. When using WSL, private files stay in the Linux checkout; the WSL wrapper deliberately does not sync credentials or private state.

**Verification status, 9 November 2026:** private client/CLI research, encrypted audit and restart persistence passed inside independently verified TDX. The temporary server was deleted after the completed proof to stop hosting charges. The [evidence archive](NEAR-PRIVATE-RESEARCH-2026-11-09.md) remains available for review; continuous TDX hosting is outside the demo's operating plan. Browser controls have automated fixture coverage, with live owner-browser validation still separate.

## Connect the owner

For an optional new live private session, follow the [TEE runbook](TEE-RUNBOOK.md#provision-and-establish-trust) to deploy a CPU TDX runtime for a finite budgeted window, independently approve its measurements, and initialize `.private/tee/runtime.json`. Create `.private/tee/owner-token.json` with `npm run private -- new-token --out .private/tee/owner-token.json`; provision the same token through the platform's encrypted secrets. The default unconfigured dashboard can inspect the public testnet vault without a TDX deployment.

Create `.private/tee/contacts.json` with the intended venues and recipients:

```json
{
  "venues": ["near-intents", "rhea-lending"],
  "counterparties": [{"name": "Research partner", "recipient": "ACTUAL_RECIPIENT.near"}]
}
```

Replace the example recipient with a real approved account. Generate independent secret salts:

```sh
npm run private -- openings --request .private/tee/contacts.json --out .private/tee/openings.json
```

The command refuses to overwrite existing openings. Retain this file: new salts produce different commitments. Use the printed commitment arrays in an owner policy plan through the private CLI before sending research/payment commands. The dashboard keeps existing commitment arrays when changing limits.

For signing, set `NESLOS_OWNER_CREDENTIALS_FILE` to the absolute path of the owner's NEAR credential JSON before starting `npm run owner`. Account keys stay in the local signer; they are never sent to the browser, researchers or TEE. Without a signer the dashboard still supports private research and plan review/export. The default unconfigured dashboard reads the public testnet proof vault and disables private actions.

## Review and operate

1. **Verify executor** checks fresh hardware evidence against the saved measurements and executor key. Every private command independently checks fresh evidence as well.
2. **Check credit limits** reads the runtime's durable reserved inference allowance. This sends no model request.
3. **Run private research** sends the objective and constraints through the encrypted channel. All three researchers must explicitly approve a market before the strategist selects it. Models can narrow the deterministic allowlist, never expand it.
4. **Prepare for review** obtains a confidential payment/reserve authorization on mainnet. An allocation reserve does not open a lending position. Select the saved job to inspect reports, open its transaction review, or observe settlement.
5. **Vault controls** prepares policy, pause/resume, executor pin, withdrawal, token registration and funding plans. Registration queries the configured token's storage minimum; funding transfers that fixed token to the vault. Amounts use six decimals, matching the supported USDC/test-token configuration.
6. Inspect the exact signer, network, receiver, arguments, attached NEAR and gas. **Sign & submit this exact plan** requires explicit mainnet opt-in where applicable. A new plan has a distinct intent ID; recovering the same plan only reconciles its saved transaction hash. Do not create another plan to work around an unknown payment outcome.
7. **Private audit** downloads and verifies signed encrypted receipts against the configured executor and a browser-retained checkpoint. Opening a receipt also verifies the TEE's signature on its plaintext hash through the local owner client. Exported jobs/openings contain sensitive plaintext; keep them private.

The local API uses a startup token, two-hour HttpOnly/SameSite sessions, CSRF tokens, exact Host/Origin checks and serialized mutations. Keep one owner server per private directory; do not proxy it onto a public interface. The startup token grants control of this local workspace to whoever possesses it.

## Finite schedules

The dashboard can schedule **research** or **settlement observation**, with 1–12 attempts and at least five minutes between them. It never schedules payment preparation, signing or submission. The first attempt starts after one interval, while the owner process is running; the worker checks once per minute and executes at most one due occurrence. Missed intervals are skipped.

The schedule saves its job ID before network work. Restarting or resuming an interrupted attempt retains that ID. Errors pause the schedule and preserve its error code for inspection; successful terminal settlement observations stop it. An unknown settlement stops for review. Research schedules share the same runtime inference cap as manual research. A saved schedule is bound to its approved owner configuration.

## Inference allowance

Paid inference defaults to **disabled**. Add an explicit `budget` to the approved inference policy. Amounts are integer nano-USD: `1000000000` is $1. Set both lifetime and daily allowances, call count, input/output bounds and current model price ceilings. Example allowance (prices are placeholders and must be checked):

```json
{
  "totalLimitNanoUsd": "250000000",
  "dailyLimitNanoUsd": "250000000",
  "maxCalls": 30,
  "maxInputBytes": 24000,
  "maxOutputTokens": 800,
  "inputNanoUsdPerToken": "80",
  "outputNanoUsdPerToken": "500"
}
```

This example caps reserved inference at $0.25; it is not a model/deployment approval. `npm run cloud:status` performs account and public price checks only. It never sends inference or provisions a CVM. Current model prices must fit the configured ceilings and the model must advertise verified TEE inference before any request is made.

Each batch reserves three complete calls before transmission. The input estimate counts serialized UTF-8 bytes plus 4,096 template tokens per request; all requested output tokens are reserved. Failed or unknown outcomes retain the full reservation. The pinned SDK disables automatic completion retries. Retrying a completed job returns its saved result; retrying an interrupted paid job returns `INFERENCE_OUTCOME_UNKNOWN` without charging again. No eligible markets means no model call.

Hosting is a separate charge. The existing **$3 combined cap** allocates at most $0.25 to inference and $2.75 to hosting. The completed [9 November research proof](NEAR-PRIVATE-RESEARCH-2026-11-09.md#testnet-restoration-and-cost) retains **$0.25371624** in conservative reservations: four one-hour hosting reservations ($0.243120) and nine inference calls ($0.01059624), including failed attempts. Three calls were local diagnostics and six ran in TDX. All CVMs are retired. These reservations are not a reconciled provider bill. An optional future session must retain this budget history and have a finite deletion schedule; the completed proof does not require ongoing hosting.

## Journal backup and recovery

The TEE automatically migrates a legacy audit JSON into a `neslos-journal-v2` manifest plus a sibling **`.segments` directory**. New encrypted segments are immutable and synced before their manifest is published. Segments roll around 2 MB; a single entry may be up to 8 MB. All signed checkpoints, inference reservations, failed attempts, prepared authorizations and completed IDs remain in the history.

Keep the **entire manifest and segment directory together**, plus owner jobs, schedules, transaction journals and independently retained audit checkpoints. Take a consistent backup while the runtime is stopped, or capture the manifest first and copy every segment it names. Restore the same approved runtime identity and the complete latest backup. Never reset the volume or restore an older paid-inference history just to clear an error.

Missing/altered referenced segments and a missing manifest with remaining segments fail closed. A crash may leave unreferenced encrypted segments; keep them for recovery rather than treating them as a new empty runtime. A storage failure marks the process unready; repair storage and restart from durable history. Audit export remains read-only and does not consume command quota.

Operational bounds are **128 MB of encrypted segments and 10,000 completed/failed commands**, with at most 40,000 segments. Full history is loaded and verified at startup. This is bounded archival rotation, not unlimited compaction. Export/retain checkpoints before approaching capacity, and plan a separately approved migration that carries spending history forward. Owner-retained checkpoints detect rollback relative to those checkpoints; storage alone cannot prove that a malicious operator has not erased a newer history.

## What remains external

The private client/CLI completed three signed NEAR AI research reports inside independently verified Neslos TDX. Encrypted status/audit, receipt opening, wrong-owner rejection, replay, persistence across a live restart and exhausted-budget rejection passed. The reviewed provider policy pins the observed deployment and explicitly trusts provider administration of effective runtime, routing and model weights; loaded weight bytes are not independently proved. [Proof and exact boundary](NEAR-PRIVATE-RESEARCH-2026-11-09.md).

Local tests cover the owner UI, private protocol, crash recovery, budgets and exact transaction controls with labelled fixtures. A separate [owner-wallet Confidential Intents round trip](CONFIDENTIAL-SETTLEMENT-2026-11-09.md) returned its full 0.001 NEAR principal but exceeded its native fee cap. A live owner-browser session, funded TDX/vault settlement, funded Rhea positions and paid external-agent jobs remain separate validation or integration work. The TDX instance's deliberate retirement is completed cost control.

The [historical credential audit](PHALA-AUTH-AUDIT.md) distinguishes `PHALA_AI_API_KEY` from official Cloud CLI authentication; its balance is a dated observation. `npm run cloud:status` checks current account access without paid inference or provisioning. Credentialed confidential quotes have separate retained evidence and must be refreshed before any future funded action.
