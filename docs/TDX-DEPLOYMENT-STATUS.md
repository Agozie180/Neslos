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

## Inline bundle storage boundary

The inline alternative authenticates application and lockfile bytes at runtime; it installs dependencies with lockfile integrity during setup. Its runtime verifier does not hash the installed `node_modules` tree. A runtime-only Docker restart does not rerun setup, and a preexisting substituted dependency could survive on the application volume. The current runtime mounts that volume read-only and setup receives no runtime secrets, so no application write path was demonstrated. This still requires trusted volume initialization and integrity. It is not an independently verified arbitrary-volume recovery mechanism. Use the full digest-pinned image deployment, or review fresh ephemeral reconstruction of the entire application and dependency tree, before accepting a hostile persistent-volume threat model.
