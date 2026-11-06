# TDX deployment status — 6 November 2026

**The attempted Phala provisioning request was rejected by the provider. It did not establish a running TDX runtime, hardware attestation, or permission to deploy this application.** Private-runtime completion remains blocked pending a legitimate provider review or another separately reviewed, authorized deployment.

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

The inline alternative authenticates application and lockfile bytes at runtime; it installs dependencies with lockfile integrity during setup. Its runtime verifier does not hash the installed `node_modules` tree. A runtime-only Docker restart does not rerun setup, and a preexisting substituted dependency could survive on the application volume. The current runtime mounts that volume read-only and setup receives no runtime secrets, so no application write path was demonstrated. This still requires trusted volume initialization and integrity. It is not an independently verified arbitrary-volume recovery mechanism. Use the full digest-pinned image deployment, or review fresh ephemeral reconstruction of the entire application and dependency tree, before accepting a hostile persistent-volume threat model.
