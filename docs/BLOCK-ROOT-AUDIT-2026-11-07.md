# Deployment blocker: root and foundation audit — 7 November 2026

This records the audit before the owner's provider reply. The [subsequent follow-up](TDX-PROVIDER-FOLLOWUP-2026-11-07.md) supersedes the continuation steps below: Phala offers no pre-approval, the compact bundle removes the registry requirement, and its schema-valid request was also rejected. No CVM was committed.

**The old deployment request has a confirmed size defect. The replacement full-image request passes offline schema validation. Neither finding explains or clears Phala's historical terms-of-use rejection.** The rejection applies to the saved 6 November inline request; no rejection of the current image, account-wide ban, or successful Neslos TDX deployment has been established.

This review continues the [foundation audit](AUDIT-2026-11-06.md) and [testnet continuation](TESTNET-TDX-2026-11-07.md). It uses the original request/error, the official Phala SDK, fresh read-only account/resource checks, both retained verified model captures, and the installed NEAR AI SDK source. Private evidence stays under `.local/block-root-audit-20261107/` and `.private/`; it is not a public hardware proof.

## Causal findings

| Layer | Evidence | Finding and next step |
| --- | --- | --- |
| NEAR account and contract | `neslos.testnet` has approximately 4.934255 testnet NEAR available. `vault.neslos.testnet` code matches the rebuilt WASM. Snapshot: block 276618466, policy 9, paused, 739 fixture tokens. | The owner account and deployed contract are usable. No contract redeployment or owner-account replacement is needed. |
| Cloud authentication and resources | 7 November read-only checks authenticate, show $5 balance and zero CVMs, and return HTTP 200 for the resource graph. `tdx.small` and stable `dstack-0.5.12` have capacity on two nodes; all returned account capacity flags are true. | Credentials and resource visibility work. These endpoints do not approve an application or enforce the $3 budget. |
| Original request | Compose is 230,107 UTF-8 bytes; the combined Compose/prelaunch limit is 204,800. The official full-request schema reports the size issue. | A confirmed local defect: 25,307 bytes over the limit. Bundle generators now reject oversized output before submission. |
| Current packaging | Replacing only `compose_file.docker_compose_file` in an offline copy produces a 1,461-byte Compose and a request accepted by `@phala/cloud` 0.4.0. Network and vault are literal testnet values. | The size/schema defect is removed from this candidate. Its image reference uses a local image ID solely for the offline check; it is not a registry manifest digest or a remotely deployable artifact. |
| Provider decision | The original HTTP 400 says: “You are not allowed to deploy the target applications since it violates our terms of use.” | Phala documents this category as image anti-spam, but exposes no matched rule. Size is not a demonstrated cause of that response. Obtain provider review and its supported remedy. |
| Gateway compatibility | API and ingress signatures verify with the updated check; absent VPC services are no longer incorrectly required. Present VPC images and exact deployment pins are still checked. | The confirmed local gateway-layout defect is fixed. This does not approve the model deployment. |
| Model identity and routing | The one-GPU and eight-GPU captures have different Compose hashes/history but identical signing addresses **and signing public keys**. The SDK uses the verified signing public key for model encryption. | Signer pinning cannot isolate the reviewed VM. A response signature under that key cannot distinguish these deployments. Resolve key/routing scope before approving private research. |

## What the provider evidence does and does not establish

The original request-file SHA-256 is `85e25eeb0a6cebc1de55799b0fe61856acaca64f66b563a26e7293a73157a85f`; its Compose SHA-256 is `f8cd8ac89c9e6d89919c996d35a3e1123a1541433f7f538125427cae16666043`. Both services already used a maintained official Node image. The client retained the complete JSON error, but no HTTP Date header or request ID. The failure file's modification time must not be represented as the request time.

Phala's [troubleshooting guide](https://docs.phala.com/phala-cloud/troubleshooting/troubleshooting.md) recommends maintained official images or support review for suspected false positives. It does not identify which rule matched this request. The public SDK repository contains no observed implementation of the backend classifier. Changing KMS casing or using the new endpoint is not an established remedy: [SDK source pinned to this audit](https://github.com/Phala-Network/phala-cloud/blob/541065500bb5870ef8aa33084e7e7fbadf1283b9/js/src/actions/cvms/provision_cvm.ts) accepts `PHALA` and explicitly retains legacy `/cvms/provision` support.

The current full-image candidate has **not** been submitted for policy review, published, or provisioned. Its successful local schema result establishes request compatibility only. The preserved original rejection should neither be generalized into a current-build/account ban nor ignored as a size error. The updated support packet asks Phala to distinguish those cases. No support message or provisioning variant was sent during this audit.

## Why inference still cannot be approved

| Retained capture, UTC | Model Compose hash | Authenticated manager actions |
| --- | --- | --- |
| 10:21:27 | `31d3b2389e06a4450e342f3a45fdbb5d7ce4c607c359f5b291635548b0b80007` | 10; one-GPU deployment |
| 10:31:35 | `5e513dbd72e1c0f291f748ad06d4dbc1df55659869e649376213ac7b3c9d2e29` | 86; eight-GPU deployment |

The shared signer fingerprint is `ce1dae7d75c666e3a28be65629b5c2d3d983b248e880094b053f47326519a76c`. The comparison also directly checks equality of their signing public keys. The earlier 6 November report's 82-action count describes its older capture; it is not the count for the second capture above.

The one-GPU boot was independently reproduced, including MRTD, RTMR0–2 and all 13 RTMR0 events. Its selected base Qwen proxy and manager build provenance verify. The eight-GPU capture still fails `PROVENANCE_COMPOSE_AMBIGUOUS_MUTATION`. Neither outcome resolves the shared-key boundary or the separately documented engine/weight and administrative-history assumptions.

In `@nearai/inference-sdk` 0.2.1, `createVerificationState()` assigns `modelAttestation.signingPublicKey` to `modelKey`, and request encryption uses that key. The normal client exposes no deployment-instance selector. An attestation `signingAddress` filter therefore does not select a unique deployment in these captures. A standalone successful preflight also does not lock a subsequent request to that VM: the zero-TTL client re-verifies for later use. The source's public Qwen hostname alone supplies no instance-isolation guarantee.

The published SDK's [direct-endpoint guide](https://github.com/nearai/inference-sdk/blob/8c66d8e2fdea4e99b277201a9ea5e05ea8295ff1/js/docs/verification-guide.md#use-a-direct-model-endpoint) supplies a more concrete explanation: `all_attestations` may omit healthy serving instances; completion-signature lookup can reach a different instance; direct TLS fingerprint binding is disabled. Its Node implementation explicitly requests `includeSpkiFingerprint:false` and cites [upstream issue 1087](https://github.com/nearai/cloud-api/issues/1087), **open when checked on 7 November**, for complete serving-set coverage. Registry metadata confirms 0.2.1 is the latest SDK at this check. Using `DirectInferenceClient` or updating to the current package therefore does not fix this boundary. No direct-endpoint credential or paid request was sent.

A supported continuation needs either demonstrable isolation to an approved deployment, or a reviewed trust policy covering all deployments that can possess the selected key and receive the request. Retrying until a preferred report appears cannot establish either condition. No model approval file or paid inference call was produced.

## Foundation and continuation

The current application verification passed 574 tests with four Windows platform skips, strict TypeScript and production builds. The retained six browser checks, 25 Rust unit tests and both sandbox suites passed. The latest Linux image passed restricted-container bootstrap and fake-quote rejection. These are software checks; they do not establish Neslos execution inside Intel TDX. Documentation/evidence updates in this audit do not change the checked runtime source.

The reviewed image is local tag `neslos-tee:testnet-20261107`, local image ID `sha256:1e4b5372bc494038dde6cf2fa0a7a6d5e498766474561ed5979fa025cc2a4926`, with source-content digest `ff2a2d3d1fe3b30e7e8216c0546f2578287472fc7e7b595a3e43cf2bf0bb08bd`. Publication must produce and verify the registry's actual manifest digest before rendering the final measured bundle.

The existing foundation limits also remain: a valid restored journal needs an independent checkpoint to establish freshness; local quota accounting depends on retained storage; model and market testimony do not establish investment quality; Confidential Intents has no testnet. The testnet demonstration can first prove attestation and private research while the vault stays paused. Funded mainnet settlement is separate work.

The actionable sequence is:

1. Have Phala review the exact rejected request and confirm a supported deployment path. The owner authorized submission of `.local/phala-provision-audit-20261106/support-draft.md` on 7 November. It remains **unsent**: the browser host is unavailable and Computer Use approval rejected opening Brave. A mail-ready `.eml` and submission status are retained in `.local/block-root-audit-20261107/`; authorization need not be repeated once an enabled transport is available.
2. Publish the reviewed image to the owner's registry, verify its manifest, and prepare bounded teardown. The current GitHub session has repository access but lacks `write:packages`, so it cannot directly publish to GHCR with its present scopes. No credentials or permissions were changed. Preserve the combined $3 limit: at most $2.75 hosting and $0.25 inference. The account is post-paid; $5 credit is not a spending cap.
3. Launch the approved CPU TDX runtime in attestation-only mode against `vault.neslos.testnet`; independently derive its own boot/Compose pins and verify a fresh quote. Provider model quotes cannot stand in for this proof.
4. Pin the verified executor through `neslos.testnet`. Resolve model key/routing and history scope before enabling encrypted research and exporting its signed audit receipt.

The historical rejection, SDK snapshots, offline candidate and verified model captures are preserved. The audit made zero provisioning calls, paid inference calls, chain transactions or support submissions.
