# TDX foundation audit — Ubuntu WSL, 7 November 2026

> Historical snapshot. Later standard-image deployments succeeded, and [private NEAR AI research, audit and restart verification passed on 9 November](NEAR-PRIVATE-RESEARCH-2026-11-09.md). Those temporary CVMs are retired. Earlier deployment, publication, inference and submission statements below describe this stage; see [current status](STATUS.md) for remaining work.

**Subsequent deployment result, 21:18 UTC:** this audit's verified V3 Compose was submitted once using the official Phala CLI after successful device login. Phala returned the same HTTP 400 terms-of-use denial, request ID `3e5a68141d5de59ce8d42e86e70bda6c`; the following inventory check returned zero CVMs. Evidence is retained in `.local/tdx-cli-20261107/`. Statements below about no submission describe the earlier local audit, before this deployment attempt.

The inspected requests used the intended inline TDX application. A fresh Linux build matches the previously prepared runtime, and a new production install reproduces the previous dependency-tree hash. This audit found and repaired build provenance and Linux mirror defects. Those defects are not demonstrated causes of Phala's HTTP 400 policy response. **The provider rejection remains unresolved; no CVM has been launched.**

## Deployment path and causal findings

| Layer | Evidence | Conclusion |
| --- | --- | --- |
| Repository root | The root `Dockerfile` and `npm start` launch `dist/server/server/index.js`, the rehearsal server. `deploy/tee/Dockerfile` launches `dist/server/tee/index.js`. | A generic `docker build .` produces the rehearsal image. The retained rejected requests did not use that image: they used the inline TDX bootstrap. |
| Ubuntu tools | The default shell finds Windows `npm` and no `node`. `scripts/ubuntu.sh` selects the existing Linux Node 24.22.2 installation. | Use the wrapper or explicitly select the pinned Linux installation. The wrapper now requires the version in `.node-version`. No system-wide PATH change was made. |
| Production dependency resolution | Fresh `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` in the exact pinned Linux/amd64 image reproduced `074a0c982d753ebd26dd6d5e0bffc14bd5837c424208195fcb7850fc7fa942fc`: 19,948 files, five symlinks, 1,060 directories. | No substituted/wrong dependency tree was found. Root dependencies match lockfile versions and npm registry integrity entries. Package versions were not changed. |
| Compiled application | A clean Ubuntu compilation matches the existing `dist/server` runtime bytes, excluding source maps. | No current runtime drift was found. Previously, the bundler could still accept stale or mixed output because no successful-build receipt was required. This latent defect is now fixed. |
| Linux execution cache | The previous `rsync -a` copied files without removing deleted source and could skip edits with identical sizes/timestamps. Its installation cache keyed only on `package-lock.json`. | The wrapper now checks content, reconciles the owned source directories, and keys installation on package, lockfile and Node pin. Journals, credentials and artifacts are preserved. |
| Original request size | 230,107 bytes exceeded Phala's 204,800-byte combined Compose/prelaunch limit. | A confirmed historical defect, already repaired. It is not sufficient to explain the later denial. |
| Corrected request | 146,642 bytes passed the official SDK schema, then received HTTP 400 before a VM commit. | Size correction was insufficient. A running dependency, dstack socket, NEAR RPC or application exception did not generate this pre-launch response. Static inspection of the submitted configuration is a separate possibility. |
| Current account | Fresh read-only diagnostics show successful saved-profile authentication, verified email, owner role, active billing, $5 balance, unused quotas and zero CVMs. | No exposed credential, quota or billing repair is supported. These checks cannot reveal or override Phala's internal eligibility decision. |

The corrected rejection is retained with request ID `aa623dcc09a5439de6de5010d470d336`, HTTP Date `7 November 2026 11:57:57 GMT`, and body:

```json
{"detail":"You are not allowed to deploy the target applications since it violates our terms of use."}
```

The [provider reply](TDX-PROVIDER-FOLLOWUP-2026-11-07.md) declines to identify the failed check and recommends normal console submission. SDK schema acceptance, Linux startup and dependency hashes do not prove provider acceptance. Changing dependencies, networks, accounts or endpoints without a demonstrated defect would not establish a causal repair.

## Repairs

`scripts/tee-build.mjs` compiles the server into a clean generated directory and records `artifacts/tee-build.json`. The receipt binds the source, fixtures, package/lock files, TypeScript configuration and Node pin to the complete emitted file set. The installed compiler must match the declared version. Compilation failure invalidates the receipt; input changes during compilation abort the build. Symlinked build paths are refused before generated output is removed.

`npm run build` now uses that builder. The inline bundler requires and checks its receipt, rechecks it after reading the archive, and includes the build hashes in the deployment manifest. Source changes and changed, missing or additional compiled files stop packaging. The receipt is a local consistency check on a trusted build host, not an independent proof of compilation or hardware attestation.

`scripts/ubuntu.sh` reconciles `src`, `scripts`, `tests`, `fixtures` and `deploy/tee` with content checks and deletion of obsolete source files. It checks destination paths before synchronization. It does not delete `.private`, `.env`, dependency caches, build output or journals. Clean server builds separately remove only `dist/server` after path checks.

The TDX Dockerfile now disables npm lifecycle scripts for both installation stages; its production install uses the same flags as the independently measured inline dependency install. The full-image path still requires publication and an actual registry manifest digest before deployment.

The tooling tests now bind subprocesses to their own temporary source fixtures. Previously, an inherited WSL `NESLOS_SOURCE_ROOT` made these fixtures repeatedly hash the real Windows-mounted checkout; three timed out in the initial run. No timeout was increased to hide that failure.

## Verification and artifacts

Final verification results are recorded in `.local/tdx-foundation-20261107/audit.json`, alongside the build receipt, dependency receipt, official offline SDK validation and headless Chromium report. The Linux execution workspace is `/home/useragozie/.cache/neslos-tdx-root-20261107`.

The resumed verification passes **all 593 tests across 42 files**, with no skips, and the TypeScript and production builds pass. The six headless Chromium checks from the preceding run remain recorded. The rebuilt Linux/amd64 image matches all 50 candidate application files and the exact production dependency digest. Its network-disabled, read-only, UID-1000 container test returns 503 for private requests in attestation-only mode and rejects the fake hardware quote. These image checks are recorded in `container-validation.json`; the image is local and has not been published.

On resumption, all 94 emitted server files in the Linux cache were empty, two shared verification JSON files contained only zero bytes, and the final audit/bundle was missing. The build receipt correctly rejected the damaged output. The source inputs still matched the recorded receipt; rebuilding restored its exact output digest, `81e5f7b27b99ebde4659b8fd2b3319bf8826695e5aff2ac104bb8d4b789a10ca`. The verification records and bundle have been regenerated. `resume-recovery.json` preserves the observed damage; its cause was not established. This local recovery does not explain the earlier provider denial.

The tests compile actual TypeScript fixtures, change build inputs/output, remove source files, provoke a real compiler failure, and execute the WSL wrapper twice while preserving private-state sentinels. The existing inline tests still cover archive integrity, exact application paths and dependency substitution. Browser tests use headless Chromium in Ubuntu; they do not establish a logged-in Phala console session or provider acceptance.

The npm production audit reports one low-severity advisory for `elliptic`, propagated through `@phala/dcap-qvl` and `@nearai/inference-sdk` (three package entries). It reports no available fix and no high/critical advisories. The inspected DCAP use is signature verification; this audit does not certify the entire dependency tree free of vulnerabilities. There is no evidence linking that advisory to the deployment denial.

The current candidate remains attestation-only, testnet, `vault.neslos.testnet`, with empty runtime secrets. The refreshed manifest binds the new build checks; its application bytes and measured Compose remain identical to the previously tested V3 candidate. No new provisioning request, paid inference, chain transaction or support message was sent.

The fresh read-only account check at approximately 20:07 UTC again confirmed valid authentication, active billing, a $5 balance, unused quotas and zero CVMs. The candidate Compose is 150,387 bytes with SHA-256 `4eb547066a620d79ebcbe9ea77228d63c2e1c0a8e501ed1a6c8ce1ea37fe625c`; the official SDK accepts it offline. Provider policy acceptance remains unestablished.

## Reproduce the prepared path

Run the verification from PowerShell through Ubuntu:

```powershell
wsl -d Ubuntu -- env NESLOS_UBUNTU_WORKDIR=/home/useragozie/.cache/neslos-tdx-root-20261107 bash /mnt/c/Users/USER/Neslos/scripts/ubuntu.sh verify
```

Then, inside Ubuntu, use the same Linux workspace and unique output names:

```sh
export PATH="$HOME/.local/share/neslos/node-v24.22.2-linux-x64/bin:$PATH"
export NESLOS_SOURCE_ROOT=/mnt/c/Users/USER/Neslos
cd /home/useragozie/.cache/neslos-tdx-root-20261107
node scripts/tee-dependencies.mjs --out NEW_DEPENDENCIES.json
node scripts/tee-inline-bundle.mjs --compact --dependencies NEW_DEPENDENCIES.json \
  --testnet-vault vault.neslos.testnet --attestation-only --out NEW_BUNDLE_DIRECTORY
```

Do not bundle the Windows `dist` after only building in WSL. Build output and its receipt belong to the Linux workspace. The already prepared candidate is `.local/tdx-foundation-20261107/bundle/` in the shared repository. Its offline request is review material, not a successful submission or a hardware proof.
