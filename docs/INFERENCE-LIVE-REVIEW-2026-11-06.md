# Live inference provenance review — 2026-11-06

Neslos successfully verified live NEAR AI gateway, model TDX, and NVIDIA GPU attestation evidence for `Qwen/Qwen3.8-27B`. Independent calculations reproduced **MRTD and RTMR0–2 for both provider VMs**, including every RTMR0 event. The missing configuration was present in the provider's raw response and omitted by SDK normalization. **The deployment remains unapproved in this review:** deployment selection and the scope of administrative trust require separate treatment from boot reproduction.

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
| Model image provenance | Passed for the configured scope | Selected proxy image digests and the current Compose manager; the model-specific action-selection issue below limits the deployment claim |
| Firmware event-log replay | Matched quoted RTMR0–2 on both VMs | Authenticates the recorded digest sequences; independent approval of their contents is a separate check |
| Paid inference and signed completion | Not exercised | No response-level claim can be made from this preflight |

The image checks do not cover every image or downloaded dependency in the provider's deployment. Their configured scope is visible in [inference-provenance.ts](../src/core/inference-provenance.ts). Successful hardware attestation and successful checks for selected images do not by themselves approve the entire software stack.

The final read-only rerun used the permanent `InspectableInferenceClient` with the explicit `prod/small-models.yaml` / `proxy-qwen38-27b` selector. Hardware, GPU, attested TLS and gateway image checks passed. The model build check correctly stopped at `PROVENANCE_COMPOSE_AMBIGUOUS_MUTATION`, so the script exited with status 2 and `approved:false`. Earlier scoped image checks in the table are not approval of this current deployment. The private evidence now preserves both parsed reports and exact response bytes in base64, with a reproducible SHA-256 digest; request credentials are not recorded.

## Independent OS and boot calculations

The OS artifacts were traced to the official [dstack OS v0.5.12 release](https://github.com/Dstack-TEE/meta-dstack/releases/tag/v0.5.12), source commit `7f7b2762d4353943eb2c004d89025977794d7d24`. Reduced measurement archives came from the [pinned NEAR AI mirror](https://github.com/nearai/dstack-images/tree/8231c8acc309cd4c2f3963a86c18f21f725a8536). Their internal `sha256sum.txt` manifests hashed to the published OS IDs.

| Artifact | Gateway CPU OS | Model NVIDIA OS |
| --- | --- | --- |
| Published OS image hash | `8db40cb23008d6213668b5816702d100b37b859a8a5bfd18d938ae3a1b3715bd` | `91fd5d69ccee3e5ea4f2aeb8c9b632c4358c4ecfc29ba1aa6fb1e402af209829` |
| Downloaded measurement archive SHA-256 | `e6e3464266f0da55ba2b0ce10504533ade72870b648ece2918b664ecddefb97a` | `9174506ea67da89187f1dbc917dae7582e3bb268e02b151b7f15bc8df1c3a083` |
| MRTD page-add order that reproduced the quote | Two-pass | Single-pass |
| MRTD / RTMR0 / RTMR1 / RTMR2 | Independently reproduced | Independently reproduced |
| RTMR0 event digests | All 13 independently reproduced | All 13 independently reproduced |

Calculations used `dstack-mr` built from official dstack commit [`43f69f41cc546423f9f73fc48b16f8cf19053cbc`](https://github.com/Dstack-TEE/dstack/tree/43f69f41cc546423f9f73fc48b16f8cf19053cbc/dstack-mr), with `cargo +1.93.0 build -p dstack-mr-cli --locked --release`. The ACPI helper came from the immutable image documented in the upstream [KMS build instructions](https://github.com/Dstack-TEE/dstack/blob/43f69f41cc546423f9f73fc48b16f8cf19053cbc/docs/tutorials/kms-build-configuration.md):

```text
dstacktee/dstack-kms@sha256:11ac59f524a22462ccd2152219b0bec48a28ceb734e32500152d4abefab7a62a
```

The helper and firmware files were extracted without launching a KMS. The calculator binary SHA-256 was `15a5412695ae8ee9640fdde4eafe7c5959317655918a4cc586f70b23e03068ec`; the helper SHA-256 was `b32e114c4ee78bec98b6242732d907bbefa4b498f233c92308186475f0118030`. The calculated registers below match the verified live quote bytes. They are complete boot-calculation results, **not a complete deployment approval policy**.

```text
Gateway:
MRTD  = 7fe60787222bd394cb516abca2435f22f035ab2cc9c0a4b4b3b148e46297f3d931a237b72f359052c6e657d8c1409173
RTMR0 = d090162bff4b1d1dc74dc59dc548838efc4b811b173da8536efa8e2a9c045da70ee092301293ad90afebee448bcd0211
RTMR1 = 4ae609807c765916a31d724786ed74bcb97e168a9d937b04936aeef2015c907eba5ac352c6bcd749c246fd62ffb659ec
RTMR2 = 764489f277a8540189761e72b4238ba36d4d647e11bd958d8ab5522af2a4867b0ff63e06b0c4967f1857236244040a5d

Model:
MRTD  = df4d77c857de652bd0fafa343a2026b51071ee03773d076d283abf1a7d36ff91ffa279ee4a617ac664f7e2a2c8d5891b
RTMR0 = bc122d143ab768565ba5c3774ff5f03a63c89a4df7c1f5ea38d3bd173409d14f8cbdcc36d40e703cccb996a9d9687590
RTMR1 = 4ae609807c765916a31d724786ed74bcb97e168a9d937b04936aeef2015c907eba5ac352c6bcd749c246fd62ffb659ec
RTMR2 = bd67ab7554dc27ab03a077bc1447a1a67d0624ff547c4c809a8626f12d6a89712f8ec60e781e99b98208574065d21a71
```

The measurement implementation is reviewable in upstream [machine.rs](https://github.com/Dstack-TEE/dstack/blob/43f69f41cc546423f9f73fc48b16f8cf19053cbc/dstack-mr/src/machine.rs), [tdvf.rs](https://github.com/Dstack-TEE/dstack/blob/43f69f41cc546423f9f73fc48b16f8cf19053cbc/dstack-mr/src/tdvf.rs), and [acpi.rs](https://github.com/Dstack-TEE/dstack/blob/43f69f41cc546423f9f73fc48b16f8cf19053cbc/dstack-mr/src/acpi.rs).

## How the RTMR0 gap was resolved

SDK 0.2.1's normalized report omitted `info.vm_config`. Capturing the raw response through the SDK's existing authenticated transport preserved that field. The captured model quote was checked against the exact bytes returned by hardware verification. The raw configuration supplies calculation inputs; its values were not accepted as boot allowlist entries. The unmodified pinned calculator independently produced all four registers and all thirteen RTMR0 digests from the reviewed OS artifacts.

| Configuration | Gateway | Current model VM |
| --- | --- | --- |
| vCPUs | 4 | 64 |
| Memory in bytes | 8589934592 (8 GiB) | 2199023255552 (2 TiB) |
| QEMU version | 8.2.2 | 9.2.1 |
| PCI hole64 in bytes | 1125899906842624 (1 PiB) | 1125899906842624 (1 PiB) |
| GPUs / NVSwitches | 0 / 0 | 8 / 4 |
| PCI hotplug | Disabled | Disabled |
| Hugepages | Disabled | Disabled |
| Host share / OVMF variant | `9p` / `pre202505` | `9p` / `pre202505` |

The fresh model capture came from a different fleet VM than the earlier one-GPU, 200-GiB capture. The current boot values belong to the eight-GPU VM and must be paired with its own runtime Compose hash and complete deployment history. The earlier ten-action history is not interchangeable with this VM's 82-action history.

### Historical search results

Before raw VM configuration was retained, ten of thirteen RTMR0 events were independently reproduced. The remaining events were indexes 8–10: ACPI loader, ACPI RSDP, and ACPI tables. The following records the unsuccessful bounded search on the earlier evidence; it is no longer an unresolved boot result.

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

Those searches never included the actual 1-PiB PCI hole64. The normalized evidence did not expose the VM configuration, but the raw response did. Newer official calculator source was also inspected during diagnosis; it was not built or substituted. The successful result used the original pinned calculator and helper, with no observed digest substituted into its calculation.

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

The current eight-GPU VM's authenticated manager history contains **82 actions**: 53 `compose_up`, 19 `compose_down`, five manager starts, one `compose_stage`, and four container restarts. All 17 unique Compose source files referenced with a file digest were fetched at their exact commits, checked against their authenticated SHA-256 values before YAML parsing, and reviewed for Qwen routing, dependencies, and administrative access. Neslos's recursive canonicalization of the entire action array produces `a0fae0e75e4c5b2ca4a7208cd1cec42e25c1d144f7d41981ac042279f7b85d63`; this is distinct from the provider's wire-format `actions_hash`.

The current runtime Compose hash is `5e513dbd72e1c0f291f748ad06d4dbc1df55659869e649376213ac7b3c9d2e29`. The latest recorded manager image is `nearaidev/compose-manager@sha256:a0c073085684e12e19f31bb279fc8da663a374199bfecc47b04167ae79eaa766`, whose verified build identifies source commit `c7fbaaf5f8a993c6a3c53ac3748ed3b28bafcea3`.

| Recorded Qwen operation, zero-based action index | Authenticated source | Source-file SHA-256 |
| --- | --- | --- |
| Engine and proxies, 64 | [small-models.yaml at cab4087](https://github.com/nearai/cvm-compose-files/blob/cab4087076ad5321f3c2413627d30af455eb3cb6/prod/small-models.yaml) | `68b80451c141f21eab9f80302e60f48857ddf2d6304b485327c23abe8c9423b2` |
| Proxies and nginx, 71 | [small-models.yaml at 75d31e6](https://github.com/nearai/cvm-compose-files/blob/75d31e6461dc51465a81ff69203200a51a820d1c/prod/small-models.yaml) | `320afade84f1606bda2c473ec0d09d3b6cd745038133bf353252f2683cc24eba` |

The base proxy service `proxy-qwen38-27b` declares `MODEL_NAME=Qwen/Qwen3.8-27B`, enables strict request-model validation and OHTTP, and routes to `model-sg-qwen38-27b-fp8-tp1-coloc:8000`. A separate proxy selects the abliterated LoRA adapter. At action 71 both use `nearaidev/vllm-proxy-rs@sha256:0be4ee8f40a2bf71a6e2fab1e780ad1a6e738ffb2085553f1ed4b85fcb944207`.

Every reviewed Qwen engine definition uses `lmsysorg/sglang@sha256:febfb971c7352570fc445c466ebd6ffc9d896024958e544a60f2137fd85856b1` and `Qwen/Qwen3.8-27B-FP8` revision `017b9c7af6b5689d5dd426a76e0bc077eb5ca20a`, served under the canonical base-model name. This pins published deployment intent. The engine enables remote model code, its Hugging Face cache is writable and shared, and the downloader obtains an unpinned `huggingface_hub` distribution through `uvx`. The LoRA downloader checks explicit file SHA-256 values. These are publisher and runtime dependencies, not a reproducible end-to-end model build.

### Model selector and history limits

The review found that selecting the latest global `compose_up` picks action 81, which names DeepSeek proxies, instead of Qwen's action 71. Checking its images can succeed without checking the requested Qwen service. A complete history hash prevents history substitution, but does not repair that service-selection error. Model-specific selection must distinguish a reviewed source reference from an assertion about the service currently running.

The [authenticated manager source](https://github.com/nearai/compose-manager/blob/c7fbaaf5f8a993c6a3c53ac3748ed3b28bafcea3/src/main.rs) reveals further limits. It runs `docker compose up -d --remove-orphans`, including ordinary dependencies, and permits request environment overrides and a project selection. Its action records omit the project, environment values, force-recreate and volume flags, and success outcome. `compose_up` and `compose_down` are recorded before the command finishes. A down operation uses the existing working file rather than fetching the file at the recorded commit. A restart records a container name without an authenticated service mapping. Raw provider reports contain no additional runtime inventory or success fields that resolve these omissions.

No later source dependency explicitly names Qwen after action 71, but that alone cannot establish that later operations left its runtime unchanged. Nor can a failed latest operation be assumed to leave a particular earlier proxy running: the earliest historical proxy definitions lacked the later strict request-model setting. Approval of a history therefore requires an explicit trust scope; it cannot silently become an exact-current-engine claim.

The Compose manager has Docker-socket access, host PID visibility, and administrative capabilities. Other proxies are privileged. SAGE uses a separate network and a filtered quote/info socket, but its image-pull helper has Docker-socket access. The launcher follows manager updates signed by the configured GitHub workflow identity. An authenticated action history is evidence of recorded actions; it is not independent proof of current container or weight contents, or proof that an operator made no unrecorded changes. A future verified provider-TEE response signature can prove involvement of the attested signing endpoint and bind the requested model label and exact request/response bytes under these stated trust assumptions. It cannot by itself prove which weights performed that computation.

## Reproduction and enforcement

To collect fresh preflight evidence with an existing API key configured in the local environment, use a new output filename:

```sh
node --env-file=.env --import tsx scripts/inference-setup.ts \
  --model Qwen/Qwen3.8-27B \
  --out .local/private/inference-inspection-new.json
```

This invokes evidence verification, not Chat completion. Without an independently reviewed `--approval` file, it explicitly reports `approved: false`. The output contains provider reports and should remain private. The script exclusively creates the output file and will not overwrite existing evidence.

For boot reproduction, obtain the measurement archives and helper from the pinned sources above, build the pinned `dstack-mr` CLI, and place the helper and its documented firmware files on the tool's search path. These exact raw configurations reproduced the complete current boot measurements:

```sh
RUST_LOG=debug dstack-mr measure /path/to/cpu/metadata.json \
  --cpu 4 --memory 8589934592 --qemu-version 8.2.2 \
  --hotplug-off true --pci-hole64-size 1125899906842624 --json

RUST_LOG=debug dstack-mr measure /path/to/gpu/metadata.json \
  --cpu 64 --memory 2199023255552 --qemu-version 9.2.1 \
  --num-gpus 8 --num-nvswitches 4 --hotplug-off true \
  --pci-hole64-size 1125899906842624 --json
```

The upstream debug output exposes the independently calculated firmware event digests. Preserve each run in a new log and compare every register and event sequence with the corresponding fresh verified evidence. These parameters apply to the reviewed captures; a fleet VM with another configuration requires its own derivation and review.

The [runtime client](../src/core/inference.ts) and [boot verifier](../src/core/inference-provenance.ts) require MRTD and RTMR0–2 allowlists for both gateway and model, as well as runtime OS/Compose and deployment-history checks. They authenticate the quote before comparing those exact quote bytes with approved boot values. The private candidate contains calculator-derived boot values and remains unapproved pending deployment review. No observed register was copied into an approval policy as a substitute for calculation.

The prepared [live-response probe](../scripts/provenance-live-inference.ts) was **not run**. A future authorized run must satisfy the strict policy and separately verify a `provider_tee` completion signature binding the canonical model ID and hashes of the exact encrypted request and response bytes. A gateway-only receipt is insufficient. These requirements describe implemented checks, not a successful paid inference or proof that the local caller itself executed inside TDX.

The standalone probe is limited to one paid call, reserved at no more than one cent, using the fixed `.private/provenance-live-inference-reservation.json` file. It refuses a second call even with a different output filename; failed or uncertain outcomes retain the reservation. Keep this file across restarts. Deleting private history or replacing the checkout is outside this local storage guarantee. The separate TEE research budget must also account for any standalone probe spending.
