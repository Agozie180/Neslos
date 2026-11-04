# Running Neslos in a TEE

The private owner CLI and [local owner browser](OWNER-WORKSPACE.md), research/prepare/observe commands, audit export/open, reviewed transaction submission and dstack container package are implemented. The owner guide covers credit caps, finite schedules, storage/funding and segmented journal recovery. Genuine remote execution still needs a provisioned Intel TDX instance, independently approved measurements, and NEAR AI credentials. A local Docker build and test socket cannot supply those.

The first remote demonstration can use **private research plus a testnet vault**. It makes no Intents deposit and needs no GPU of your own: Neslos runs on a CPU TEE and sends encrypted research requests to NEAR AI's attested model service. Research data still describes NEAR mainnet yields. A testnet research result is not a private payment or a lending deposit.

For Phala authentication, distinguish `PHALA_AI_API_KEY` (Private AI) from `PHALA_CLOUD_API_KEY` or official `phala login` (CVM management). `npm run cloud:status` checks each scope without paid calls. The [4 November credential audit](PHALA-AUTH-AUDIT.md) resolved the local scope mismatch and authenticated both products; it also records the verified balance, post-paid billing mode and CPU/storage prices.

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

> I'm building Neslos for NEAR HACKATHON, ending 14 November 2026. It uses an Intel TDX/dstack executor, verified NEAR AI inference, and an on-chain spending vault. Do you offer enough CPU CVM credit for development and a demo through judging? I need a genuine quote-capable instance and a way to prevent charges beyond the credit. The runtime is a single Node container; no GPU is needed.

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

## Enable private research

Obtain the NEAR AI key and independently approve the gateway/model deployment measurements, using the [official verification guide](https://docs.near.ai/cloud/verification) and [JavaScript SDK guide](https://docs.near.ai/cloud/inference-sdk/javascript). The inference policy has `modelId`, `gateway:{osImageHash,composeHash}` and `model:{osImageHash,composeHash}`; each hash is a real 32-byte hex measurement. An advertised model name alone is not sufficient. Paid inference defaults to disabled; add an explicit `budget` using the [credit policy guide](OWNER-WORKSPACE.md#inference-allowance).

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

- No genuine remote instance, live inference, signed confidential quote or funded settlement is claimed until its actual evidence is captured. Docker and fixture checks do not replace that.
- All three model reviewers must explicitly approve an eligible market; their assessments can veto or change the deterministic selection. Actual lending deposits, withdrawals, position accounting and paid external-agent coordination remain future scope.
- The default browser remains a rehearsal. The separate localhost owner browser uses this same private client and exact transaction workflow. Its cloud-backed operation requires the approved runtime.
- Immutable encrypted journal segments retain all history through bounded rotation (128 MB; 10,000 completed/failed commands). Keep the manifest and segments together. Finite research/observation schedules are supported. Rollback protection still depends on independently retained checkpoints; after storage failure the runtime fails closed. See the [backup procedure](OWNER-WORKSPACE.md#journal-backup-and-recovery).
- NEAR public policy, deposits, amounts and timing remain visible. The 1Click provider sees routing fields, and provider status is not an independent destination-chain proof. The private quote endpoint previously required credentials here despite the general 1Click unauthenticated flow.
