# Private AI readiness review — 9 November 2026

> Historical snapshot, retained below. Later on 9 November, [private NEAR AI research passed inside independently verified TDX](NEAR-PRIVATE-RESEARCH-2026-11-09.md), including signed reports, audit opening, restart persistence and exhausted-budget rejection. The scoped direct policy explicitly trusts provider deployment/weight administration; it does not independently prove loaded weights. The finite CVM is retired and the testnet vault restored paused. Earlier statements about disabled research, zero calls, unchanged code or unfinished restart checks apply only to this snapshot.

**Private AI research remains disabled.** This review refreshed provider evidence, checked two alternative models, and verified direct TLS connections. It made no inference request, started no hosting, changed no application code, and installed no weaker verification policy. The [readiness record](../deploy/inference-review-20261109/record.json) contains results and hashes of privately retained evidence. The [Vercel rehearsal](https://neslos.vercel.app) remains operational and uses deterministic research.

**Later same-day follow-up:** the [deployment/history audit](MODEL-DEPLOYMENT-AUDIT-2026-11-09.md) explains the successful nginx restart and project-wide Compose semantics, verifies matching historical GLM service definitions and engine/base provenance, and proves that the two direct TLS keys reject cross-pinning. It also examines the missing manager-to-proxy instance enforcement and compares concrete alternatives. These findings narrow the unresolved work to current-state/weight/routing assurance and the eventual encrypted research proof; they do not enable research.

The [Tinfoil continuation](PRIVATE-AI-ALTERNATIVE-2026-11-09.md) subsequently verified a live router, its pinned TLS channel and an available model's signed release, with four negative checks. It records why the published client and direct-model reachability still need work before a strict Neslos integration.

## Fresh provider checks

Free inspections verified Intel TDX with `UpToDate` TCB, required NVIDIA GPU evidence, and checked the attested gateway TLS connection using Neslos's pinned SDK 0.2.1.

| Model/capture | Source/history result |
| --- | --- |
| Qwen/Qwen3.8-27B, 125 actions | `PROVENANCE_COMPOSE_AMBIGUOUS_MUTATION`: a later launch concerns another service; the selector cannot establish that the research model was unaffected |
| GLM-5.3-Flash, earlier 241-action capture | Selecting the recorded proxy launch succeeded. This identifies attempted source deployment, not a successfully running engine |
| GLM-5.3-Flash, later 243-action direct capture | `PROVENANCE_COMPOSE_CONTROL`: a subsequent `docker_restart` names `nginx`; the strict policy does not accept an unapproved container-control mapping |
| DeepSeek-V4.1-Flash-1017, 210 actions | `PROVENANCE_COMPOSE_SCOPE`: the latest launch omits a service list |

The earlier 9 November Qwen report had 31 actions and failed `PROVENANCE_COMPOSE_SPLIT_REFERENCE`. These are different captures, not evidence that the old failure was repaired. The returned fleet/deployment changed during the investigation.

## Direct TLS experiment

Published SDK 0.3.0 was inspected in an isolated local directory; the project still pins 0.2.1. Version 0.3.0 normally disables direct attested TLS while [upstream issue 1087](https://github.com/nearai/cloud-api/issues/1087) is open. A local, read-only subclass requested TLS fingerprints and captured the peer from the same attestation request. SDK verification checked the nonce, quote, GPU evidence and serving report's TLS binding.

The standard and long-context GLM endpoints both passed. They share an inference signing key but have different attested TLS keys and measured Compose hashes. A second connection pinned to each exact TLS fingerprint read `/v1/models` with HTTP 200. No credential or completion request was sent. Endpoint URLs, fingerprints and evidence hashes are retained in the readiness record.

This establishes a candidate way to constrain a connection to a reviewed TLS identity. It does not approve the model runtime or prove a complete serving set. Both latest direct histories still fail `PROVENANCE_COMPOSE_CONTROL` under the existing policy.

## Independent boot and source review

The standard GLM endpoint's actual VM configuration matches the independently calculated eight-GPU configuration from the retained dstack reconstruction. All four boot registers and all 13 RTMR0 event digests match that calculation. Observed quote values were not copied into a new allowlist.

The authenticated source is `prod/GLM-5.3-Flash-SGL-TP2x4-W4AFP8-V12Q8.yaml` at commit `4d64477b298038f59e92b268a2a5feb34e597fe0`, SHA-256 `e88b040e8ecdb7869ac855880719f6d184c035f0199753bef64ed338f8622922`. Downloaded bytes match. Proxy-image and Compose-manager build provenance passed verification against their official GitHub workflow identities.

The source declares the canonical model name, four local backends, a pinned engine image/model snapshot, and OHTTP. It also uses writable caches, privileged proxies, an administrative Compose manager and environment-dependent configuration. Signed source and attempted-operation history do not establish the effective environment, successful current container state or current weight contents. Full runtime approval was not established.

## Remaining requirement

Enablement needs a reviewed policy establishing the running model and permitted routing, followed by a budgeted encrypted response and signature proof. Direct TLS is useful evidence for that policy; it cannot replace runtime approval. Unknown-control and ambiguous-launch rejection remain active.

The provider still tracks [canonical model-to-deployment evidence](https://github.com/nearai/cloud-api/issues/1063), [complete serving-set coverage](https://github.com/nearai/cloud-api/issues/1085), and [direct serving-set coverage](https://github.com/nearai/cloud-api/issues/1087) as open issues. No support message was sent. A provider-signed completion from a local probe would also remain distinct from a complete private research job executed inside Neslos's own verified TDX runtime.

The $3 combined cap and $0.25 inference allocation are unchanged. No additional credit was reserved or spent, and no replacement Neslos CVM was provisioned. Operator scripts and review details are retained in `.local/private-ai-refresh-20261109/`; exact provider captures remain private.
