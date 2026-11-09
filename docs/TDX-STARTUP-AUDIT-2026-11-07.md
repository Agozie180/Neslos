# TDX startup integrity audit — 7 November 2026

> Historical snapshot. Later standard-image deployments succeeded, and [private NEAR AI research, audit and restart verification passed on 9 November](NEAR-PRIVATE-RESEARCH-2026-11-09.md). Those temporary CVMs are retired. Earlier deployment, publication, inference and submission statements below describe this stage; see [current status](STATUS.md) for remaining work.

**Fixed: inline bundles now reject substituted dependencies and additional application paths before importing application code.** The V3 candidate targets `vault.neslos.testnet`, owned by `neslos.testnet`, in attestation-only mode. It passes the full application checks, an actual Linux install and startup tests, and Phala's offline request schema. It has not been submitted or deployed.

## Finding and repair

The older V2 command authenticated application and lockfile bytes but trusted the installed dependency directory. An instrumented copy of that command still reached its application-import flag after `node_modules/express/index.js` was altered. A runtime-only container restart does not rerun setup. This establishes a persisted-volume integrity gap, conditional on an actor being able to alter that volume; it does not demonstrate a remote write exploit. The runtime already mounts the application volume read-only.

[The dependency builder](../scripts/tee-dependencies.mjs) now runs a fresh production `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` in the exact official Linux/amd64 Node image. Only snapshotted package/lock files and the install helper enter its disposable container; runtime credentials are not passed. The resulting receipt binds the full dependency-tree hash to the original package and lockfile, image digest, platform, Node/npm versions and installation arguments.

[The tree verifier](../scripts/tee-dependency-tree.mjs) hashes file bytes, relative names, file sizes, executable bits, directories and symlink text in canonical order, including hidden files. It rejects special files, dependency symlinks escaping the tree, and excessive traversal. The startup guard also requires the exact application file set, rejecting missing files, source symlinks, extra nested `node_modules` directories and extra `package.json` files. A mismatch throws `APP_INTEGRITY` or `DEPENDENCY_INTEGRITY` before the application import.

[The inline bundler](../scripts/tee-inline-bundle.mjs) requires this receipt and embeds the expected dependency hash and verifier directly in the measured Compose command. It rejects missing receipts and receipts for different package/lock bytes. Both gzip and Brotli modes emit V3. No package versions, application bytes or lockfile entries were changed by this repair. Old V1/V2 artifacts remain historical and retain their original behavior.

The build host, receipt and pinned base remain trusted inputs. Matching dependency bytes is not a source-code audit of every third-party package. This check does not protect against a compromised guest root, concurrent modification after verification, or encrypted-journal rollback. Genuine TDX measurements and independent journal checkpoints remain separate requirements.

## Verification

| Check | Result |
| --- | --- |
| Full application verification | **582 passed, four Windows platform skips**; TypeScript and production builds passed |
| Regression coverage | Changed, missing, extra and hidden dependency content; external symlinks; injected resolution paths; missing/stale receipts; archive corruption; target validation; secret exclusion |
| Fresh Linux production install | 209 packages installed; entire resulting tree matched the separate clean-install receipt |
| Exact generated startup, pristine volume | Health/bootstrap worked; private endpoint returned 503; fake hardware quote rejected; UID 1000 |
| Modified `express/index.js` | Exact generated command exited with `DEPENDENCY_INTEGRITY` before application import |
| Injected nested module directory | Exact generated command exited with `APP_INTEGRITY` before application import |
| Injected nested `package.json` | Exact generated command exited with `APP_INTEGRITY` before application import |
| Runtime test restrictions | Read-only root/application mount, all capabilities dropped, network disabled; deliberate mutations made by a separate disposable fixture container |
| Cleanup | Test project labels checked before removing its containers, two volumes and network |
| Provider validation | Official full `ProvisionCvmRequestSchema` passed offline; **zero new provisioning calls** |

Application verification run: `fc843eb1-2e20-4bce-ac35-7b8253e5007b`, completed `2026-11-07T12:49:32.968Z`. The application verification and new bundle share source-content digest `a3d90898e52e0429f4473b61901e8d498bb83fd5498be75b62f7fe295f674a33`. The Linux smoke test explicitly reports `genuineHardwareVerified:false`; fake hardware fixtures establish rejection behavior only.

## Current candidate and evidence

| Item | Value |
| --- | --- |
| Manifest format | `neslos-tee-inline-deployment-v3` |
| Compose size | **150,387 bytes**, 54,413 below Phala's 204,800-byte combined limit |
| Compose SHA-256 | `4eb547066a620d79ebcbe9ea77228d63c2e1c0a8e501ed1a6c8ce1ea37fe625c` |
| Archive | Brotli, 103,641 bytes, 50 files; every reconstructed byte matches the build |
| Archive SHA-256 | `8d3d10f2c894b57f8f128a0144dcfd8e6aae2ad694e9b82edf8291e2b4e2fa79` |
| Dependency-tree SHA-256 | `074a0c982d753ebd26dd6d5e0bffc14bd5837c424208195fcb7850fc7fa942fc` |
| Dependency tree | 19,948 files, five symlinks, 1,060 directories, 180,188,192 file bytes |
| Runtime base | `node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c` |
| Runtime settings | Literal `testnet`, `vault.neslos.testnet`, `attestation-only`; runtime secrets empty |

Private local evidence is under `.local/tdx-startup-audit-20261107/`: `before.json`, `dependencies.json`, `bundle/compose.yaml`, `bundle/deployment.json`, `bundle/provision-request.json`, `offline-validation.json`, `container-check.json`, and the named setup/tampering logs. The generated request is an offline candidate, not a submitted request. The [runbook](TEE-RUNBOOK.md) includes the required dependency-measurement step.

## Remaining deployment limitation

Phala rejected the earlier size-corrected V2 request and will not disclose the responsible check. The [provider follow-up](TDX-PROVIDER-FOLLOWUP-2026-11-07.md) records that result. This startup repair neither explains nor clears that denial. Phala suggests its normal console flow; the authorized background Brave connection is unavailable in this session. No browser permissions were altered and no automated provisioning variants were attempted.

No CVM commitment, paid inference or chain transaction occurred during this repair. The existing testnet vault needs no redeployment. Genuine Neslos hardware evidence and the independent NEAR AI model-history/shared-key routing review remain unfinished. The combined $3 budget remains unchanged.
