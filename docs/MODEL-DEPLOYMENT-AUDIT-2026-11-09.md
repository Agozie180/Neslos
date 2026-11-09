# Model deployment and history approval audit — 9 November 2026

> Historical snapshot, retained below. Later on 9 November, [private NEAR AI research passed inside independently verified TDX](NEAR-PRIVATE-RESEARCH-2026-11-09.md), including signed reports, audit opening, restart persistence and exhausted-budget rejection. The scoped direct policy explicitly trusts provider deployment/weight administration; it does not independently prove loaded weights. The finite CVM is retired and the testnet vault restored paused. Earlier statements about disabled research, zero calls, unchanged code or unfinished restart checks apply only to this snapshot.

**The earlier conclusion was too coarse: several rejected operations can be explained, and additional source and transport evidence can be verified. Full approval of the currently serving model still needs evidence that the public action history does not contain.** No application, dependency, environment or approval-policy change was made. Private AI research remains disabled. There were no paid inference calls, new deployments or additional charges.

This extends the [earlier readiness review](PRIVATE-AI-REVIEW-2026-11-09.md). It examines the exact manager and proxy revisions identified by build provenance, compares authenticated historical GLM service definitions, verifies engine provenance and registry metadata, tests correct and incorrect TLS pins, and compares other approaches. The [sanitized evidence record](../deploy/model-deployment-audit-20261109/record.json) records identities, hashes and results. The two hardware-verified GLM captures are retained from the earlier same-day inspection; their quotes were not refreshed during this audit. They must be refreshed before use in a new inference session.

The subsequent [live Tinfoil follow-up](PRIVATE-AI-ALTERNATIVE-2026-11-09.md) verifies its router, rejects four altered inputs and authenticates an available GPT-OSS-120B release. It also identifies published-SDK and direct-model-verification limits. This advances the alternative beyond documentation research without changing Neslos's approval policy.

The practical recommendation is to keep strict production approval unchanged, retain direct GLM TLS as the most developed NEAR candidate, and evaluate Tinfoil separately if independently established model identity is essential. A carefully scoped NEAR integration can instead rely explicitly on the provider's deployment administration, but that would be a different assurance policy requiring deliberate acceptance. Calling that policy “current model and weights independently proved” would be inaccurate.

**What the deployment history actually proves**

The current manager image is `nearaidev/compose-manager@sha256:a0c073085684e12e19f31bb279fc8da663a374199bfecc47b04167ae79eaa766`. Verified provenance identifies commit `cba8833b36244dc2fdc51cbf9c7c3e5e7e56033a`. Compared with the previously reviewed `c7fbaaf…`, only two dashboard files changed; manager and launcher source did not change. The apparent revision mismatch does not invalidate the earlier executable-source review.

| Evidence or operation | Exact source behavior | Approval implication |
| --- | --- | --- |
| Manager attestation | Quotes `SHA256(canonical actions) || nonce`; successful state, running containers and effective environment are absent | Authenticates the supplied history and challenge, not a snapshot of the current model process |
| `compose_up` | Starts pull/build/up phases; records the action before completion | A valid record can describe a failed or partially applied deployment |
| Omitted/empty services | Passes no service arguments to Docker Compose | Means project-wide operation under Compose selection/profile rules; it is not malformed provider evidence |
| Disjoint named services | Explicit project selection, dependencies and `--remove-orphans` influence effects; project and environment are omitted from the action | Different service names alone do not prove isolation from an earlier model |
| `docker_restart nginx` | Records only after `docker restart` returns success | This particular action is a successful restart, unlike an attempted `compose_up`; it still does not attest the restarted container's resolved configuration |
| `compose_stage` | Runs pull and build, without up | It does not itself start the downloader or activate services. Its effects depend on the selected source/build definitions |
| `/version` | Per-project `current` normally rotates after successful up; legacy top-level fields can describe the latest attempt | Per-project state is better evidence, but legacy migration can seed it from an attempted action and down leaves it unchanged |
| `/docker/ps`, `/host/gpu`, `/host/cache` | Separate administrator-token-protected observations; cache listings are not content hashes | Useful inputs for an improved attested state report, but not committed by the existing history quote |

Source: manager [attestation and version](https://github.com/nearai/compose-manager/blob/cba8833b36244dc2fdc51cbf9c7c3e5e7e56033a/src/main.rs#L2903), [successful-state update](https://github.com/nearai/compose-manager/blob/cba8833b36244dc2fdc51cbf9c7c3e5e7e56033a/src/main.rs#L1746), [command construction](https://github.com/nearai/compose-manager/blob/cba8833b36244dc2fdc51cbf9c7c3e5e7e56033a/src/main.rs#L1991), [stage/up handlers](https://github.com/nearai/compose-manager/blob/cba8833b36244dc2fdc51cbf9c7c3e5e7e56033a/src/main.rs#L2239), [restart](https://github.com/nearai/compose-manager/blob/cba8833b36244dc2fdc51cbf9c7c3e5e7e56033a/src/main.rs#L2557), and [legacy migration](https://github.com/nearai/compose-manager/blob/cba8833b36244dc2fdc51cbf9c7c3e5e7e56033a/src/main.rs#L303). No administrator endpoint was accessed.

The manager resolves its own image through Docker inspection at startup. That is an application observation included in its action log, not a hardware measurement of each container binary. Its trust depends on the reviewed boot/launcher/manager chain and administrative controls. Build provenance authenticates the publisher's build statement; it does not make that administrative trust disappear.

**The GLM history is more consistent than the selector error suggests**

For the standard direct endpoint's 243-action capture, the latest action is a successful restart naming `nginx`. The authenticated GLM source explicitly declares `container_name: nginx`. The immediately preceding launch selects `proxy-glm53`. The recent stage selects that same proxy from the same file hash; that service has a digest-pinned image and no build definition. This capture does not support a claim that staging started a downloader or modified model weights.

I also fetched the exact source bytes named by the latest explicit up/down reference for each relevant service, verified each recorded SHA-256 before parsing, and compared the complete parsed service definitions with the latest proxy YAML:

| Service | Latest explicit attempt, zero-based action index | Source commit | Comparison |
| --- | --- | --- | --- |
| Proxy | 241 | `4d64477b…` | Identical |
| Engines r1 / r2 / r3 / r4 | 217 / 218 / 219 / 221 | `7ee4a4c7…` | All four identical |
| nginx | 231 | `5a5119f7…` | Identical |
| Downloader | 232 | `5a5119f7…` | Identical |

These are comparisons before environment interpolation, not reconstructed container state. They establish that the different source commits do not change those seven declared services. They do not resolve outcomes, unscoped operations, effective project/environment values, cache contents or later process failures. This audit reviewed the current manager and selected historical sources; it did not independently approve every historic manager version or every operation in the log.

Neslos's current `PROVENANCE_COMPOSE_CONTROL` result is therefore a conservative policy rejection, not a demonstrated engine mismatch. An explicit review could classify this exact restart while retaining a full-history pin. A blanket “ignore nginx” rule would be unsafe because a container name does not establish its image, configuration, mounts or routing.

Likewise, the DeepSeek empty-service rejection could be improved by expanding the authenticated Compose project with its resolved profiles and environment. Qwen's disjoint mutation needs project and dependency information. Neither is repaired by simply skipping the newest action.

Neslos skips stages when selecting an attempted source, but still pins the entire history hash. A new stage therefore invalidates an existing full-history approval. Future policy work should classify stage effects from the relevant manager version and source; “no service activation” alone is not a general proof of no relevant side effect. The present observed proxy-only stage is narrower than that general concern.

**Engine supply-chain evidence is now verified**

The SGLang image recipe is in `nearai/cvm-compose-files`, not a `nearai/sglang` repository. The following publisher build attestations passed verification:

| Artifact | Verified identity |
| --- | --- |
| Proxy `sha256:7a295d6f…` | `nearai/inference-proxy`, `.github/workflows/build.yml`, commit `7924418b5eacb396a12ada208b0f2f0c82ec6d1d` |
| Engine `sha256:da8d4e4b…` | `nearai/cvm-compose-files`, `.github/workflows/publish-glm53-admission-reserve.yaml`, commit `79de066bbdce973b442242d44d3046791a059f2e` |
| Engine's immediate base `sha256:3eccc307…` | Same repository/workflow, commit `0244bab81cc0ec42f0aa24d5de57b804650c9cfa` |

For the engine, I also verified the OCI digest chain from the authenticated image index through the Linux manifest, configuration and embedded BuildKit provenance. The configuration and BuildKit statement agree on source revision `79de066…` and recipe `docker/sglang-glm53-hicache-w4afp8/Dockerfile`. This matters because the publishing workflow accepts a separate source revision; the workflow's own commit alone would not prove which checkout it built. The declared SGLang source revision is `fc91d2403cc210a86bd5fc715c6609f58c932e5a`, with explicit provider patches.

Sources: [exact recipe](https://github.com/nearai/cvm-compose-files/blob/79de066bbdce973b442242d44d3046791a059f2e/docker/sglang-glm53-hicache-w4afp8/Dockerfile), [publishing checks](https://github.com/nearai/cvm-compose-files/blob/79de066bbdce973b442242d44d3046791a059f2e/.github/workflows/publish-glm53-admission-reserve.yaml#L225), [build run](https://github.com/nearai/cvm-compose-files/actions/runs/39987811670).

No large engine layers or weights were downloaded or executed. This was not a reproducible rebuild, exhaustive dependency review or confirmation that the image is currently running. The declared Hugging Face snapshot remains on a writable cache volume; a pinned revision path and `HF_HUB_OFFLINE=1` do not verify the bytes currently read from it.

**Direct TLS narrows routing, but the SDK needs an additional association check**

Four credential-free requests to `/v1/models` produced these results:

| Endpoint / pin | Result |
| --- | --- |
| Standard GLM / its reviewed TLS key | HTTP 200 |
| Long-context GLM / its reviewed TLS key | HTTP 200 |
| Standard GLM / long-context key | `binding.spki_fingerprint_mismatch` |
| Long-context GLM / standard key | `binding.spki_fingerprint_mismatch` |

The endpoints share an inference signing key but use different attested TLS keys. Exact TLS pinning therefore distinguishes these two captured endpoints where signer selection alone cannot. The inspected SDK uses hostname validation plus SPKI checking during the TLS handshake on a new connection. The negative cases failed there; no credential or inference body was used in any probe. This is evidence of these connections, not a complete serving-fleet guarantee or proof of future key custody.

The SDK's manager verification checks the nonce, history commitment, measured Compose configuration and replay of the manager's own event log. It does not compare the manager's instance identity with the proxy's. The upstream [source explicitly documents this limit](https://github.com/nearai/inference-sdk/blob/ff591054d63a7fd218396d70f96024396280b6ff/js/src/core/compose-manager-attestation.ts#L29). The reviewed project SDK 0.2.1 has the same relevant structure; installing 0.3.0 alone does not supply the missing association.

For both retained GLM pairs, a separate raw-quote comparison found matching quoted nonces, MRTD, RTMR0–3 and MRCONFIGID, with matching replayed instance events. That strengthens the association for these captures. Production should enforce an authenticated same-instance/boot association itself, allowing explicitly reviewed runtime-event evolution between sequential quotes rather than treating nesting in JSON as proof. Matching boot registers alone is insufficient. It must also address the gap between a state snapshot and the later request.

SDK 0.3.0's default direct path disables attested TLS while [complete direct serving-set coverage](https://github.com/nearai/cloud-api/issues/1087) remains unresolved. The earlier local subclass and these probes were research tools; neither was installed into Neslos. A future direct client must reject an unknown TLS key and reverify it, with no fallback to unpinned transport.

**New replica evidence exists, but is not a model release manifest**

The captured standard and long-context event logs contain seven and two `nearai-replica-report-key-v1` events respectively. The mechanism is present in the verified proxy source. This is stronger evidence of deployment than merely seeing a merged pull request.

However, its [signed host-frame schema](https://github.com/nearai/inference-proxy/blob/7924418b5eacb396a12ada208b0f2f0c82ec6d1d/src/replica_state/report.rs#L62) contains host/boot identity, sequence/time, engine version, lifecycle and load. It contains no canonical model ID, container image digest, resolved configuration or weight commitment. Frames are published to private Valkey for scheduling; no live frame was obtained in this audit. The attested key event does not prove that a fresh frame is available or that production uses that routing path.

The [placement integration](https://github.com/nearai/cloud-api/pull/1158) documents staging configuration and fallback to legacy routing when evidence or capacity is unsuitable. Merging it does not establish production rollout or strict enforcement. It could be extended into useful runtime evidence, but cannot currently substitute for deployment approval. Also, [issue 971](https://github.com/nearai/cloud-api/issues/971) was closed with a comment saying the serving-CVM binding was not established; closure was not evidence of a fix.

**Practical ways forward**

| Approach | What it would establish | Remaining work and tradeoff |
| --- | --- | --- |
| Reviewed direct NEAR GLM with explicit provider-administration trust | Attested endpoint/channel, reviewed published sources and image provenance, encrypted exchange and verified response signature | Smallest change from the current investigation. Requires exact peer/manager association, reviewed permitted routing, scoped history rules and an honest policy that trusts current deployment/weight administration. It does not independently prove loaded weights |
| NEAR runtime manifest enforced for each serving session | Canonical model tied to active container/configuration, weight commitment, serving key and request | Extend evidence and enforcement; state observations already exist in manager APIs. A signed declaration without checking and enforcing actual state is insufficient. Requires provider cooperation |
| Dedicated immutable deployment of the desired model | A smaller, owner-reviewed deployment with no shared mutable rollout history | Pin and verify engine/weights/configuration, remove arbitrary hot deployment, bind the serving key and control egress. Obtain a quote for GPU cost; no basis to assume the remaining budget covers it |
| Small CPU model inside Neslos's own TDX service | One attested boundary for research orchestration, model and signed audit | Use an immutable small model and verify its hash before loading; protect it from later modification. Benchmark quality/latency locally first. More implementation work and much less capability than GLM; existing CPU hosting budget may suit a short proof, but has not been costed or deployed |
| Direct Tinfoil integration | A design with measured model-to-release configuration, attested transport and verified read-only weight volumes | The subsequent live follow-up passed router and release verification and negative tests. GPT-OSS-120B had three admitted hosts; GLM-5.3-Flash had none. Direct model verification, freshness policy, account/pricing and integration remain to be completed |
| Phala ACI gateway | Attested gateway, signed request/response receipts and cited upstream verification sessions | Useful audit packaging. Its current NEAR adapter verifies the router only, so that route does not close Neslos's model-instance gap. Other upstreams require separate claim-policy review |

Tinfoil's [documented architecture](https://docs.tinfoil.sh/verification/attestation-architecture) commits container/configuration and model-volume hashes, verifies weights with dm-verity, and makes its router enforce a compiled model-to-repository mapping. Its [Modelwrap source](https://github.com/tinfoilsh/modelwrap/tree/e61ae5118436cd5c9d2d261ede3130b68e108d38) provides reproducible packaging, and the [reviewed router configuration](https://github.com/tinfoilsh/confidential-model-router/blob/ab9edf30832416d2f14bbf70f3e1879383cc11c4/config.yml) declares repository pins. These mechanisms directly address the missing model/weight link, subject to their implementation, release and root-of-trust review. They do not prove the correctness of an AI answer. The inspected SDK main branch documents newer factories/config approvals; npm returned `tinfoil` and `@tinfoilsh/verifier` **1.4.0**. Do not assume main-branch examples describe the installed release.

Phala's [response verification guide](https://docs.phala.com/phala-cloud/confidential-ai/verify/verify-signature) correctly distinguishes a gateway assertion from independently verified upstream evidence. Its [current NEAR adapter documentation](https://github.com/Dstack-TEE/private-ai-gateway/blob/f1aac39cdf0229ecb22d169ce4b2b7f03dd41755/docs/providers/near-ai/verification.md) explicitly leaves serving software and model weights unknown and does not bind the downstream instance. Its [Tinfoil adapter](https://github.com/Dstack-TEE/private-ai-gateway/blob/f1aac39cdf0229ecb22d169ce4b2b7f03dd41755/docs/providers/tinfoil/verification.md) also records router-scoped evidence and relies on the router's policy. Switching providers or adding a gateway is not itself an approval decision. No inference credential was tested or reused across services.

**What should change in the approval design**

Separate the decision into explicit claims: hardware/boot trust, authenticated source/build identity, current deployment and weights, permitted routing, and exact encrypted request/response evidence. A source selector passing should never silently turn the other claims green. A full-history hash provides change detection, but it makes routine restarts demand a new approval and does not recover fields the log never recorded.

For a durable strict policy, prefer an independently reviewed release manifest plus a fresh, quote-bound runtime statement. It should identify the canonical model, project/services, active container/image identities, relevant resolved configuration, protected weight root, serving TLS/encryption keys, instance/boot and validity interval. The serving process must enforce that state for the request; updates should change an authenticated deployment epoch or revoke the session. Restrict redirects, failover and additional backends to reviewed identities. Add explicit rules for whole-project operations, dependencies, restarts and stage/build effects. Unknown operations must still reject. A signed checkpoint can bound history growth only if its state and continuity are authenticated and reviewed.

There is no need to wait passively for a particular issue to close: the direct transport, historical source consistency and engine provenance can be used now to prepare a precisely scoped integration, or the immutable-weight alternative can be assessed independently. But enabling the existing strict policy by copying current observed hashes or swallowing selector errors would not establish the evidence it promises.

**Validation and remaining proof**

All **45** existing focused tests passed across `tests/inference-provenance.test.ts` and `tests/inference.test.ts`. The four TLS probes behaved as expected. Seven historical service comparisons matched, the proxy/engine/base provenance checks passed, and the engine metadata digest chain verified. The live Vercel `/api/health` and `/api/state` endpoints both returned HTTP 200. Operator research scripts and full public-source captures are retained under `.local/model-deployment-audit-20261109/`; provider attestation captures remain private. No inference policy was installed.

The application code remains at `ad0e639d3e0cf1db90e81d8928291caca071faef`; this audit adds documentation and sanitized evidence only. The existing $3 total/$0.25 inference allocation remains unchanged. Full strict runtime approval, a paid encrypted completion/signature proof, and a complete research mission inside Neslos's own verified TDX runtime remain separate unfinished steps. A successful local provider probe would not, by itself, complete the last step.
