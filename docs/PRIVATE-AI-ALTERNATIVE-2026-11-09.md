# Private AI alternative: live Tinfoil verification — 9 November 2026

> Historical snapshot, retained below. Later on 9 November, [private NEAR AI research passed inside independently verified TDX](NEAR-PRIVATE-RESEARCH-2026-11-09.md), including signed reports, audit opening, restart persistence and exhausted-budget rejection. The scoped direct policy explicitly trusts provider deployment/weight administration; it does not independently prove loaded weights. The finite CVM is retired and the testnet vault restored paused. Earlier statements about disabled research, zero calls, unchanged code or unfinished restart checks apply only to this snapshot.

**Tinfoil is now a tested alternative, with a verified live router and an authenticated GPT-OSS-120B release. It is not yet an approved Neslos inference backend.** This follow-up to the [deployment/history audit](MODEL-DEPLOYMENT-AUDIT-2026-11-09.md) made no paid inference call, used no inference credential and changed no application code or policy. The [evidence record](../deploy/model-deployment-audit-20261109/tinfoil.json) retains the results and evidence hashes.

I installed exact published versions `tinfoil@1.4.0` and `@tinfoilsh/verifier@1.4.0` into an ignored research directory with install scripts disabled. Neslos's package files and dependency tree were not changed. The published API differs materially from the newer main-branch documentation, so the probes used the installed implementation.

**The live router and negative tests passed**

The published verifier authenticated router release `v0.0.171`, digest `95e49018369d59594468ed5af698631ba011937d3859fcbad21207eb0b0f9007`. It accepted the AMD SEV-SNP hardware report, the Sigstore release statement, matching measurements and certificate SAN bindings. The two observations selected `inference.tinfoil.sh` and `router-0.tinfoil.sh`, with different attested TLS keys but the same release measurement.

Each router's admission manifest was read over HTTPS with hostname validation and the exact verified SPKI pin. The retained final probe produced:

| Check | Result |
| --- | --- |
| Correct router TLS pin | HTTP 200 |
| Incorrect TLS pin | Rejected during TLS verification |
| Wrong repository identity | Sigstore verification rejected |
| Altered release digest | Rejected against the signed subject |
| Altered signed quote measurement, recompressed into valid gzip | Report-signature verification rejected |

The quote mutation test changes the uncompressed report, so the final rejection exercises the hardware signature check rather than merely invalid compressed input. These are free attestation/metadata checks, not an encrypted completion or model-quality test.

**The manifest identifies a usable candidate and an unavailable model**

The final snapshot at `2026-11-09T14:48:59Z` reported:

| Model | Configured / verified / healthy hosts | Release |
| --- | --- | --- |
| GLM-5.3-Flash | 0 / 0 / 0 | None admitted |
| GPT-OSS-120B | 3 / 3 / 3 | `v0.0.29` |
| Gemma4-31B | 37 / 37 / 37 | `v0.0.30` |

These are the verified router's observations at that time. They are not independent health tests of every model host or a promise of future availability. The GLM repository's public release alone does not establish that it is currently available through this router.

I selected GPT-OSS-120B for deeper evidence review because it had admitted hosts. Its exact `tinfoil-deployment.json` bytes hash to `03becbb2f6d3fe129d7605e3ffd1d653706786b1f67bce46406bc852eda60ebe`. The official Sigstore verifier accepted the statement for repository `tinfoilsh/confidential-gpt-oss-120b`, tag `v0.0.29`; its signed predicate exactly matches the downloaded release artifact. Its SNP and TDX reference measurements match those advertised by the verified router.

The decoded configuration hashes to `d3dbbb0449a1f8252349e08ce052a4f64ca38d1963c3f1365b39ef380d55c1ec`, matching the configuration commitment in the release's kernel command line. It declares:

- Runtime `0.14.17` and engine image `ghcr.io/tinfoilsh/confidential-gpt-oss-120b@sha256:020264e6f71b4f3f03eb80b4b94014ea20c8c7dad0baca7ac71ee5ced5b98ecc`.
- Model revision `openai/gpt-oss-120b@b5c939de8f754692c1647ca79fbf85e8c1e70f8a`.
- Modelpack root `db5daddec41a3be3b51d1f4d009fb0e9b1243c2765e2bc5121acac79ab070a72`, also named by the engine's model path.

This is a concrete signed configuration/weight commitment. I did not rebuild the modelpack from all upstream weights, reproduce the boot registers independently or verify that a particular request used those weights.

**The reviewed router enforces model admission**

The observed router release resolves to source commit `7bfc9306cddee725343fb5f0951ba2376ace1e3f`. Its [model admission code](https://github.com/tinfoilsh/confidential-model-router/blob/7bfc9306cddee725343fb5f0951ba2376ace1e3f/manager/manager.go#L309) verifies each host against the model's pinned repository, requires authenticated freshness, and obtains attested TLS/HPKE keys before installing the host into the serving pool. Its [transport](https://github.com/tinfoilsh/confidential-model-router/blob/7bfc9306cddee725343fb5f0951ba2376ace1e3f/manager/verification.go#L77) rejects new requests after the accepted evidence expires, including on existing connections. Remote configuration cannot silently replace the model's repository mapping; that needs a router release.

The router uses `github.com/tinfoilsh/tinfoil-go v0.17.0-rc.4` for this verification. Accepting the chain means reviewing and trusting this measured router and its verifier, as well as the hardware and release-signing roots. The client-visible admission manifest is useful evidence of that chain; it does not contain a replacement for independently verifying each underlying quote.

**Limits discovered in the actual published client**

Version 1.4.0's JavaScript hardware verifier accepts `sev-snp-guest/v2`. It explicitly rejects other formats. The selected GPT-OSS hosts advertise `tdx-guest/v2`, so this package cannot independently verify those model quotes. The newer main-branch verifier's TDX/config/freshness interfaces must not be assumed to exist in 1.4.0. See the [released source](https://github.com/tinfoilsh/tinfoil-js/tree/e1d5d7da1b9da2dfd463379dd22339afa1b5f37e).

The released bundle fetch does not issue a client-selected nonce. Its report data binds the TLS and HPKE keys, and the live pinned connection demonstrates possession of the attested TLS key. That is useful evidence, but is not the fresh nonce-bound report flow Neslos currently requires. A production integration needs an explicit freshness and anti-rollback policy, including reviewed release pins and controlled reverification. The newer router's backend freshness checks and the older JavaScript client's own checks are different layers.

A direct pinned request to the first GPT-OSS model host timed out after 20 seconds. This is consistent with the documented restricted reachability of model hosts, but the cause was not established. It is not evidence that hardware verification failed. No direct model quote was obtained, no private-network access was attempted and no verification bypass was installed.

The signed model release, verified router and attested TLS channel give a stronger basis for model identity than the NEAR action log alone. A strict client still needs either a deliberate policy accepting the reviewed router's verification chain or independently retrievable model evidence with a suitable verifier. Authenticating the published weight commitment also remains distinct from reproducing that commitment from the original weights.

**Recommended next implementation**

Use GPT-OSS-120B as the first Tinfoil candidate, subject to a current pricing/account check and review of the exact chosen release. Prepare an isolated provider adapter with explicit router/release pins, session freshness, strict transport binding, bounded retries and budget accounting. Decide whether the required assurance accepts the measured router's model-verification chain; do not silently equate it with independent model-quote verification.

Then test one bounded encrypted response and retain verifiable request/response evidence before connecting the adapter to the owner research flow. Finally run the complete research job inside Neslos's independently verified TDX service, with the existing finite hosting and inference caps. The current audit authorizes no claim that those steps have already passed. Private AI research remains disabled, and the working Vercel rehearsal is unchanged.
