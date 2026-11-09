# TDX private owner commands — 9 November 2026

> Historical snapshot, retained below. Later on 9 November, [private NEAR AI research passed inside independently verified TDX](NEAR-PRIVATE-RESEARCH-2026-11-09.md), including signed reports, audit opening, restart persistence and exhausted-budget rejection. The scoped direct policy explicitly trusts provider deployment/weight administration; it does not independently prove loaded weights. The finite CVM is retired and the testnet vault restored paused. Earlier statements about disabled research, zero calls, unchanged code or unfinished restart checks apply only to this snapshot.

**Private owner commands passed live verification on Phala TDX at 07:59 UTC.** Encrypted status, owner authentication, audit export and signed receipt opening worked against independently approved hardware measurements. AI research and preparation remained explicitly disabled. The temporary CVM was scheduled for deletion at **08:26:46 UTC / 09:26:46 Lagos**; HTTP 404 and an empty CVM inventory confirmed its retirement at 11:54 UTC. There is no currently running deployment.

The [permanent record](../deploy/tdx-20261109/record.json) indexes 17 evidence files with SHA-256 checksums. The earlier [7 November deployment](TDX-LIVE-VERIFICATION-2026-11-07.md) and its [original evidence](../deploy/tdx-20261107/record.json) remain preserved separately.

## Verified deployment

| Item | Value |
| --- | --- |
| CVM UUID | `73f70d1d-b63f-4009-96c1-24ec49e14478` |
| App ID | `a555e92fe263680b65331a165f2d8305b2099745` |
| Instance ID | `a0f7ca820e726b061758eb6ddd19cbd73eff1bf1` |
| Retired endpoint | `https://a555e92fe263680b65331a165f2d8305b2099745-8443.dstack-pha1-prod9.phala.network` |
| Resources | `tdx.small`, 1 CPU, 2 GB RAM, 20 GB disk; node `prod9` |
| Production OS | `dstack-0.6.1` |
| Image | `ghcr.io/agozie180/neslos-tee@sha256:22c69b5f96e5e9620f35aa25aac166815523d63c42249066ce309b927faedf39` |
| Measured app-compose hash | `d1dbda3beb855797c07cdffaa78eda97e1bba34b869d4db292c8e3811b450ce4` |
| OS checksum-file SHA-256 | `ec43cb8c5e04b6bb6c53b33b16076a01d83d01f7f4b703f2f78a0d947d6247e6` |
| Chain target | NEAR testnet; owner `neslos.testnet`, vault `vault.neslos.testnet` |
| Hosting | $0.060780/hour, including disk; finite deletion guard retained through updates |

The image was built under Ubuntu WSL for Linux/amd64, passed restricted-container checks, and was privately published with its remote digest verified. The live composition reported that exact image running and healthy. A subsequent [source receipt](../deploy/tdx-20261109/source-receipt.json) confirms that all 60 retained build-input files match the current application source, configuration and fixtures. Deployment templates changed afterward to expose the inference flag for future bundles; they are separate from the archived live Compose.

## Why private commands were disabled, and what changed

The original deployment fixed `NESLOS_RUNTIME_MODE=attestation-only` and intentionally supplied no owner token or approved TEE policy. Private startup also required inference policy and credentials, which unnecessarily coupled basic owner access to AI readiness.

The runtime now supports explicit `NESLOS_INFERENCE_ENABLED=false`. It still verifies real TDX evidence and authenticates the owner. In this mode it permits status, audit export/open and observation of previously prepared authorizations; it creates no inference client and has a zero inference allowance. Research and preparation return `PRIVATE_RESEARCH_DISABLED` before research, quote or credit-reservation work. Conflicting inference credentials or policy are rejected. Existing deployments that omit the new flag retain the previous inference-enabled configuration requirements.

The live Compose fixed inference to false and kept inference/Intents credentials empty. Mode, approved TEE policy and owner token were supplied through Phala encrypted secrets only after reviewing the final measured configuration. The owner token remains local in `.private/tee/owner-token.json`; no owner NEAR signing key was uploaded. The `update_env_vars:false` Compose operation preserved the old environment-name set, so a separate supported encrypted-environment update established the complete set in bootstrap mode before measurement approval. Changing values afterward preserved the final Compose hash.

## Independent measurement verification

`GET /platform` exports only app ID, instance ID and VM configuration. These are calculation inputs, not an attestation verdict. The [captured configuration](../deploy/tdx-20261109/vm-config.json) identified QEMU 8.2.2, 1 CPU, 2 GB RAM, 9p host sharing, no GPUs, and `hotplug_off:false`. The previous calculation incorrectly assumed hotplug was disabled, producing three different ACPI event digests in RTMR0.

The official OS measurement bundle was downloaded from [download.dstack.org](https://download.dstack.org/os-images/mr_ec43cb8c5e04b6bb6c53b33b16076a01d83d01f7f4b703f2f78a0d947d6247e6.tar.gz). Every supplied file matched its checksum; SHA-256 of the [checksum file](../deploy/tdx-20261109/os-sha256sum.txt) equals the approved OS hash. The [calculator source](../deploy/tdx-20261109/boot-calculator.rs) uses published [dstack revision d7e15dc](https://github.com/Phala-Network/dstack/tree/d7e15dc9020101bb37d93ea9eec5f1f4fefe93e7), including the actual VM topology, OS-declared `pre202505` OVMF variant and normalized kernel header. The measured kernel command line includes OVMF's appended ` initrd=initrd`.

All of MRTD and RTMR0–2 independently match the fresh Intel/DCAP-verified report. [Calculated values](../deploy/tdx-20261109/boot-calculation.json), [comparisons](../deploy/tdx-20261109/boot-comparison.json) and the [approved policy](../deploy/tdx-20261109/approved-policy.json) are retained. Approval used the full downloaded-image calculation even though the host also advertised a lite measurement document.

All 11 RTMR3 event payload digests were recomputed and replayed to the verified quote. The exact event sequence was checked, including app/instance IDs, reviewed app-compose, OS hash, empty GPU policy, KMS identity, ZFS and encrypted storage. Unknown extra events were not accepted. Intel/DCAP reported `UpToDate`, debug mode was off, and report data bound both application keys and the fresh challenge. The full [quote](../deploy/tdx-20261109/attestation.json) and [verification record](../deploy/tdx-20261109/verification.json) are retained. A new instance or changed measured configuration requires fresh review; these pins are specific to this deployment.

## Live owner-command results

- Fresh DCAP verification preceded owner requests. HPKE-encrypted status returned `ready:true`, `inference.enabled:false`, zero calls and zero credit limits; responses were encrypted and executor-signed.
- A different owner token was rejected.
- Research and preparation returned `PRIVATE_RESEARCH_DISABLED`.
- An observation using an unknown authorization returned `UNKNOWN_AUTHORIZATION` before chain/provider reads and saved an encrypted denial receipt. No existing prepared authorization or successful settlement was claimed.
- Audit export passed executor signature and hash-chain verification. Opening the denial receipt passed its signed content binding. A later status still reported zero inference calls.

[Command results](../deploy/tdx-20261109/private-command-results.json) retain the check summary and audit checkpoint. The actual encrypted audit and locally opened test receipt are retained privately in `.private/tee/audit-20261109.json` and `.private/tee/opened-denial-20261109.json`.

A CVM restart was requested to test journal persistence, but the session was interrupted before that check completed and the deletion deadline passed. **Persistence across this restart is not claimed.** The pre-restart audit was already exported successfully. No chain transaction, paid inference call or support message was sent.

## Checks, cost and next boundary

The change passed 50 focused runtime/server/attestation tests, server TypeScript checking, and the restricted Linux container smoke test. The smoke test rejects fake hardware in both bootstrap and inference-disabled private mode. The later Compose-template changes passed 12 bundle tests. [Local check details](../deploy/tdx-20261109/local-checks.json) distinguish these results from the historical 593-test Ubuntu suite.

The combined $3 cap remains $2.75 hosting plus $0.25 inference. Three historical launches were conservatively reserved as three full hours, totaling $0.182340. The observed Phala balance decrease across them is $0.083917; this is a balance observation, not a reconciled invoice. [Retirement](../deploy/tdx-20261109/retirement.json) confirms zero active CVMs, and [budget evidence](../deploy/tdx-20261109/budget-summary.json) records zero paid inference.

The next unresolved boundary is AI deployment and routing approval. The free 9 November inspection found valid model hardware/GPU evidence, but the current 31-action engine/proxy history failed `PROVENANCE_COMPOSE_SPLIT_REFERENCE`, and the signing key was shared with another previously captured deployment. [Evidence](../deploy/tdx-20261109/inference-readiness.json) and upstream [issue 1087](https://github.com/nearai/cloud-api/issues/1087) explain why research remains disabled. The published SDK 0.3.0 still omits direct TLS binding while that serving-attestation issue is open; no SDK upgrade or relaxed check was used to declare approval. A further finite deployment can use the reviewed image, with freshly reviewed instance measurements, once needed for the next validation stage.
