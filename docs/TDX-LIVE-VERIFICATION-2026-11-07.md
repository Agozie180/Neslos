# Neslos live TDX verification — 7 November 2026

**Neslos ran successfully on Phala Cloud at 22:13–22:14 UTC.** The Ubuntu-tested private image was deployed in attestation-only mode. Its HTTPS health and challenge routes worked, private commands returned 503, and a fresh application quote passed Intel/DCAP verification with TCB `UpToDate` and debug mode disabled. This established live hardware evidence; independent approval of the complete boot measurements was unfinished at that snapshot. The subsequent 9 November stage completed that approval for its own deployment.

The test CVM was scheduled for deletion at **2026-11-07 23:03:24 UTC / 8 November 00:03:24 Lagos**. Its absence was confirmed on 9 November by HTTP 404 and an empty inventory before the next launch. This endpoint is retired. The [durable evidence archive](../deploy/tdx-20261107/record.json) preserves this success; [9 November private-stage verification](TDX-PRIVATE-STAGE-2026-11-09.md) records the subsequent independent boot approval and enabled owner commands.

| Item | Verified value |
| --- | --- |
| Endpoint | https://f2818f503981a8ca276012dfce7d828f7806fff0-8443.dstack-pha1-prod5.phala.network |
| CVM UUID | `b2d971d2-ed2e-45af-af35-c4d4e77e0707` |
| App ID | `f2818f503981a8ca276012dfce7d828f7806fff0` |
| Instance ID | `d6c42d8aca21b4919f0fc5a99f7cbb43f3053cda` |
| Instance / OS | `tdx.small`, 1 vCPU, 2 GB RAM, 20 GB disk; production `dstack-0.6.1` |
| Hourly rate | $0.060780, including $0.002780 disk; actual invoice not yet reconciled |
| Image | `ghcr.io/agozie180/neslos-tee@sha256:e950fdb651ea681773b7f28e2d93e4e5f0698492bd25d3c292e8ebde161eda99` |
| Container | One running container, `/dstack-neslos-1`, reported healthy |
| Image configuration digest | `sha256:20e4404781ef8712c20329a3406ab2c68fb42a4772e8bfc045514576a659b639` |
| Measured app-compose hash | `edefca87713f784418f93fb0f179ef8722f3dcb26d339326c5592dc36e66f454` |
| Docker Compose SHA-256 | `a3427c9faa10cb0c7f0d1ab1f8755cf380669101bb51112780658e7a38949a33` |
| OS image hash | `ec43cb8c5e04b6bb6c53b33b16076a01d83d01f7f4b703f2f78a0d947d6247e6` |

## What fixed deployment

The standard application image passed Ubuntu WSL smoke checks, was privately published by its Linux/amd64 platform digest, pulled back from GHCR, and verified against all 50 application/package/fixture files and all 19,948 installed dependency files. The original image-index upload did not complete; the published platform digest is the verified deployment reference.

The image-based request initially received the specific `ERR-03-018` OS/node/key-provider compatibility error for `dstack-0.5.12`. Selecting the advertised production `dstack-0.6.1` allowed preparation and launch. The earlier generic HTTP 400 terms-of-use messages remain historical; their exact internal classification rule was not disclosed.

The first boot could not pull GHCR because its app-compose had no pre-launch script. The owner explicitly authorized the existing GitHub token for Phala's encrypted registry-secret mechanism. The three `DSTACK_DOCKER_*` variables were supplied encrypted, but Docker needed a startup login step to consume them.

Phala's supported `pre-launch-script/upgrade-to-latest-official` endpoint installed official script v0.0.20, SHA-256 `982181610f70be9087b1c69b36b719b47b82d37fcef8acc9289ed3bb3095ffe8`. Its login then failed while saving Docker credentials to read-only `/root/.docker`. A minimal prelude selects `DOCKER_CONFIG=/run/neslos-docker-auth` and creates it with mode 0700 before running the official script unchanged. The directory is root-only tmpfs in the guest, and is not mounted into the application container. The resulting script SHA-256 is `cd2cffb788066a3e5cb58022c567beab68ab5ded6d62923c65847cc781a9c1a7`. Bash syntax validation passed in Ubuntu; Phala accepted the compose update, and the next boot started the healthy image.

The installed `phala ps` CLI has a response-schema mismatch: it expects numeric `manifest_version`, while the API returns a string. Reading the documented authenticated `/composition` endpoint directly confirmed the running, healthy container. This CLI display failure did not prevent application execution.

## Live verification

- HTTPS `/health`: HTTP 200, `ready:false`, `execution:attestation-only`, `attestationAvailable:true`.
- HTTPS `/private`: HTTP 503 with `ATTESTATION_ONLY`.
- `/attestation/<fresh random 32-byte nonce>`: valid application evidence, including a 5,010-byte quote.
- `@phala/dcap-qvl` 0.7.0 verified Intel signatures and collateral, TDX platform, and TCB `UpToDate`.
- The verified report has debug disabled and binds the fresh nonce, executor public key and transport public key to the application's report-data format.
- All 11 RTMR3 runtime-event payload digests were recomputed; replay matches the cryptographically verified quote's RTMR3.
- The authenticated event log's compose hash matches the locally recomputed hash of the deployed app-compose. Its app ID, instance ID and OS image hash match the Cloud resource.
- Scheduled deletion was read back after both startup updates and again at 22:14 UTC using API version `2025-10-28`. The current detail schema omits this field.

The quote SHA-256 is `56854ecc2ae20a3463a8204b076c18a0d8eaf132e5336012e7cf408a0f4d2995`. Retained measurements are observations, not an automatically approved trust policy. Event-log consistency and a valid quote do not replace independently reproducing and reviewing MRTD/RTMR0–2 and the complete measured boot/runtime configuration.

The network remains testnet, vault `vault.neslos.testnet`, owner `neslos.testnet`. No owner, inference or Intents secrets were enabled. No inference purchase, chain transaction or support message was made during this deployment continuation. The $3 total cap ($2.75 hosting, $0.25 inference) remains in force. A brief earlier CVM was deleted by an overstrict schedule-readback guard; its absence was verified before the current CVM was created. Its small additional hosting charge has not been invoiced or reconciled here.

## Evidence and remaining scope

The selected quote, Compose and verification results are permanently retained in [deploy/tdx-20261107](../deploy/tdx-20261107/record.json) with file checksums. Additional local diagnostics are retained in `.local/wsl-smoke-20261107/`: `live-smoke-result.json`, `live-attestation.json`, `live-event-log.json`, `final-result.json`, `final-composition.json`, `final-compose.json`, `final-schedule.json`, `writable-pre-launch.sh`, the provisioning/update responses, `result.json`, and `remote-image-smoke.json`. These files contain no plaintext registry token.

The [Terms review](PHALA-TERMS-REVIEW-2026-11-07.md) found no confirmed prohibited operation in this attestation-only startup. Acceptance and successful execution of this configuration do not settle the broader financial-workflow interpretation or identify the earlier rejection predicate. Complete boot-measurement approval, inference deployment/routing approval, enabled private research, funded settlement, and a continuously hosted demo remain separate work.
