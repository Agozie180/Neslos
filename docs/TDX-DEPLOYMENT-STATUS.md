# TDX deployment status — 9 November 2026

**Completed: private NEAR AI research and owner controls passed inside independently verified Phala TDX.** At 16:15:54 UTC on 9 November, all three researchers returned valid signed reports covering two live markets. Encrypted audit, receipt opening, wrong-owner rejection, replay, persistence across a live restart and exhausted-budget rejection passed. See the [research proof](NEAR-PRIVATE-RESEARCH-2026-11-09.md) and [checksum-indexed archive](../deploy/near-private-research-20261109/record.json).

The temporary CVM was **deleted at 16:22 UTC after verification to stop hosting charges**. HTTP 404 and an empty inventory confirmed retirement. The owner restored the testnet vault's original policy and executor, paused at version 13; balances, nonce and spending consumption are unchanged. Four governance transactions performed that configuration and restoration. That TDX session attempted no funded settlement; the later [owner-wallet round trip](CONFIDENTIAL-SETTLEMENT-2026-11-09.md) returned full principal but exceeded its native fee cap, without starting another CVM. The demo's operating plan uses the public rehearsal plus archived private evidence; it does not require continuous paid TDX hosting.

## Current verification and cost

| Area | Completed evidence |
| --- | --- |
| Hardware identity | Intel/DCAP `UpToDate`, debug disabled, nonce/key binding, independently calculated boot pins and all 11 RTMR3 events replayed |
| Reviewed package | Privately published final image `sha256:d432e429fa798180b1b61b39b772c522347191f1dd369fb595997f4a2a17f08f`; all 63 build inputs match |
| Private research | Three signed `z-ai/glm-5.3-flash` reports inside Neslos TDX under the reviewed direct NEAR AI policy |
| Persistence and budget | Restart returns retained results; replay makes no new inference call; exhausted allowance rejects; failed reservations remain charged |
| Retirement | CVM `372acf7c-e25a-45b7-8ee1-fd85ff0508a3`, app `afa01c25cd37738c4da699cad631cccc004b620b`, deleted after the completed session; zero active CVMs in the retirement record |
| Conservative reservations | $0.243120 hosting plus $0.01059624 inference = **$0.25371624** within the **$3 combined cap**; nine calls, comprising three local diagnostics and six TDX calls |

The inference policy requires fresh Intel/NVIDIA verification, independent boot pins, encrypted transport and exact TLS/signer/instance pins. It explicitly trusts provider administration of effective routing, runtime and model weights. Loaded weight bytes are not independently proved. Reservations are retained spending bounds, not a reconciled provider bill. [Trust review](MODEL-DEPLOYMENT-AUDIT-2026-11-09.md) · [Budget and retirement](NEAR-PRIVATE-RESEARCH-2026-11-09.md#testnet-restoration-and-cost).

Repeating live hardware verification is optional. If a new private session is needed, use a finite budgeted hosting window, fresh Neslos attestation and a newly reviewed provider policy when history, keys, instance or expiry changes. Retain all inference reservations, private journals and independent audit checkpoints. [Runbook](TEE-RUNBOOK.md).

## Historical attempts and audits

**The entries below are historical snapshots of 6–9 November.** The completed research proof above supersedes their earlier pending-publication, disabled-research and unverified-restart statements. Their provider errors and diagnostic artifacts are retained for traceability; they are not current blockers. Standard-image deployments subsequently succeeded, while the internal cause of the earlier inline-request HTTP 400 remains undisclosed.

### 9 November: earlier owner-control stage

At 07:59 UTC, encrypted status, wrong-token rejection, audit export and signed receipt opening passed with independently verified boot measurements and RTMR3 replay. Research and preparation were disabled for that earlier session, with zero paid inference. CVM `73f70d1d-b63f-4009-96c1-24ec49e14478`, app `a555e92fe263680b65331a165f2d8305b2099745`, ran image `sha256:22c69b5f96e5e9620f35aa25aac166815523d63c42249066ce309b927faedf39` on `dstack-0.6.1`. Its scheduled deletion time was 08:26:46 UTC; HTTP 404 and empty inventory confirmed retirement at 11:54 UTC. No chain transaction was made by this earlier stage. [Stage report](TDX-PRIVATE-STAGE-2026-11-09.md) · [Stage evidence](../deploy/tdx-20261109/record.json).

The owner authorized the existing GitHub token through encrypted registry secrets. Startup was repaired using Phala's official pre-launch script and a root-only writable tmpfs for Docker credentials. The standard-image request also needed the advertised production OS to resolve `ERR-03-018`. The [7 November successful deployment](TDX-LIVE-VERIFICATION-2026-11-07.md) was also retired after its finite session; [its evidence](../deploy/tdx-20261107/record.json) remains archived.

### 6–7 November: inline request and startup investigations

| Historical stage | Result at that stage | Detailed record |
| --- | --- | --- |
| 6 November inline request | HTTP 400 terms-of-use response; no CVM created. The later audit also confirmed an oversized payload | [Root audit](BLOCK-ROOT-AUDIT-2026-11-07.md) · [Rejection audit](PHALA-REJECTION-AUDIT-2026-11-07.md) |
| 7 November corrected inline requests | Offline schema and Linux checks passed; provider returned the same HTTP 400. The 21:18 UTC V3 CLI submission was 150,387 bytes, Compose SHA-256 `4eb547066a620d79ebcbe9ea77228d63c2e1c0a8e501ed1a6c8ce1ea37fe625c` | [Provider follow-up](TDX-PROVIDER-FOLLOWUP-2026-11-07.md) · [Foundation audit](TDX-FOUNDATION-AUDIT-2026-11-07.md) |
| 7 November local image/startup checks | V3 and standard-image smoke tests passed in restricted Linux containers; application and production dependency integrity checks were reproduced | [Startup audit](TDX-STARTUP-AUDIT-2026-11-07.md) |
| 7 November standard-image deployment | Genuine TDX deployment and independent verification succeeded; the finite instance was later retired | [Live verification](TDX-LIVE-VERIFICATION-2026-11-07.md) · [Evidence](../deploy/tdx-20261107/record.json) |

The terms investigation compared the actual restricted bootstrap with the provider's published conditions. It did not establish a specific violation or the internal rejection trigger. [Terms review](PHALA-TERMS-REVIEW-2026-11-07.md).

## Observed provider response

The historical inline request to `POST /api/v1/cvms/provision` returned HTTP **400**:

```json
{
  "detail": "You are not allowed to deploy the target applications since it violates our terms of use."
}
```

The 6 November request targeted `tdx.small`, a 20 GB disk and `dstack-0.5.12`, with an official digest-pinned Node image. Its Compose SHA-256 was `f8cd8ac89c9e6d89919c996d35a3e1123a1541433f7f538125427cae16666043`. That identifies the submitted text, not an approved enclave measurement. Operator diagnostics remain in `.local/tdx-bundle-20261106/`; the [rejection audit](PHALA-REJECTION-AUDIT-2026-11-07.md) retains the interpretation and source references.

## What the official documentation establishes

At the time of the investigation, Phala's [Troubleshooting Guide](https://docs.phala.com/phala-cloud/troubleshooting/troubleshooting.md) associated this error category with image anti-spam rules and recommended maintained official images and provider review. The response itself did not disclose the matched rule, establish an account-wide ban or prove that payload size caused the denial. The request already used an official image.

The [Error Codes Reference](https://docs.phala.com/phala-cloud/references/error-codes.md) described separate balance and capacity errors; none appeared in the saved response. The [provision API](https://docs.phala.com/api-reference/cvms/provision-dstack-app.md) described request validation before CVM creation. Those references did not establish that buying more capacity or changing endpoints would repair the historical denial. Later standard-image success establishes successful deployment, while the earlier internal predicate remains unknown.

## Legitimate remediation

The historical investigation recommended review through the provider's official support channel with a sanitized request, UTC time, response and Compose digest. The owner's subsequent provider response and supported deployment work are recorded in the [follow-up](TDX-PROVIDER-FOLLOWUP-2026-11-07.md) and [startup audit](TDX-STARTUP-AUDIT-2026-11-07.md). The documentation investigation sent no support message. These are completed investigation records, not an outstanding request to buy hosting or retry the rejected payload.

## Request compatibility audit addendum

The **6 November** audit confirmed a local request defect: `docker_compose_file` was **230,107 UTF-8 bytes** and `pre_launch_script` was empty. The official combined limit was **204,800 bytes**, exceeded by **25,307 bytes**. The saved payload failed the [official Compose schema](https://github.com/Phala-Network/phala-cloud/blob/0bffb28da4092a06c4d0ad179e317f3488c33fd1/js/src/types/app_compose.ts) with the size error. [Phala PR 166](https://github.com/Phala-Network/phala-cloud/pull/166) introduced that limit on 5 February 2026.

Both Neslos bundle generators now enforce the combined UTF-8 limit before producing deployment artifacts. Tests cover exact-limit inputs, combined Compose/script overflow, multibyte text and oversized bundles producing no output. The retained prepare helper also checks the limit before provisioning. The guards repair request compatibility; the saved terms-of-use response did not establish whether size caused that different error.

The [root audit](BLOCK-ROOT-AUDIT-2026-11-07.md) and [foundation audit](TDX-FOUNDATION-AUDIT-2026-11-07.md) preserve checks of authentication, advertised OS/capacity, image architecture, bundle integrity and exact dependencies. Standard-image packaging subsequently deployed successfully and is the path used by the completed private research proof.

## Inline bundle storage boundary

Historical V1/V2 inline bundles authenticated application/lockfile bytes but omitted the installed dependency tree from startup checks. A runtime-only Docker restart did not rerun setup, so a substituted dependency could persist on the volume. No remote application write path was demonstrated.

The [V3 startup repair](TDX-STARTUP-AUDIT-2026-11-07.md) added verification of the exact application file set and independently reproduced Linux dependency-tree digest before import. Linux checks rejected changed dependencies and injected module-resolution paths. That V3 inline candidate was submitted on 7 November and received the historical policy denial; standard-image deployments then succeeded. Startup integrity still depends on a trusted measured base/build receipt and does not protect against a compromised guest root or concurrent mutation after verification. Original evidence files retain their historical behavior.
