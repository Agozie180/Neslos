# Neslos review against Phala Cloud Terms — 7 November 2026

> Historical snapshot. Later standard-image deployments succeeded, and [private NEAR AI research, audit and restart verification passed on 9 November](NEAR-PRIVATE-RESEARCH-2026-11-09.md). Those temporary CVMs are retired. Earlier deployment, publication, inference and submission statements below describe this stage; see [current status](STATUS.md) for remaining work.

**Later live deployment evidence, 22:14 UTC:** the Ubuntu-tested private GHCR image is running on Phala with production `dstack-0.6.1`. HTTPS health, disabled private commands and fresh Intel/DCAP-verified TDX evidence passed. Startup required Phala’s official registry-login script plus a writable root-only Docker credential directory. The owner explicitly authorized the encrypted registry token. This establishes an accepted, working attestation-only configuration; it does not identify the earlier HTTP 400 predicate or settle the broader finance-workflow interpretation below. See [live verification](TDX-LIVE-VERIFICATION-2026-11-07.md).

**No confirmed prohibited workload was identified in the current attestation-only candidate. That finding does not establish acceptance of the broader finance application. The main unresolved question is whether Phala applies its reward-workload restrictions to Neslos's intended yield research and owner-controlled lending, particularly on promotional credit.**

**Post-submission audit, 21:23 UTC:** a fresh official CLI device login succeeded, then the normal `phala deploy` command submitted this exact V3 Compose at 21:18 UTC. It received HTTP 400 with the same terms-of-use message, request ID `3e5a68141d5de59ce8d42e86e70bda6c`; zero CVMs were returned afterward. The rejection happened during provisioning, before this candidate ran. The current [official troubleshooting guide](https://docs.phala.com/phala-cloud/troubleshooting/troubleshooting.md) associates this error category with Docker-image anti-spam checks, specifically abused base images and suspicious image patterns. This is the documented explanation of the error category, not evidence of which rule matched Neslos or that the result was correct.

The follow-up inspection reverified all 50 archived file hashes and examined the 383 package-lock entries against named prohibited software and representative mining/tunneling packages. No such name matched. Two production dependencies, `https-proxy-agent` and `proxy-from-env`, are HTTP client transport helpers: their documentation describes connecting to a proxy or selecting a proxy URL, not operating a proxy server. Neither submitted service configures a proxy, VPN or tunnel. The setup command reconstructs the hash-checked archive, runs `npm ci --omit=dev --ignore-scripts`, and sets the data directory owner. The runtime verifies files before importing the TEE entrypoint. No disguised random executable, autonomous mining job or reward-network worker was identified in these application startup paths. This is a static application/dependency-metadata audit; package-name screening does not certify every dependency implementation.

The application imports `PrivateRuntime` but does not construct it in attestation-only mode. Its public application routes are health, nonce-bound attestation, and a private-command route returning 503. The broader Agent Market implementation buys tasks from other agents; it does not register this CVM as a paid task-serving worker. The functional reward concern remains the APY ranking and lending capabilities described below. The terms' broad wording makes this a real scope question, but neither these features nor the compressed inline packaging are a confirmed rejection trigger. A change in labels, compression or authentication would not demonstrate substantive compliance. Removing token incentives alone would also leave the base-yield/lending question.

**Audit disposition:** no specific code-level violation was established for the submitted bootstrap. The full finance workflow cannot be cleared under §§3/7.4 on promotional resources without resolving whether ordinary investment research/lending is included in the broadly worded reward restriction. The terms do not expressly ban all DeFi software. Their separate §7.4 regulatory-discretion clause also permits restrictions on applications deemed legally risky; no jurisdiction-specific finding was supplied for Neslos. An evidence-backed compliance repair must follow the permitted workload classification. This audit supplies no basis to claim a guaranteed code fix or to infer that purchasing credit resolves the denial. Fresh terms, CLI response and reproducible payload inspection are retained in `.local/tdx-cli-20261107/`.

The support message supplied by the owner directs us to [Phala's Terms](https://phala.com/terms); it does not identify a violated clause or a rejection trigger. The fetched page displays **Effective Date: January 1 2025; Last Updated: Jun 18, 2025**. It was retrieved at 20:16 UTC on 7 November 2026. This is a technical comparison of the terms with the inspected application, not a legal determination or provider approval.

## What the prepared deployment would run

The submitted V3 candidate is `.local/tdx-foundation-20261107/bundle/`. Its Compose SHA-256 is `4eb547066a620d79ebcbe9ea77228d63c2e1c0a8e501ed1a6c8ce1ea37fe625c` and its size is 150,387 bytes. This review decoded its archive, verified all 50 file hashes, checked the retained request service definitions, and matched the manifest to the current source identity. The CLI submission was rejected, with no running Neslos CVM established.

| Scope | Actual behavior |
| --- | --- |
| Current Phala candidate | Both services use the official, digest-pinned Node 24.22.2 image. Setup reconstructs authenticated files and installs locked npm dependencies. The runtime fixes `NESLOS_RUNTIME_MODE=attestation-only`, `NESLOS_NETWORK=testnet`, and `vault.neslos.testnet`. Owner, inference and Intents secret slots are empty. |
| Configured runtime routes | [Startup](../src/tee/index.ts#L8) skips creation of `PrivateRuntime` in this mode. [HTTP routes](../src/tee/app.ts#L19) provide health and challenge-bound attestation; private commands return 503. Key derivation and quotes use the dstack socket. This path performs no market research, inference purchases, lending, or transaction submission. |
| Full private runtime, if enabled later | [Research](../src/tee/runtime.ts#L168) reads market data and requests structured AI assessments. [Preparation](../src/tee/runtime.ts#L189) can produce signed financial authorizations and transaction descriptions for owner review or an authorized relayer. It does not itself broadcast those transactions. Mainnet preparation is separately required for hosted Intents. |
| Owner commerce, outside the active bootstrap | The project implements real Rhea supply/withdrawal call construction and vault-controlled payments. [Execution](../src/owner/commerce.ts#L111) checks an approved plan hash, owner/network binding, public-lending permission and budgets before submitting through the owner's account. These capabilities are not merely UI labels. |

The archive still contains the research, inference, lending, owner-commerce and private-runtime modules. An accurate description must disclose the broader application purpose as well as the restricted startup mode. The terms refer to applications and intended use; they do not expressly promise that inactive capabilities are excluded from review.

## 1. Reward-seeking workloads and promotional credits: unresolved interpretation

Section 3 restricts mining and compute workloads primarily intended to earn external tokens, credits or financial incentives from third-party networks, without prior written authorization. Section 7.4 explicitly includes:

> Any compute workload intended primarily to earn financial rewards, tokens, credits, or points from third-party networks or platforms

It also states:

> Use of Phala Cloud's free-tier or promotional resources for the above purposes is strictly prohibited.

The owner describes the available $5 as NEAR hackathon testing credit. It should therefore be assessed under the promotional-resource wording unless Phala establishes a different classification. An active billing status, `is_post_paid`, or a balance field does not establish an exemption.

Neslos has a meaningful connection to financial returns:

- [Market ranking](../src/core/research.ts#L137) uses base APY plus 25% of reward APY, with penalties. Token incentives influence the selected opportunity.
- The [AI research instruction](../src/core/inference.ts#L60) explicitly compares base yield and rewards.
- [Lending operations](../src/core/lending.ts#L74) construct supply and withdrawal calls. The owner-commerce layer can submit the approved vault operation.

However, the inspected application does not operate a miner, validator, tokenized inference worker, or reward-paying training job. It consumes market APIs and, when enabled, buys inference for the owner's application. Reading APY, holding a staking-related asset, or purchasing inference is not sufficient evidence that the CVM participates in a compute-reward network.

**Assessment:** the wording leaves a real classification question for the full financial workflow; it does not prove that ordinary DeFi research or lending falls within this restriction. The current bootstrap does not execute that workflow. The fetched terms contain no express blanket ban on NEAR, testnets, DeFi, AI agents, or hackathon participation. They also contain no express exemption for Neslos's intended use.

Section 3's written-authorization route must not be assumed to waive section 7.4's stricter promotional-resource rule. Moving to paid resources alone would not remove section 3. The useful clarification is which application scope and resource arrangement Phala permits, not whether a credit top-up makes the same use acceptable.

## 2. Other relevant restrictions

| Terms provision | Project evidence | Assessment |
| --- | --- | --- |
| §7.4: proxy, VPN, tunneling and named prohibited applications | Neither submitted service starts a proxy/VPN/tunnel. The TDX app has the three routes described above. [Vite's proxy](../vite.config.ts#L6) is a loopback development setting and is absent from this deployment. The [provenance verifier](../src/core/inference-provenance.ts#L10) mentions upstream NEAR AI VPC/proxy images; it verifies their provenance rather than deploying them. | No matching local service was identified. Those source strings do not establish either a violation or the provider's filter trigger. |
| §7.4: randomly named binaries | The service runs official `node` and named application modules. The inline archive preserves the file names and authenticated bytes. | No randomly named project executable was identified in the inspected deployment. The terms do not expressly prohibit compression, base64 archives, image digests or integrity hashes. |
| §3: High Risk Activities; §9: professional advice | Neslos ranks financial opportunities and can support owner-approved transactions. Its prompts prohibit promises of returns; the README explains that ranking is a heuristic, and the code applies deterministic limits. | The page does not define High Risk Activities or link a definition. Section 9 says not to rely on the services for financial/professional advice; it is not an express ban on all financial software. Spending caps and owner approval do not establish investment suitability or resolve this interpretation. |
| §§2, 5, 7.1 and 7.2: lawful content, data rights, security and harmful conduct | Inspected research uses Rhea/DeFiLlama JSON APIs and NEAR RPC rather than an HTML crawler. Private commands require an encrypted, expiring owner-authenticated request. No prohibited-content distribution, spam or phishing workflow was identified in these paths. | Public accessibility does not itself establish permission to reuse data. API/data rights, the legality of user inputs and regional financial requirements remain operator responsibilities; future use cannot be certified from the repository. |
| §3: disruption or interference | The [TDX app](../src/tee/app.ts#L15) limits non-health requests to 30 per minute and JSON bodies to 512 KB. [Schedules](../src/owner/scheduler.ts#L12) permit research/observation only, at least five minutes apart, with at most 12 runs. Requests have timeouts and inference spending has a separate durable budget. | Relevant limits exist. This is not a finding of observed resource abuse or a comprehensive denial-of-service assessment. |
| §§3 and 8: reverse engineering, competing services and intellectual property | The inspected provenance checks use published SDK interfaces, public source references and cryptographic attestation. Neslos implements an application treasury, not a general cloud-compute hosting platform. | No attempt to derive proprietary Phala internals or a competing cloud service was identified in these paths. Preserve upstream licenses and avoid presenting the project as endorsed by Phala. |

Account eligibility, authority to accept the terms, and rights to future private inputs cannot be established by build tests. These are scope limits, not findings of a violation.

## What this changes about the rejection investigation

The reward-workload interpretation is now an explicit unresolved item in the project review. It is more relevant to application suitability than changing Node versions or dependencies without a demonstrated defect. It is **not a proven rejection cause**.

The retained 146,642-byte V2 request already fixed the mode to attestation-only and left runtime secret slots empty. It still received HTTP 400 with the policy message on 7 November. Therefore, an attestation-only setting does not guarantee provider acceptance. Conversely, that denial does not prove Phala classified Neslos as mining or prohibited the yield functionality. The support message and public terms reveal neither conclusion.

No source-code change is justified solely by the presence of words such as reward, crypto, proxy or yield. A compliance repair must address the permitted behavior and intended use. Removing labels or changing packaging would not demonstrate that.

For the current candidate, retain its accurately disclosed attestation-only scope. Before describing the full private research/lending deployment as compliant with promotional-resource terms, resolve the interpretation of sections 3 and 7.4. If Phala determines that the intended use is restricted, use a genuinely permitted scope or a resource/authorization arrangement that Phala explicitly accepts. This review does not reinstate a requirement to obtain pre-approval for an unsubmitted payload; the open question is application classification under the published terms.

## Narrow follow-up the owner can send

No message has been sent. This draft asks for the permitted application scope rather than details of internal detection rules:

> We reviewed sections 3 and 7.4. Neslos is a NEAR hackathon development project using the supplied testing credit. The requested CVM uses an official pinned Node image and is fixed to attestation-only: health and attestation endpoints, with private commands disabled. It performs no mining, reward-network work, training, proxying, lending or payments. The repository also contains intended yield-research and owner-approved Rhea lending features, which are inactive in this deployment. Future research would consume market APIs and purchase AI inference, rather than earn rewards for contributing compute. Do sections 3 or 7.4 prohibit either this bootstrap or that intended financial workflow on the testing credit? If so, what application scope or resource/authorization arrangement is permitted?

## Evidence retained

- `.local/phala-terms-review-20261107/terms.html`, `terms.txt` and `terms-source.json`: fetched terms, retrieval time and content hashes.
- `.local/phala-terms-review-20261107/deployment-scope.json`: three retained deployment configurations, all-file archive verification, source identity and inspected-file hashes. Runtime credentials are not included.
- [Foundation audit](TDX-FOUNDATION-AUDIT-2026-11-07.md): 593 application tests, six retained headless Chromium checks and actual restricted Linux container verification. Those tests establish technical behavior, not contractual permission.

Reviewed working-tree source digest: `735dfd2d1e799999b65f59be181bc898fba67f93526190b6a1991de4f862972c`, based on revision `5d630c225465d56909e25d93772a136ec417748f` plus the local source changes recorded by that review. This review changed documentation only. It sent no provisioning request, paid inference, chain transaction or support message.
