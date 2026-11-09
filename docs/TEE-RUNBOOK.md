# Running Neslos in a TEE

The [NEAR private research report](NEAR-PRIVATE-RESEARCH-2026-11-09.md) records the strict direct integration and live verification. Earlier [audit findings](MODEL-DEPLOYMENT-AUDIT-2026-11-09.md) explain why authenticated deployment history must not be described as proof of currently loaded weights.

The private owner CLI, local owner browser and dstack container package are implemented. [Live verification on 9 November](NEAR-PRIVATE-RESEARCH-2026-11-09.md) completed all three NEAR AI researchers inside independently verified Neslos TDX, with signed reports, encrypted audit, replay, restart persistence and exhausted-budget rejection. The CVM was deleted after the completed proof to stop hosting charges, and the vault was restored paused. The public rehearsal and archived evidence support review without continuous TDX hosting. An optional new private session needs fresh reviewed approval, an explicit budget and a finite hosting window. The direct policy explicitly trusts provider deployment/weight administration. The [owner guide](OWNER-WORKSPACE.md) covers finite schedules, credit caps and journal recovery. Local Docker tests use fake hardware and are separate packaging checks.

An earlier package was rebuilt and smoke-tested on **6 November 2026** as `neslos-tee:readiness-20261106`, local image ID `sha256:b764b71ace136929ee8611409b1b9f87c853fa534816ffef3c3966b3c1f89a9c`. In a read-only, capability-dropped, network-disabled container it rejects fake evidence and reports `genuineHardwareVerified:false`, running as UID 1000. That local image was not published or deployed; the separate 9 November image and live checks are recorded above. [Current deployment limits](TDX-DEPLOYMENT-STATUS.md).

The completed remote proof used **private research plus a testnet vault**. It made no Intents deposit and needed no GPU of the owner's own: Neslos ran on a CPU TEE and sent encrypted research requests to NEAR AI's attested model service. Research data describes NEAR mainnet yields. A testnet research result does not establish a private payment or a lending deposit.

For Phala authentication, distinguish `PHALA_AI_API_KEY` (Private AI) from `PHALA_CLOUD_API_KEY` or official `phala login` (CVM management). `npm run cloud:status` checks each scope without paid calls. The [4 November credential audit](PHALA-AUTH-AUDIT.md) resolved the local scope mismatch and authenticated both products; it also records the verified balance, post-paid billing mode and CPU/storage prices.

Use `npm run cloud:status -- --deployment-checks` to inspect email verification, workspace role, billing status and remaining quotas too. Unknown fields stay unknown; this command never establishes provider policy acceptance. The [7 November rejection audit](PHALA-REJECTION-AUDIT-2026-11-07.md) records the earlier inline request denial. Standard-image deployments later succeeded; the historical response's internal cause remains undisclosed.

## Free access options, checked 3 November 2026

| Option | Current official offer | Fit for Neslos |
| --- | --- | --- |
| NEAR AI Cloud | [Hackathon Q-000](https://nearhackathon.com/HACKATHON.md): claim **$10 in inference credits by joining NEAR Builders** at [nearbuilders.org/join](https://nearbuilders.org/join); generate the key at [cloud.near.ai](https://cloud.near.ai) | Pays for model calls; it does not host the Neslos executor |
| Phala Cloud | [Account docs](https://docs.phala.com/phala-cloud/getting-started/sign-up-for-cloud-account): **some new workspaces** are offered welcome credit when adding a card, while the offer lasts. The [FAQ](https://docs.phala.com/phala-cloud/faqs) says the dashboard shows the amount before claiming. No guaranteed amount or permanent free tier was established. | Closest match: Intel TDX + dstack socket + Docker Compose |
| OutLayer | [Official multi-chain reference](https://github.com/out-layer/outlayer/blob/main/docs/MULTI_CHAIN.md): **100 free WASI executions per wallet**. The [API](https://github.com/out-layer/outlayer/blob/main/API.md) documents registration and authenticated `/trial/status`. Check the actual expiry/limits returned by the service. | Alternative execution platform; requires a WASI adapter. It cannot run this Node container unchanged. No OutLayer wallet or trial was registered here. |
| Sponsored Phala credit | Ask Phala support (`cloud@phala.network`, listed in its FAQ) or the [NEAR builders community](https://t.me/nearbuilderschat) for hackathon credit | A request, not an established entitlement. No outreach has been sent. |

For a strictly zero-charge plan, obtain an eligible promotion or sponsor credit first and inspect its terms. **Phala's current default with a card is post-paid:** CVMs continue after credits run out and the card is charged; disabling auto-topup alone does not stop that. Without a card, its FAQ says CVMs stop at zero balance. Adding a card triggers a refundable $1 check. Confirm the workspace's actual billing mode, credit expiry and stopping procedure before launching; budget for any retained storage. Prices are live at [cloud.phala.com/about/pricing](https://cloud.phala.com/about/pricing).

Do not rent a confidential GPU for this architecture. Do not describe an ordinary free VPS, GitHub runner, WSL instance or dstack simulator as an attested TEE.

A support request the owner can send:

> I'm building Neslos for NEAR HACKATHON, ending 14 November 2026. It uses an Intel TDX/dstack executor, verified NEAR AI inference, and an on-chain spending vault. Do you offer CPU CVM credit for short, time-limited development and verification sessions? I need a genuine quote-capable instance and a way to cap charges and delete it after each session. The runtime is a single Node container; no GPU is needed.

## Build and verify locally

Application commands run through Ubuntu WSL:

```powershell
wsl.exe -d Ubuntu --exec bash /mnt/c/Users/USER/Neslos/scripts/ubuntu.sh verify
wsl.exe -d Ubuntu --exec bash /mnt/c/Users/USER/Neslos/scripts/ubuntu.sh private
```

Build the dedicated image with Docker's **Linux** engine. On this Windows machine Docker Desktop is invoked with `docker.exe`; with Ubuntu Docker integration use `docker` instead.

```powershell
docker.exe build -f deploy/tee/Dockerfile -t neslos-tee:local .
docker.exe run --rm --read-only --cap-drop ALL --security-opt no-new-privileges --network none --tmpfs /tmp:rw,noexec,nosuid,size=64m --mount "type=bind,source=C:\Users\USER\Neslos\tests\tee-container.mjs,target=/tmp/tee-container.mjs,readonly" neslos-tee:local node /tmp/tee-container.mjs
```

The second command uses a **fake local socket** to check that bootstrap refuses private requests and the production startup rejects a fake Intel quote. It must print `genuineHardwareVerified:false`. It is packaging evidence only. The image runs as UID 1000, drops capabilities in Compose, uses a read-only root filesystem and writes its journal to a persistent volume.

Observed locally on 3 November: **165 application tests across 17 files**, strict TypeScript/production builds, the Linux TEE image build, Compose validation and this smoke command passed. The final smoke result was `{"containerChecks":"passed","bootstrapPrivateEndpoint":503,"fakeQuoteRejected":true,"genuineHardwareVerified":false,"uid":1000}`. The local image identifier was `sha256:5d4ec07085836724f8107b1c391db529e9ca0616c1cdf3fecd16e6459830839f`; it has not been published. Application verification run `82e97517-1117-4500-ad6f-b3067af15c3b` finished at `2026-11-03T21:11:12.088Z` with source-content digest `268ee63ee0b36101ea09f377c1f91d03ab13cb5ea7a6b4f6a7591bb079068ed8`. The source digest includes the TEE deployment inputs; documentation changes are excluded.

The application/build checks, TEE image build and smoke command passed again on **4 November**. Application run `1d6b973c-1c45-4f39-8d03-073c6b476b01` finished at `2026-11-04T11:50:04.815Z` with the same source-content digest. Browser and full contract checks also passed. [GitHub CI runs](https://github.com/Agozie180/Neslos/actions/workflows/verify.yml) track each pushed revision separately.

Publish the reviewed image to an owner-controlled registry when publication is authorized. Obtain the registry's actual Linux image digest; a local image ID is not an interchangeable registry manifest digest. Then render a deployment bundle:

```sh
npm run tee:bundle -- --image REGISTRY/neslos@sha256:ACTUAL_64_HEX_DIGEST --out .private/tee/bundle
```

The script refuses mutable tags, writes the image digest literally into `compose.yaml`, and records a local source/Compose digest. It does not deploy, provision hardware or calculate trusted hardware measurements. Keep the complete platform app-compose and init scripts too: the Docker Compose file alone is not the full dstack measurement input.

For the existing deployment owned by `neslos.testnet`, add `--testnet-vault vault.neslos.testnet`. This fixes the network and vault directly in the measured Compose; encrypted environment updates cannot switch them. The owner account pays testnet transaction fees. TDX hosting is a separate cloud resource and cannot be paid for with testnet NEAR. Use the [current deployment record](TDX-DEPLOYMENT-STATUS.md) for the successful standard-image path. The [provider follow-up](TDX-PROVIDER-FOLLOWUP-2026-11-07.md) preserves the earlier inline-request denials and then-recommended console flow; it is historical evidence.

The compact inline alternative requires no custom registry. `npm run build` now creates a clean server build and an `artifacts/tee-build.json` receipt; the bundler rejects stale/mixed source or output. Run the build and bundler in the same workspace. When using WSL, both the output and receipt stay in the Linux execution directory, not the Windows `dist`. See the [foundation audit](TDX-FOUNDATION-AUDIT-2026-11-07.md). After a verified build, reproduce the production dependency install in the pinned Linux image, then render a new bundle:

```sh
node scripts/tee-dependencies.mjs --out NEW_DEPENDENCY_MANIFEST.json
node scripts/tee-inline-bundle.mjs --compact --dependencies NEW_DEPENDENCY_MANIFEST.json --testnet-vault vault.neslos.testnet --attestation-only --out NEW_PRIVATE_DIRECTORY
```

This preserves every application and lockfile byte, using Brotli with lossless text/binary encoding. The [V3 bundle checked on 7 November](TDX-STARTUP-AUDIT-2026-11-07.md) is 150,387 bytes and passes the full official request schema. The dependency measurement needs Docker's Linux engine and network access to npm; no credentials are passed to the disposable measurement container. Regenerate it after changing package/lock bytes, the pinned base or installation settings. The bundler rejects missing or mismatched receipts. Treat the build host and receipt as trusted review inputs; a hash match does not establish that package source is free of vulnerabilities.

Every V3 startup checks the exact application file set and the entire installed dependency tree before importing application code. Additional module-resolution paths, substituted files and external dependency symlinks are rejected. The runtime mounts the application volume read-only. This closes the reproduced persisted-dependency substitution gap; it does not defend against a compromised guest root changing memory or files concurrently, or provide journal rollback protection. Historical V1/V2 bundles do not acquire this guard automatically.

Use a fresh application volume when upgrading an inline bundle so removed source files cannot remain from an older version. Preserve the separate journal volume and its checkpoints; do not delete recovery state to clear an integrity error.

`--attestation-only` fixes the mode and clears runtime secrets in the measured Compose; enabling private work requires a separately reviewed bundle. Setup receives no runtime secrets and disables npm lifecycle scripts. The V3 artifact was submitted and rejected on 7 November; the later standard image deployed successfully. The local integrity repair alone does not explain the earlier policy denial.

## Provision and establish trust

1. Create a [Phala account](https://cloud.phala.com/register) and confirm credit/billing terms. Select a CPU Intel TDX CVM with enough memory for Node and a persistent volume. Choose a supported production dstack OS, one replica, and no development/debug mode.
2. Use the rendered Compose in [Advanced deployment](https://docs.phala.com/phala-cloud/cvm/create-with-docker-compose). Start with `NESLOS_RUNTIME_MODE=attestation-only`; supply no owner token or inference key yet. Use platform encrypted registry credentials if the image is private.
3. The container needs access to `/var/run/dstack.sock`. Inspect its UID/GID/mode through the deployment operator. The Compose default adds GID 0 to UID 1000; set `NESLOS_DSTACK_GID` to the actual socket group when necessary. Do not expose the socket as a public HTTP service or make unrelated host directories writable.
4. Get the **actual HTTPS endpoint** from the platform's Network panel. `/health` reports `ready:false, execution:attestation-only`. `/private` returns 503. `/attestation/<fresh challenge>` can return evidence, but its availability alone does not establish trust.
5. Establish measurements using the [official dstack attestation procedure](https://github.com/Dstack-TEE/dstack/blob/next/docs/attestation-tdx.md): review/build the chosen OS and calculate MRTD/RTMR0–2 for its CPU/RAM configuration; replay the event log to match RTMR3 and check app/instance identity, reviewed compose, init-script hashes and key provider. Check the image digest matches the reviewed build. Do not copy arbitrary self-reported registers into an allowlist.
6. Write `approved-tee.json` in the private owner directory with `format:"neslos-tdx-policy-v1"` and the approved lowercase 48-byte hex `mrTd`, `rtMr0`, `rtMr1`, `rtMr2`, `rtMr3` values. Neslos also verifies Intel/DCAP, requires `UpToDate`, rejects debug mode and binds both executor/transport keys to its fresh challenge. A VM configuration change or recreated instance may require reviewed pins again; do not turn off checks to get past a mismatch.
7. Initialize the owner configuration with that file. This verifies the endpoint and saves the exact executor identity. It does not change the vault:

```sh
npm run private -- init --endpoint https://ACTUAL_ENDPOINT --tee-policy /private/approved-tee.json --network testnet --vault ACTUAL_VAULT.testnet --out .private/tee/runtime.json
npm run private -- attest --out .private/tee/attestation.json
npm run private -- new-token --out .private/tee/owner-token.json
```

These shell examples run from the Linux execution checkout (`~/.cache/neslos-ubuntu` with the pinned Node on PATH). Alternatively pass their arguments through `scripts/ubuntu.sh private`. The WSL wrapper does **not** copy `.private` between Windows and Linux: use explicit Linux paths or `/mnt/c/...` paths for inputs, and keep the Linux journal across restarts. The owner token is written locally with restrictive permissions and never printed by the CLI.

## Enable owner commands without inference

After independently approving the TDX measurements, set `NESLOS_RUNTIME_MODE=private`, `NESLOS_INFERENCE_ENABLED=false`, the approved `NESLOS_TEE_POLICY_JSON`, and the locally generated `NESLOS_OWNER_TOKEN`. Leave `NESLOS_INFERENCE_POLICY_JSON`, `NESLOS_INFERENCE_POLICY_FILE` and `NEARAI_API_KEY` empty. The runtime rejects conflicting inference configuration. This enables encrypted status, observation of previously prepared authorizations, and audit export/open with no inference calls or allowance. Research and preparation return `PRIVATE_RESEARCH_DISABLED`. A new instance has no previously prepared authorizations to observe.

The measured Compose must pass these settings into the container. Establish the complete allowed environment-name set while still in bootstrap mode, then verify that exact Compose and its RTMR3 before supplying the private-mode values. Phala preserves the previous environment-name set for a Compose update with `update_env_vars:false`; use its supported encrypted environment update to change the set, and review the resulting Compose. Keep registry credentials in the platform secrets when replacing the set.

`GET /platform` supplies only the app ID, instance ID and VM configuration used for measurement reconstruction. It is an informational input, not proof: verify the downloaded OS checksums, independently calculate all boot registers using the actual VM shape, and compare them to the Intel/DCAP-verified report. Recompute runtime event digests and check every event against the reviewed application configuration. The 9 November host uses QEMU 8.2.2 with `hotplug_off:false`; assuming the opposite changes ACPI measurements.

After restart, a fresh verified owner request must succeed. `/health` reports `ready:true` and `execution:status-observe-audit`; it does not replace the owner's attestation verification. Use a status request file containing `{"type":"status"}` with `npm run private -- execute --request PATH --out NEW_JOB_PATH`, then the audit commands below. Retain the encrypted audit and its checkpoint before a scheduled deletion.

## Enable private research

Set `NESLOS_INFERENCE_ENABLED=true` only with the approved inference configuration below. The runtime defaults to true when the flag is omitted, so existing deployments continue requiring inference policy and credentials.

Obtain the NEAR AI key and independently approve the gateway/model deployment measurements, using the [official verification guide](https://docs.near.ai/cloud/verification) and [JavaScript SDK guide](https://docs.near.ai/cloud/inference-sdk/javascript). Each of `gateway` and `model` requires `osImageHash`, `composeHash` (32-byte lowercase hex), and `boot:{mrTd,rtMr0,rtMr1,rtMr2}` (48-byte lowercase hex). Derive boot pins from reviewed OS artifacts and VM configuration. The required `modelDeployment` also pins the Compose Manager image, source commit/file/hash, selected services, and `actionsSha256` of its complete authenticated action history. Use the exact current `inferencePolicySchema`; old two-hash configurations are intentionally rejected. An advertised model name alone is insufficient. Paid inference defaults to disabled; add an explicit `budget` using the [credit policy guide](OWNER-WORKSPACE.md#inference-allowance).

Select an explicit compose file and a nonempty, unique service list for the enclosing policy's `modelId`. Services select the source/build review scope; a proxy-only selection does not verify the engine build. The full history hash still covers earlier engine launches and every control action. Selection checks the latest attempted launch before comparing approved commit/hash values and rejects later ambiguous mutations, stops, and service selections split across launches. Compose Manager logs attempts before success and omits project/environment controls; `up --remove-orphans` can also affect services outside its explicit list. Consequently, disjoint service names cannot justify skipping a later compose mutation. The returned `referenceKind: "latest-attempted-compose-up"` is inspection metadata, not a policy field or proof of successful/current container execution. Source bytes and image-build provenance must not be presented as that stronger claim. See the reviewed [Compose Manager source](https://github.com/nearai/compose-manager/blob/c7fbaaf5f8a993c6a3c53ac3748ed3b28bafcea3/src/main.rs).

`scripts/inference-setup.ts` performs free hardware/build preflight. Its inspection output is not an automatically approved policy. Review the complete measured launcher/init scripts and earlier engine deployment actions too: verifying selected proxy images does not prove every running container or exclude unrecorded administrative changes. A public-input probe from `scripts/provenance-live-inference.ts` explicitly reports `callerExecution:local-unattested`; it cannot substitute for running Neslos inside its own verified TDX instance.

Gateway build verification requires the signed API and ingress images. It also verifies either VPC component when present, without requiring absent services in newer gateway layouts. All gateway images must use literal digests; unresolved images and unknown `nearaidev` repositories are rejected. Exact approved gateway Compose and boot measurements remain mandatory. This compatibility change does not approve an observed deployment automatically.

The 7 November captures show different model deployments sharing a signing/encryption key. Signer filtering alone does not identify a serving VM. The opt-in direct policy replaces `gateway` with `direct:{baseUrl,spkiFingerprint,signingAddress,instanceId,approvedUntil,trust:"reviewed-provider-administration"}`. It still requires `model`, `modelDeployment`, `modelId` and `budget`. Only HTTPS `*.completions.near.ai/v1` origins are accepted. `connectAddress` optionally chooses an IPv4 route while preserving SNI, certificate/hostname validation and the exact TLS pin. E2EE, OHTTP, Ed25519, fresh verification and proxy/manager quote/instance association are mandatory. An unapproved fleet peer fails closed; there is no unpinned fallback.

For reviewed maintenance, `modelDeployment.reviewedTrailingActions` contains exact `{index,sha256}` entries. Each hash is SHA-256 of Neslos canonical JSON for that indexed action. Only exact trailing restarts or disjoint launches may be reviewed this way. Modified, misplaced, unused or unreviewed actions reject; the full `actionsSha256` remains mandatory. Review routing, dependencies, mounts, effective administration and engine provenance separately. The policy explicitly trusts the provider's current deployment/weight administration; it does not independently attest loaded weight bytes.

GLM's reviewed serving configuration supports `direct.reasoningEffort:"none"` with `direct.thinkingTokenBudget:null`. This disables reasoning instead of exhausting a small output allowance. Researchers request constrained JSON-schema output and still validate every response locally after checking its signature. The NVIDIA verifier retains the exact signed NRAS response for one three-second wait if its time claims are slightly ahead; all original time, signature, issuer and nonce checks remain mandatory.

Run a free check against an independently reviewed gateway or direct runtime policy:

```sh
node --env-file=.env --import tsx scripts/inference-preflight.ts --policy reviewed-policy.json --out .private/fresh-preflight.json
```

An archived approval is specific to its reviewed history and expiry. Do not extend its expiry or copy new observed hashes without reviewing the changes. A free preflight does not spend inference credit or prove execution inside Neslos's TDX instance.

Use Phala's **Encrypted Secrets** for the full set of runtime values from [secrets.example.env](../deploy/tee/secrets.example.env): mode `private`, network/vault, TEE policy JSON, inference policy JSON, the locally generated owner token, and NEAR AI key. `ONECLICK_JWT` is only needed for the current confidential-quote path; read-only research never requests a quote. No owner NEAR private key goes into the TEE. Keep Phala public logs disabled; Neslos does not log prompt/recipient/secret data. Secret updates replace the full set and restart the CVM, per [Phala's docs](https://docs.phala.com/phala-cloud/cvm/set-secure-environment-variables).

After restart, verify a **fresh** quote against approved pins again. Private startup fails on invalid measurements, a missing socket/key, bad policy or an unreadable/tampered journal. If the platform changed measurements, review that change rather than accepting it automatically. `/health` is a readiness signal, not an attestation proof.

The vault must pin the attested executor before private research runs. Create a private JSON request containing `{"kind":"pin-executor"}` and prepare a plan:

```sh
npm run private -- plan --request .private/tee/pin.json --out .private/tee/pin-plan.json
# Review the printed owner, vault, network, method, key, gas and approval hash.
npm run private -- submit --plan .private/tee/pin-plan.json --approve-hash ACTUAL_PRINTED_HASH --credentials /private/owner.testnet.json
npm run private -- state
```

The `submit` command signs a real transaction when the owner invokes it. It checks the exact plan hash, owner/network and current policy version, and saves signed bytes before broadcasting. Repeating the **same** plan reconciles its saved transaction hash. It never creates a replacement payment on a timeout. Keep the transaction directory; an unresolved hash needs investigation, not journal deletion. Pinning changes the vault's policy version and invalidates old executor authorizations.

Prepare `research.json` with `type:"research"`, a prompt, `venues:[{name,salt}]`, and `research:{stablecoinsOnly,allowBridgedAssets,minimumLiquidityUsd}`. An `id` may be omitted; the owner CLI saves a new UUID before sending. Salt openings must match the owner's on-chain venue commitments. The runtime applies the actual on-chain output allowlist; a fixture-token-only testnet policy can legitimately make every mainnet yield row ineligible. Update an owner policy using `{"kind":"policy","policy":...}` through the same plan/review/submit sequence if you want allowed mainnet research candidates. Research can run while spending is paused.

```sh
npm run private -- execute --request .private/tee/research.json --out .private/tee/research-job.json
npm run private -- audit-export --out .private/tee/audit.json
npm run private -- verify-audit --audit .private/tee/audit.json
npm run private -- audit-open --audit .private/tee/audit.json --entry ACTUAL_RESEARCH_RECEIPT_UUID --out .private/tee/research-opened.json
```

The completed job contains the reports, source evidence, eligible/excluded rankings and policy snapshot. The audit bundle contains signed ciphertext and a checkpoint; exporting it again checks that the previous checkpoint is still in the history. Keep a separate backup/checkpoint. Receipt opening writes **sensitive plaintext locally** with an executor signature binding its hash to the encrypted receipt. It is authenticated TEE testimony about decryption, not a zero-knowledge proof. Export/open do not append copies of the journal into itself. Exports pin their snapshot across pages.

Large exports may cross the service's rate window. The owner client honors HTTP 429 backoff and retries the same snapshot page with a fresh attestation, at most twice per page; other errors stop the download without replacing the previous verified bundle.

## Payment preparation, settlement and recovery

For a funded route use a separate owner-approved mainnet vault, native NEAR USDC, the real Confidential Intents recipient/opening and allowed output assets. `prepare` adds `amount` in canonical smallest units, `kind` (`private-payment` or `allocation-reserve`), and `counterparty:{recipient,salt}` to the research request shape. It obtains and verifies a signed quote and creates an executor authorization. It does not send funds by itself.

```sh
npm run private -- execute --request .private/tee/prepare.json --out .private/tee/prepared-job.json
npm run private -- plan --job .private/tee/prepared-job.json --out .private/tee/payment-plan.json
# Only for an explicitly reviewed funded mainnet operation:
npm run private -- submit --plan .private/tee/payment-plan.json --approve-hash ACTUAL_PRINTED_HASH --credentials /private/mainnet-owner.json --allow-mainnet
```

The owner reconstructs the allowed FunctionCall, checks the executor signature and rejects a substituted receiver/action/gas/deposit. It checks nonce, expiry, owner and policy again before first submission. Recovery of an already-signed transaction still observes its saved hash after those values change. The on-chain vault remains the final budget authority. Gas and storage are separate from the token cap.

For observation use `{"type":"observe","authorizationHash":"ACTUAL_HASH"}`. Use a **new job file** for each new poll; reuse the existing file to recover the same interrupted poll. Pending responses intentionally remain the saved result of that poll. A successful or refunded provider observation prepares a settlement call; run `plan --job` and review/submit it separately. Unknown results never resend funds. Audit export/open works for these receipts too.

Governance requests also support `{"kind":"pause","paused":true}` and `{"kind":"withdraw","amount":"CANONICAL_UNITS"}`. Owner recovery sends to the contract's owner, not an arbitrary recipient. The owner dashboard and CLI also prepare fixed-token funding and storage-registration plans; see [owner setup](OWNER-WORKSPACE.md).

## Limits that remain

- Private NEAR AI research and TDX owner controls have live evidence, including restart persistence. The server was deliberately retired after the completed proof to control cost. A new run is optional and needs fresh approval and bounded hosting. Loaded weights remain under explicit provider-administration trust. The separate [owner-wallet Confidential Intents round trip](CONFIDENTIAL-SETTLEMENT-2026-11-09.md) returned full principal but exceeded its native fee cap. Funded settlement through the complete TDX/mainnet-vault path remains unverified.
- All three model reviewers must explicitly approve an eligible market; their assessments can veto or change selection. The separate [public commerce client](COMMERCE.md) routes lending/payment principal through the vault's limits and rejects confidential policies; it is not a TEE execution path. Funded lending validation remains unfinished, and Agent Market payment is disabled because its documented rail requires a wallet delegate.
- The default browser remains a rehearsal. The separate localhost owner browser uses this same private client and exact transaction workflow. Its cloud-backed operation requires the approved runtime.
- Immutable encrypted journal segments retain all history through bounded rotation (128 MB; 10,000 completed/failed commands). Keep the manifest and segments together. Finite research/observation schedules are supported. Rollback protection still depends on independently retained checkpoints; after storage failure the runtime fails closed. See the [backup procedure](OWNER-WORKSPACE.md#journal-backup-and-recovery).
- NEAR public policy, deposits, amounts and timing remain visible. The 1Click provider sees routing fields, and provider status is not an independent destination-chain proof. The private quote endpoint previously required credentials here despite the general 1Click unauthenticated flow.
