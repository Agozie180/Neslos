# Live inference provenance review — 2026-11-06

Neslos successfully verified live NEAR AI gateway, model TDX, and NVIDIA GPU attestation evidence for `Qwen/Qwen3.8-27B`. Independent calculations reproduced MRTD, RTMR1, and RTMR2 for both provider VMs. **The deployment is not approved for Neslos inference:** RTMR0 still needs an independently reproduced ACPI configuration.

This was an evidence preflight. It made **zero paid model-completion calls**, produced no inference response or response receipt, and did not demonstrate that the local Neslos executor ran inside TDX. The caller ran on a local workstation; the verified hardware evidence belonged to the provider's gateway and model infrastructure. Raw provider reports, instance identifiers, credentials, and account information are intentionally excluded from this public review.

## What the live preflight established

The [evidence-collection script](../scripts/inference-setup.ts) used `InferenceClient.verify()` from `@nearai/inference-sdk` 0.2.1, with accepted Intel TCB status restricted to `UpToDate`, GPU evidence required, and attestation caching disabled.

| Check | Observed result | Scope |
| --- | --- | --- |
| Gateway Intel TDX evidence | Verified; `UpToDate` | Genuine quote verification, rather than parsing provider JSON alone |
| Gateway TLS binding | Attested | SDK authenticated the gateway and its TLS binding before sending credentials for model evidence |
| Model Intel TDX evidence | Verified; `UpToDate` | Provider model TEE evidence |
| Model NVIDIA evidence | Verified | Required GPU evidence passed the SDK verifier |
| Configured gateway image provenance | Passed | Four configured NEAR image repositories: Cloud API, ingress, VPC, and VPC client |
| Model image provenance | Passed for the configured scope | Selected inference proxy images and the current Compose manager |
| Firmware event-log replay | Matched quoted RTMR0–2 on both VMs | Authenticates the recorded digest sequences; independent approval of their contents is a separate check |
| Paid inference and signed completion | Not exercised | No response-level claim can be made from this preflight |

The image checks do not cover every image or downloaded dependency in the provider's deployment. Their configured scope is visible in [inference-provenance.ts](../src/core/inference-provenance.ts). Successful hardware attestation and successful checks for selected images do not by themselves approve the entire software stack.

## Independent OS and boot calculations

The OS artifacts were traced to the official [dstack OS v0.5.12 release](https://github.com/Dstack-TEE/meta-dstack/releases/tag/v0.5.12), source commit `7f7b2762d4353943eb2c004d89025977794d7d24`. Reduced measurement archives came from the [pinned NEAR AI mirror](https://github.com/nearai/dstack-images/tree/8231c8acc309cd4c2f3963a86c18f21f725a8536). Their internal `sha256sum.txt` manifests hashed to the published OS IDs.

| Artifact | Gateway CPU OS | Model NVIDIA OS |
| --- | --- | --- |
| Published OS image hash | `8db40cb23008d6213668b5816702d100b37b859a8a5bfd18d938ae3a1b3715bd` | `91fd5d69ccee3e5ea4f2aeb8c9b632c4358c4ecfc29ba1aa6fb1e402af209829` |
| Downloaded measurement archive SHA-256 | `e6e3464266f0da55ba2b0ce10504533ade72870b648ece2918b664ecddefb97a` | `9174506ea67da89187f1dbc917dae7582e3bb268e02b151b7f15bc8df1c3a083` |
| MRTD page-add order that reproduced the quote | Two-pass | Single-pass |
| MRTD / RTMR1 / RTMR2 | Independently reproduced | Independently reproduced |
| RTMR0 | Unresolved | Unresolved |

Calculations used `dstack-mr` built from official dstack commit [`43f69f41cc546423f9f73fc48b16f8cf19053cbc`](https://github.com/Dstack-TEE/dstack/tree/43f69f41cc546423f9f73fc48b16f8cf19053cbc/dstack-mr), with `cargo +1.93.0 build -p dstack-mr-cli --locked --release`. The ACPI helper came from the immutable image documented in the upstream [KMS build instructions](https://github.com/Dstack-TEE/dstack/blob/43f69f41cc546423f9f73fc48b16f8cf19053cbc/docs/tutorials/kms-build-configuration.md):

```text
dstacktee/dstack-kms@sha256:11ac59f524a22462ccd2152219b0bec48a28ceb734e32500152d4abefab7a62a
```

The helper and firmware files were extracted without launching a KMS. The calculated registers below match the verified live quote bytes. They are a **partial calculation result, not a complete approval policy**; RTMR0 is deliberately absent.

```text
Gateway:
MRTD  = 7fe60787222bd394cb516abca2435f22f035ab2cc9c0a4b4b3b148e46297f3d931a237b72f359052c6e657d8c1409173
RTMR1 = 4ae609807c765916a31d724786ed74bcb97e168a9d937b04936aeef2015c907eba5ac352c6bcd749c246fd62ffb659ec
RTMR2 = 764489f277a8540189761e72b4238ba36d4d647e11bd958d8ab5522af2a4867b0ff63e06b0c4967f1857236244040a5d

Model:
MRTD  = df4d77c857de652bd0fafa343a2026b51071ee03773d076d283abf1a7d36ff91ffa279ee4a617ac664f7e2a2c8d5891b
RTMR1 = 4ae609807c765916a31d724786ed74bcb97e168a9d937b04936aeef2015c907eba5ac352c6bcd749c246fd62ffb659ec
RTMR2 = bd67ab7554dc27ab03a077bc1447a1a67d0624ff547c4c809a8626f12d6a89712f8ec60e781e99b98208574065d21a71
```

The measurement implementation is reviewable in upstream [machine.rs](https://github.com/Dstack-TEE/dstack/blob/43f69f41cc546423f9f73fc48b16f8cf19053cbc/dstack-mr/src/machine.rs), [tdvf.rs](https://github.com/Dstack-TEE/dstack/blob/43f69f41cc546423f9f73fc48b16f8cf19053cbc/dstack-mr/src/tdvf.rs), and [acpi.rs](https://github.com/Dstack-TEE/dstack/blob/43f69f41cc546423f9f73fc48b16f8cf19053cbc/dstack-mr/src/acpi.rs).

## The remaining RTMR0 gap

Both firmware logs contain 13 RTMR0 events. Replaying each complete digest sequence reproduces its verified quote register. Ten events were also independently reproduced from the published firmware and configuration calculations. The unresolved events are indexes 8–10: **ACPI loader, ACPI RSDP, and ACPI tables**.

A port of upstream `measure_td_hob`, cross-checked against the unmodified CLI, tested memory sizes from 1 through 1024 GiB. It found unique HOB-digest matches at **8 GiB for the gateway** and **200 GiB for the model VM**. This narrows the remaining configuration problem; it does not determine CPU count or PCI layout.

The bounded search then tested the following sets. The extended PCI/hotplug combinations used a smaller subset of the listed CPU counts, so the table is not a claim that every Cartesian combination was tested.

| Refined search | Gateway | Model |
| --- | --- | --- |
| vCPU counts | 1, 2, 4, 6, 8, 12, 16, 24, 32 | 8, 12, 16, 20, 24, 32, 40, 48, 56, 64, 96 |
| Memory | 8 GiB | 200 GiB |
| QEMU version parameters | 8.2.2, 9.1.0, 9.2.1 | 9.1.0, 9.2.1 |
| PCI hole64 parameter | Default, 64 GiB, 1 TiB | Default, 64 GiB, 1 TiB |
| PCI hotplug | Enabled and disabled | Enabled and disabled |
| Attempts | 87 | 84 |
| Successful calculations | 87 | 62 |
| Helper errors | 0 | 22 hugepage/NUMA attempts |
| Complete RTMR0 matches | 0 | 0 |

An earlier coarse search calculated 25 gateway and 32 model shapes. The refined model search recorded the helper's `NUMA node binding are not supported by this QEMU` errors as unsupported attempts, not negative matches. No helper rebuild or substitution of observed digests was used to force a result.

The provider evidence does not supply the VMM CPU count, exact QEMU build and command line, PCI/device topology, host-share mode, or NUMA/hugepage configuration. Firmware event payloads contain digests but no ACPI table bytes. The referenced provider infrastructure repository was unavailable through the GitHub API. An attempted gateway public system-information route failed during TLS setup; no public model guest-agent mapping was available in the reviewed evidence.

Further work needs the exact provider VM configuration, or actual ACPI table/loader bytes with enough configuration detail to reproduce them independently. **Copying the observed RTMR0 into an allowlist would not close this gap.**

## Launcher source correspondence and deployment scope

The measured deployment pins this launcher image:

```text
nearaidev/compose-manager-launcher@sha256:079a14b41deb11e0e27f9b69648e8b3d89bd6fb9ccf6071643b8f447fa415085
```

The public OCI manifest, image configuration, and every compressed layer were downloaded and checked against their referenced SHA-256 digests. The image was not executed. Its final launcher files were extracted and compared byte-for-byte with source at Compose manager commit `c7fbaaf5f8a993c6a3c53ac3748ed3b28bafcea3`:

| Image file | Published source | SHA-256; exact byte match |
| --- | --- | --- |
| `/app/launcher.sh` | [launcher.sh](https://github.com/nearai/compose-manager/blob/c7fbaaf5f8a993c6a3c53ac3748ed3b28bafcea3/launcher/launcher.sh) | `262f07bbb9735721d43744160caf846db488a75f42267983529dc8eec3a31785` |
| `/app/docker-compose.yml` | [docker-compose.yml](https://github.com/nearai/compose-manager/blob/c7fbaaf5f8a993c6a3c53ac3748ed3b28bafcea3/launcher/docker-compose.yml) | `7b06fd981e3f4d1a913f33d87d78f67711a77a9612b8e5c2008e9d230e924cb9` |

The extracted cosign executable has SHA-256 `c956e5dfcac53d52bcf058360d579472f0c1d2d9b69f55209e256fe7783f4c74`, exactly matching the official [cosign v3.0.6 checksum list](https://github.com/sigstore/cosign/releases/download/v3.0.6/cosign_checksums.txt). This establishes file correspondence. It does not assert a reproducible build of the whole image: the Alpine 3.21.7 base and APK binaries remain upstream publisher dependencies. The checked GitHub attestation endpoint returned 404 for this launcher digest, and the OCI referrers endpoint returned zero entries; a launcher build attestation was not verified.

The authenticated manager history contained ten actions: two manager starts, seven `compose_up` actions, and one `compose_stage`. Neslos now pins the complete authenticated action array through `actionsSha256`, along with the reviewed deployment commit, file hash, manager image, and selected services. This hash uses Neslos's recursive canonicalization and is distinct from the provider's wire-format `actions_hash`.

The selected base-model proxy enforces `Qwen/Qwen3.8-27B`; a separate proxy selects an abliterated LoRA adapter. The reviewed engine launch pinned an immutable SGLang image and a model-weight revision. The downloader still obtains an unpinned `huggingface_hub` distribution through `uvx`. The [engine deployment source](https://github.com/nearai/cvm-compose-files/blob/cab4087076ad5321f3c2413627d30af455eb3cb6/prod/qwen38-27b-abliterated-cc-1gpu.yaml) and [later proxy deployment source](https://github.com/nearai/cvm-compose-files/blob/75d31e6461dc51465a81ff69203200a51a820d1c/prod/qwen38-27b-abliterated-cc-1gpu.yaml) are separate reviewed revisions.

The Compose manager has Docker-socket access, host PID visibility, and administrative capabilities. The launcher follows manager updates signed by the configured GitHub workflow identity. An authenticated action history is evidence of recorded actions; it is not independent proof of the current contents of all containers and weights, or proof that an operator made no unrecorded changes.

## Reproduction and enforcement

To collect fresh preflight evidence with an existing API key configured in the local environment, use a new output filename:

```sh
node --env-file=.env --import tsx scripts/inference-setup.ts \
  --model Qwen/Qwen3.8-27B \
  --out .local/private/inference-inspection-new.json
```

This invokes evidence verification, not Chat completion. Without an independently reviewed `--approval` file, it explicitly reports `approved: false`. The output contains provider reports and should remain private. The script exclusively creates the output file and will not overwrite existing evidence.

For boot reproduction, obtain the measurement archives and helper from the pinned sources above, build the pinned `dstack-mr` CLI, and place the helper and its documented firmware files on the tool's search path. The following are example **unapproved** configurations used to reproduce the partial result:

```sh
RUST_LOG=debug dstack-mr measure /path/to/cpu/metadata.json \
  --cpu 4 --memory 8G --qemu-version 8.2.2 --json

RUST_LOG=debug dstack-mr measure /path/to/gpu/metadata.json \
  --cpu 16 --memory 200G --qemu-version 9.1.0 --num-gpus 1 --json
```

The upstream debug output exposes the independently calculated firmware event digests. Compare every register and event sequence with fresh verified evidence; these example commands are not a provider-certified VM shape and do not produce an approved RTMR0.

The [runtime client](../src/core/inference.ts) and [boot verifier](../src/core/inference-provenance.ts) require MRTD and RTMR0–2 allowlists for both gateway and model, as well as runtime OS/Compose and deployment-history checks. They authenticate the quote before comparing those exact quote bytes with the approved boot values. No observed RTMR0 was promoted to an approved policy in this review.

The prepared [live-response probe](../scripts/provenance-live-inference.ts) was **not run**. A future authorized run must satisfy the strict policy and separately verify a `provider_tee` completion signature binding the canonical model ID and hashes of the exact encrypted request and response bytes. A gateway-only receipt is insufficient. These requirements describe implemented checks, not a successful paid inference or proof that the local caller itself executed inside TDX.

The standalone probe is limited to one paid call, reserved at no more than one cent, using the fixed `.private/provenance-live-inference-reservation.json` file. It refuses a second call even with a different output filename; failed or uncertain outcomes retain the reservation. Keep this file across restarts. Deleting private history or replacing the checkout is outside this local storage guarantee. The separate TEE research budget must also account for any standalone probe spending.
