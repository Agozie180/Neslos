# TDX deployment status — 9 November 2026

**9 November: private owner commands passed live tests on real Phala TDX. The temporary instance is now retired.** Fresh Intel/DCAP verification reports `UpToDate`, debug disabled and nonce/key binding. All four boot measurements were independently reproduced from checksum-verified OS artifacts and the actual VM configuration; all 11 RTMR3 events match the reviewed application. Encrypted status, wrong-token rejection, audit export and signed receipt opening passed live checks. Research and preparation remain explicitly disabled, with zero paid inference calls. See the [private-stage report](TDX-PRIVATE-STAGE-2026-11-09.md) and [durable evidence](../deploy/tdx-20261109/record.json).

CVM `73f70d1d-b63f-4009-96c1-24ec49e14478`, app `a555e92fe263680b65331a165f2d8305b2099745`, ran private image digest `sha256:22c69b5f96e5e9620f35aa25aac166815523d63c42249066ce309b927faedf39` on production `dstack-0.6.1`. Its retired endpoint was https://a555e92fe263680b65331a165f2d8305b2099745-8443.dstack-pha1-prod9.phala.network. The rate was $0.060780/hour, with deletion scheduled for **9 November 08:26:46 UTC / 09:26:46 Lagos**. HTTP 404 and an empty inventory confirmed retirement at 11:54 UTC. No CVM is currently running. The $3 cap remains in force. NEAR stays testnet; no chain transaction or support message was sent. The [7 November successful deployment](TDX-LIVE-VERIFICATION-2026-11-07.md) was deleted on its finite schedule; its [archived evidence](../deploy/tdx-20261107/record.json) is preserved.

The owner authorized use of the existing GitHub token through encrypted registry secrets. Startup was repaired by installing Phala’s official pre-launch script and directing Docker credentials to a root-only writable tmpfs directory. The standard-image request also needed the advertised production OS to resolve `ERR-03-018`. The exact earlier HTTP 400 policy predicate remains undisclosed.

## Historical attempts and audits

The entries below describe their stated attempt times. The live result above supersedes earlier pending-publication, pending-authorization and zero-CVM status statements.

**21:34 UTC local smoke result:** the owner-requested Ubuntu WSL test passes for both the exact V3 bundle and a standard Docker image. The fresh inline setup installs 209 packages in approximately three minutes; runtime checks pass with UID 1000, a read-only root, dropped capabilities and no external runtime network. Missing hardware and fake quotes are rejected. The Docker build used verified cached layers, and all 50 candidate files plus the full production dependency-tree hash match inside the image. Local image `neslos-tee:wsl-smoke-20261107213103` has OCI index digest `sha256:291e071241ae52de15793685af4a4d85db0b2505600ef8d1218f9e86def4ad86`. A 1,481-byte Compose targets the proposed private repository `ghcr.io/agozie180/neslos-tee`, with unchanged attestation-only/testnet settings and empty runtime secrets. It remains explicitly pending publication and remote digest verification. Docker has no registry credentials, and the existing GitHub CLI token lacks `write:packages`; a user-approved GitHub device authorization is pending. Private registry pull access will also need configuration. No registry upload or new Phala submission occurred. Evidence: `.local/wsl-smoke-20261107/result.json`, command logs and `image-plan.json`.

**Latest attempt, 21:18 UTC:** after a fresh successful owner-authorized device login, the official `phala deploy` command submitted V3 Compose SHA-256 `4eb547066a620d79ebcbe9ea77228d63c2e1c0a8e501ed1a6c8ce1ea37fe625c` (150,387 bytes). It used the existing application name, `tdx.small`, 20 GB, `dstack-0.5.12`, PHALA KMS, private visibility and an empty environment file. `POST /api/v1/cvms/provision` returned HTTP 400 with the same terms-of-use denial; request ID `3e5a68141d5de59ce8d42e86e70bda6c`. Zero CVMs were returned afterward. No commit or hosting resource was established. This was a CLI deployment, not a browser-console submission. Evidence: `.local/tdx-cli-20261107/{attempt.json,result.json,cli-stdout.txt}`. A one-hour scheduled-deletion fallback was prepared but had no resource to act on.

**Terms review, 7 November:** the [application-to-terms comparison](PHALA-TERMS-REVIEW-2026-11-07.md) verifies the restricted bootstrap and examines the broader financial workflow. Sections 3 and 7.4 create an unresolved reward-workload question on promotional credit; no specific violation or rejection trigger was established. The corrected rejected request was already attestation-only, so this mode alone does not establish provider acceptance.

**Latest local audit:** the [Ubuntu foundation audit](TDX-FOUNDATION-AUDIT-2026-11-07.md) reproduces the intended runtime and exact production dependency tree. It repairs stale-build packaging and Linux source-mirror defects. The audit itself made no provisioning request; its V3 candidate was subsequently submitted and rejected as recorded above.

**Later evidence:** the owner supplied Phala's response, and a 146,642-byte corrected attestation-only request passed offline schema and Linux checks but received the same policy denial. See the [7 November follow-up](TDX-PROVIDER-FOLLOWUP-2026-11-07.md). Phala offers no pre-approval and suggests the normal console flow. The historical analysis below is retained for the original request.

**The 6 November inline provisioning request was rejected by Phala. The current full-image candidate has not been submitted.** No running TDX runtime or hardware attestation was established. The [7 November root audit](BLOCK-ROOT-AUDIT-2026-11-07.md) confirms that the old request exceeds the SDK's size limit while the current candidate passes offline schema validation. It does not establish what caused the different terms-of-use response or an account-wide ban. Deployment still needs provider review and a supported remedy, or another separately reviewed, authorized host.

## Observed provider response

The saved request to `POST /api/v1/cvms/provision` (client-relative path `/cvms/provision`) returned HTTP **400** with this complete error body:

```json
{
  "detail": "You are not allowed to deploy the target applications since it violates our terms of use."
}
```

The attempt requested application `neslos-tdx-20261106`, `tdx.small`, a 20 GB disk and OS image `dstack-0.5.12`. Its `setup` and `neslos` services used the official image:

```text
node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
```

The compose file carried the measured inline application bundle, dependency lockfile and setup command. Its SHA-256 was `f8cd8ac89c9e6d89919c996d35a3e1123a1541433f7f538125427cae16666043`. This digest identifies the submitted compose text; it is not a Phala-approved compose hash or an enclave measurement. Public logs, sysinfo and TCB information were disabled in the request.

The retained local diagnostics are `.local/tdx-bundle-20261106/last-api-failure.json` and `provision-request.json`. They are operator evidence, not published credentials or a transferable attestation proof. The failure returned no successful provisioning token or accepted deployment result.

## What the official documentation establishes

Phala's [Troubleshooting Guide](https://docs.phala.com/phala-cloud/troubleshooting/troubleshooting.md) has a **“Deployment blocked — violates terms & conditions”** section. It states: “Some Docker images trigger anti-spam rules,” naming abused base images and “images with suspicious patterns.” Its remedies are to use official maintained base images and contact support when an image appears incorrectly flagged.

This application already specified an official, digest-pinned Node image. The response does not identify the matched rule, image, command, account attribute or classification decision. The documented category is consistent with an application/image anti-spam restriction, but it does **not** establish the exact trigger here or prove a false positive. It also does not establish an account-wide ban. No claim is made that inline compression caused the rejection.

The [Error Codes Reference](https://docs.phala.com/phala-cloud/references/error-codes.md) separately describes insufficient balance (`ERR-04-001`), instance/resource limits (`ERR-04-002`, `ERR-04-003`, `ERR-02-015`) and resource availability. The observed response contains none of those codes. Buying capacity or changing instance size is therefore not a documented fix for this response.

The [provision API reference](https://docs.phala.com/api-reference/cvms/provision-dstack-app.md) describes this phase as validating and caching compose data before CVM creation. Current public [SDK source](https://github.com/Phala-Network/phala-cloud/blob/main/js/src/actions/cvms/provision_cvm.ts) describes eligibility checks and a subsequent commit phase; it notes that the legacy `/cvms/provision` endpoint is deprecated but remains available. That API evolution does not explain the terms-of-use denial or authorize retrying through another endpoint.

## Legitimate remediation

1. Request a provider review of the exact rejected application through the official [support page](https://docs.phala.com/phala-cloud/support.md) or [contact form](https://cloud.phala.com/contact). The troubleshooting page lists `cloud@phala.network`; the support page also displays `support@phala.network` with a `cloud@phala.network` mail link. Use a verified official channel.
2. Supply the workspace identifier privately, UTC request time, HTTP status and exact error, compose digest, official image digest, application purpose and reviewable source/build instructions. Ask whether the restriction is account-specific, image-specific or application-specific; request the relevant policy reason and a legitimate approval/remediation process. Review attachments before sharing and omit API keys, runtime secrets, owner keys and private research briefs.
3. Keep the rejected payload and diagnostics intact while the provider investigates. Apply only a reviewed, provider-supported remedy after the reason is understood. Do not rename, encode, repackage, switch endpoints or vary provisioning parameters to bypass the restriction.

No support message was sent by the documentation investigation. No provisioning variants were submitted. Local container checks and prepared measurement material remain useful development evidence, but they cannot substitute for an accepted deployment and independently verified hardware attestation.

## Request compatibility audit addendum

A deeper 6 November audit found one definite local request defect: the submitted `docker_compose_file` is **230,107 UTF-8 bytes**, and `pre_launch_script` is empty. Phala's official SDK limits their combined size to **204,800 bytes**, so the payload exceeds that limit by **25,307 bytes**. The exact saved compose was replayed through the [official compose schema](https://github.com/Phala-Network/phala-cloud/blob/0bffb28da4092a06c4d0ad179e317f3488c33fd1/js/src/types/app_compose.ts) and rejected with the documented size error. This is not a newly introduced API limit: [Phala PR 166](https://github.com/Phala-Network/phala-cloud/pull/166) added it on 5 February 2026.

Both Neslos bundle generators now enforce that combined UTF-8 byte limit before writing output. The retained local prepare helper also checks it before any provisioning request. Boundary tests cover exactly-at-limit payloads, combined compose/script overflow, multibyte text and an oversized bundle producing no deployment artifacts. These changes prevent submission of an incompatible payload; they do **not** establish a repair for the provider's terms-of-use restriction.

| Suspected cause | Evidence and conclusion |
| --- | --- |
| Wrong API base, auth header or version | The request used the official Cloud API, `X-API-Key`, and SDK-supported `2026-06-23`. The same CLI profile authenticates and lists zero CVMs. No credential-scope error was identified. |
| Missing instance type or OS image | A same-profile, read-only official resource-graph request returned `tdx.small` and non-development `dstack-0.5.12` with available CPU, memory and CVM slots on two nodes. PHALA KMS records advertised that OS image. Resource visibility is not policy approval. |
| Invalid Docker image reference or architecture | Both services use the same official Node tag-plus-digest reference; local Docker resolves its recorded digest as Linux/amd64. The provider's own image-classifier decision is not exposed. |
| Damaged bundle or substituted compose | Saved request text matches the compose file; compressed bundle hash and all 44 file hashes match the manifest. Sensitive runtime environment values are placeholders. |
| Payload too large | Confirmed: 230,107 bytes exceeds 204,800. Local guards are fixed. The received terms-of-use error does not disclose whether size caused it. |
| KMS casing or deprecated endpoint | Current SDK accepts uppercase `PHALA` and states that `/cvms/provision` remains available; the public OpenAPI shows lowercase KMS enum values. This documentation discrepancy does not prove the rejection's cause and was not tested with a provisioning variant. |
| Image/application/account restriction | Official troubleshooting associates this message category with image anti-spam rules. No matched rule, account-wide ban, or false positive is established. Provider review is needed. |

The audit found no supported causal basis for changing endpoints, image names, instance profiles or packaging and retrying through the policy denial. An unsent, credential-free support draft and reproducible offline evidence are saved in `.local/phala-provision-audit-20261106/`. No paid or provisioning calls were made during the audit.

The original lockfile contains development dependency metadata as well as production dependencies. Removing that metadata might reduce an inline bundle, but no replacement lockfile or reduced application has been produced: manual pruning can change npm's dependency/peer/optional resolution and `npm ci` validation. A separately reviewed production dependency artifact would need to preserve exact package versions and integrity entries and pass a clean offline-equivalence assessment before use. It is not a demonstrated fix for the policy response. The existing full-image packaging path avoids inline application size growth, but submitting it after this denial still requires a legitimate provider-supported resolution.

## Inline bundle storage boundary

Historical V1/V2 inline bundles authenticate application and lockfile bytes at runtime and use lockfile integrity during setup, but omit the installed `node_modules` tree from startup checks. A runtime-only Docker restart does not rerun setup, so a substituted dependency could survive on the application volume. No remote application write path was demonstrated.

The [V3 startup repair](TDX-STARTUP-AUDIT-2026-11-07.md) now verifies the exact application file set and an independently reproduced Linux dependency-tree digest before import. It rejects modified dependencies and injected module-resolution paths in actual Linux tests. The runtime still needs a trusted measured base and build receipt; a compromised guest root or concurrent mutation after verification is outside this check. Historical artifacts retain their original behavior. The V3 candidate has not been submitted or deployed.
