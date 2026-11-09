# Phala rejection audit — 7 November 2026

**Live verification, 7 November at 22:13–22:14 UTC:** Neslos is running on Phala in attestation-only mode. HTTPS health and fresh nonce evidence pass; private commands return 503. Intel/DCAP verifies TCB `UpToDate`, debug disabled, and both application keys bound to the challenge. All 11 RTMR3 runtime events replay to the verified quote and bind the deployed Compose. Complete independent boot-measurement approval and private execution remain unfinished. See [live deployment evidence](TDX-LIVE-VERIFICATION-2026-11-07.md).

The earlier rejection investigation below is historical. A standard image and compatible production OS were subsequently accepted; registry startup defects were then repaired. The precise earlier policy predicate remains unconfirmed.

**21:18 UTC continuation:** the owner completed another official CLI device login successfully. One normal `phala deploy` attempt submitted the verified 150,387-byte V3 attestation-only Compose and received the same HTTP 400 terms-of-use error, request ID `3e5a68141d5de59ce8d42e86e70bda6c`. The response identifies `POST /api/v1/cvms/provision`. Post-attempt inventory returned zero CVMs. The earlier browser-control block did not prevent this CLI attempt. Its exact command and response are retained under `.local/tdx-cli-20261107/`; no browser-console submission is claimed. Renewing the login did not resolve the deployment rejection.

**Browser/device-code login succeeded. The later deployment request was rejected; its exact triggering rule remains unconfirmed.** The owner is using Phala's $5 NEAR hackathon testing credit. Saved account responses independently confirm the $5 balance. This audit found no evidence that a payment, upgrade, repeated verification or replacement credential is required to resolve the rejection.

This report previously gave speculative account/payment fields too much weight and did not distinguish the successful console login clearly enough from the later provisioning requests. Those implications are withdrawn. The retained evidence supports the following sequence.

## Authentication and deployment history

| Stage | Evidence | Result |
| --- | --- | --- |
| Initial credential attempt | The [4 November authentication audit](PHALA-AUTH-AUDIT.md) found a Private AI credential incorrectly configured for Cloud management | That initial method failed; it was corrected before the later deployment attempts |
| Official browser/device-code login | The owner completed the console link/code flow. Cloud authentication passed at **4 November, 14:18:55 UTC**. `.local/implementation/phala-final-status.json` at **14:36:03 UTC** records `authenticated:true`, `source:"cli-profile"`, $5 and matching workspaces | Login succeeded; the owner did not need to manually configure another API key |
| Original V1 deployment, 6 November | Retained prepare request received HTTP 400 with the terms-of-use message. Its 230,107-byte Compose also exceeded the official 204,800-byte limit | A real local size defect was found; the response did not identify it as the rejection trigger |
| Corrected V2 deployment, 7 November | `.local/tdx-console-20261107/submit-once.mjs` loads the saved login profile through `loadConfiguration()`. The accompanying status record identifies `cli-profile`. The 146,642-byte request passed the official schema but received the same HTTP 400 message | The successful login was used. The size repair did not obtain deployment acceptance |
| Current V3 candidate | 150,387 bytes; startup/dependency integrity checks pass in Linux | Prepared and tested locally; not submitted or deployed |

The historical folder name `.local/tdx-console-20261107/` does not identify a browser deployment: its saved helper submitted the corrected request programmatically using the successful login profile. **Console/device login is confirmed; a browser-console deployment submission is not established by these records.** Current browser automation availability says nothing about whether the earlier login succeeded.

## TDX and NEAR testnet compatibility

**Phala TDX hosting can run an application connected to NEAR testnet; it is not restricted to mainnet applications.** TDX protects the cloud VM. The application chooses which NEAR network and accounts it uses. Public sources fetched on **7 November 2026, 15:18–15:24 UTC** provide positive examples, beyond merely omitting a restriction:

| Evidence | What it establishes |
| --- | --- |
| Phala's [Cloud vs Onchain KMS](https://docs.phala.com/phala-cloud/key-management/cloud-vs-onchain-kms.md) says: “Deploy to Phala Cloud and your application automatically gets keys from Cloud KMS after attestation. No blockchain setup needed.” Its [Phala KMS CLI reference](https://docs.phala.com/phala-cloud/phala-cloud-cli/kms/phala.md) identifies PHALA as off-chain KMS | The chosen Cloud KMS does not require a NEAR mainnet account or mainnet contract to host the application |
| The published NearDeFi [Shade Agent deployment configuration](https://github.com/NearDeFi/shade-agent-template/blob/816b75bc0423addcbb3b1362026b33f2ddd5c973/deployment.yaml#L1) declares separate `environment: local \| TEE` and `network: testnet \| mainnet` choices, defaults to `network: testnet`, and configures `deploy_to_phala` with `instance_type: tdx.small`. Its [README](https://github.com/NearDeFi/shade-agent-template/blob/816b75bc0423addcbb3b1362026b33f2ddd5c973/README.md#tee-deployment) says to change the environment to `TEE` and run deployment | A published NEAR testnet plus real Phala TDX deployment pattern exists; switching to TEE does not require switching to mainnet. This source is used for network compatibility, not its historical account or pricing advice |
| Phala's own [ERC-8004 TDX tutorial](https://docs.phala.com/phala-cloud/getting-started/explore-templates/deploy-erc-8004-agent.md) uses a TDX CVM and registers/verifies the agent on **Ethereum Sepolia**, with linked example transactions | Phala itself documents a TDX application using a blockchain testnet; a general mainnet-only hosting claim is contradicted by its documentation |
| NEAR's [network documentation](https://docs.near.org/protocol/network/networks.md#testnet) describes testnet as the public environment for app/contract development. The live [hackathon brief](https://nearhackathon.com/HACKATHON.md), Q-010, says: “Testnet-only projects eligible? Yes, all tracks. Mainnet only where the integration is mainnet-only.” | The existing NEAR testnet target is compatible with development and hackathon eligibility |

The actual retained Neslos requests use `kms:"PHALA"` and `instance_type:"tdx.small"`, with no top-level NEAR network field. V1 defaulted its application network to testnet. Rejected V2 and prepared V3 both fix `NESLOS_NETWORK=testnet`, `NESLOS_VAULT_ACCOUNT=vault.neslos.testnet`, and `NESLOS_RUNTIME_MODE=attestation-only`. [Runtime configuration](../src/tee/config.ts) accepts both NEAR networks, and [the NEAR client](../src/core/near.ts) selects testnet RPC endpoints for testnet. The existing owner remains `neslos.testnet`.

The separate [hosted Intents verifier documentation](https://docs.near-intents.org/integration/verifier-contract/introduction.md#deployment) says there is no testnet deployment. That restriction applies to the provider's settlement integration; it does not make Phala TDX, the Neslos testnet vault, or hardware attestation mainnet-only. Neslos's production Intents settlement reader consequently uses mainnet; it is not the TDX deployment path.

**No change to mainnet is justified as a repair for this rejection.** These sources establish network compatibility, not acceptance of this particular application/account. The provider's exact rejection predicate remains undisclosed. This check made public read-only requests and inspected saved configurations; it did not deploy anything or change the target. Captures, retrieval times and SHA-256 hashes are retained in `.local/tdx-network-audit-20261107/sources.json` and the adjacent source files.

## What was checked at the source

| Possible cause | Direct evidence | Conclusion |
| --- | --- | --- |
| TDX permits mainnet only | Phala documents a TDX/Sepolia deployment; the pinned Shade Agent template combines NEAR testnet and Phala `tdx.small`; Cloud KMS requires no blockchain setup | NEAR testnet is a supported application pattern. There is no documented mainnet-only hosting restriction to fix |
| Wrong account or the earlier email typo | `/auth/me` returns `email_verified:true`; its email matches the owner's corrected `moduleairdrop@gmail.com` | The current Cloud profile uses the intended verified account |
| Missing workspace authority | Current workspace role is `OWNER`; workspace detail agrees with `owner` | No missing owner role is exposed |
| Billing suspension | Workspace detail returns `billing_status:"active"`, `suspended_at:null`; account balance is $5 and outstanding amount is null | No billing suspension or reported outstanding amount is exposed; no payment repair is supported |
| Exhausted quotas | All eight VM slots, 16 vCPUs, 32,768 MB memory and 160 GB disk remain available; per-VM disk limit is 80 GB | The requested one `tdx.small` with 20 GB disk fits the exposed quota |
| Missing advanced feature | Account and workspace feature lists are empty; the request uses ordinary Docker Compose, not the advanced raw-compose/bash/annotation features identified in the SDK | No requested advanced-feature dependency was identified |
| SDK transformation or a hand-built body error | Executed installed `@phala/cloud` 0.4.0 `provisionCvm` against an in-memory transport. The accepted V2 and V3 input objects equal the SDK's outgoing objects exactly | No SDK body correction is missing; the test sends no network requests |
| Wrong endpoint/version | Installed SDK selects the same `/cvms/provision` endpoint used by the saved request. Current public SDK source selects `/cvms` and explicitly retains legacy endpoint support. API version `2026-06-23` is supported | Moving endpoints is not an established repair for this denial |
| Corrupted or different wire request | Re-serialized corrected request SHA-256 exactly matches the digest recorded immediately before submission | Audited corrected bytes are the submitted bytes |
| Compose too large | Original: 230,107 bytes, rejected when later checked offline against the SDK. Corrected V2: 146,642 bytes, accepted by SDK but denied by provider. V3: 150,387 bytes, accepted offline | The original size defect is real and fixed. Size correction was insufficient to remove the provider denial |
| Invalid image-reference syntax | Both services use the maintained official Node tag plus digest on Linux/amd64; the provider's supplied reply explicitly confirms tag-plus-digest support | No syntax repair is supported by this evidence; image eligibility remains undisclosed |
| Runtime, dstack socket, dependency or NEAR failure | The HTTP 400 occurred in the prepare phase, before a commit or VM launch. Zero CVMs exist. Actual Linux startup checks pass separately | Runtime execution failures did not produce this HTTP response. Static classification of the submitted configuration or embedded source is still possible and has not been established or excluded |
| Prohibited enabled workload | The measured mode is literally `attestation-only`; runtime secrets are empty. The entrypoint does not instantiate the private runtime in this mode. It exposes health/attestation, with `/private` returning 503 | No mining, token-reward compute, VPN or open-proxy operation was identified in this stage. This does not establish Phala's internal classification or legal approval |
| Image/application/account eligibility restriction | Public FAQ and troubleshooting associate this message category with image anti-spam restrictions. The supplied provider response says account state can also matter and refuses to identify checks | This is the remaining decision boundary; the specific predicate cannot be reconstructed from the exposed evidence |

The account/role/quota observations were taken at approximately **13:59–14:00 UTC** and the new diagnostic command confirmed them again after the code checks. They describe current exposed state; they do not reconstruct every hidden account attribute at the time of the rejected request. An active workspace and valid credentials do not prove an absence of application-specific restrictions. No claim of an account-wide ban or a false positive is justified.

## Exact rejected request

The corrected request received HTTP **400**, HTTP Date **7 November 2026, 11:57:57 GMT**, and request ID **`aa623dcc09a5439de6de5010d470d336`** (duplicated in the returned header):

```json
{"detail":"You are not allowed to deploy the target applications since it violates our terms of use."}
```

Its wire-body SHA-256 is `fb8e93434c0f4cdeb3c11504377a9551efe133872fed4dea623d239e99cd6386`. Its Compose SHA-256 is `5790bca5bbd949a7aaf02693b6aedf5e613ba7d9bbe52bd59c3fc8983a36b64b`. No successful preparation token or commit followed. The full [submission record](TDX-PROVIDER-FOLLOWUP-2026-11-07.md) remains intact.

The complete public repository tree at commit `2657978f59bbbdb6476f89d9519bbc78ea12e840` exposes client SDKs, CLI, Terraform, templates and related material. It does not supply the Cloud backend's rejection predicate. Public issue searches for the denial wording and this repository's terms-related issues returned no matching explanation. The public OpenAPI describes requests and schemas, not the matched policy rule. There is no client-side rule identified here that can legitimately be patched to force acceptance.

## Diagnostic repair

The earlier `cloud:status` checked credentials, balance and inventory, but omitted exposed deployment prerequisites. [The diagnostic helper](../scripts/cloud.mjs) now supports:

```sh
npm run cloud:status -- --deployment-checks
```

It adds email verification, workspace role, billing lifecycle and remaining VM/CPU/memory/disk quotas through read-only requests. Missing, malformed or inaccessible fields remain unknown. It always reports `providerPolicyAcceptance:"not-established"`: these account checks cannot grant provider approval. It omits account identifiers, email addresses, credentials and raw resource data.

Four [regression tests](../tests/cloud-deployment.test.ts) cover healthy-account versus approval separation, suspended/unverified/exhausted states, unknown/malformed responses, and credential-safe read-only requests. **586 application tests passed, four platform tests skipped, and TypeScript/production builds passed.** Verification run: `3102dea5-22a5-4f41-b8f0-8e6a147ef5fc`; source-content digest: `dd7430da754860d5ceb16aefab6110af2809fa0b4fb9da4883f2d9c10cca3e55`.

The current manifest is regenerated under `.local/phala-rejection-root-20261107/bundle/`. Its Compose and all embedded application bytes are identical to the [Linux-tested V3 candidate](TDX-STARTUP-AUDIT-2026-11-07.md), with Compose SHA-256 `4eb547066a620d79ebcbe9ea77228d63c2e1c0a8e501ed1a6c8ce1ea37fe625c`. The new source digest reflects diagnostic/test changes; the runtime payload has not changed. This audit did not submit V3.

## Remaining action

Phala's reply recommends normal console deployment submission and offers no pre-approval. The earlier console/device login already succeeded. On rechecking the current automation inventory after the owner's correction, the tool still returned `The browser access host is unavailable` and an empty browser list. This prevents this agent from continuing the requested background Brave deployment flow now; it is a local automation problem, separate from Phala authentication and the provisioning denial. No new login or payment is justified by that tool failure.

To establish the exact root cause, Phala would need to expose the failed rule or a documented remediation tied to this request/account; alternatively, its normal console flow may expose a concrete missing requirement or accept the candidate. Neither result has been observed. **The rejection is not fixed or explained down to a specific rule.** No more provisioning requests, paid operations, account/billing changes, support messages or chain transactions were made during this audit.

Evidence is retained in `.local/phala-rejection-root-20261107/`, including `account-check.json`, `workspace-details.json`, `request-path-check.json`, `cloud-deployment-checks.json`, public source snapshots, and the current manifest. The earlier source/size and startup defects remain fixed.

Sources: [Phala troubleshooting](https://docs.phala.com/phala-cloud/troubleshooting/troubleshooting.md), [FAQ](https://docs.phala.com/phala-cloud/faqs.md), [Terms](https://phala.com/terms), [pinned provision action](https://github.com/Phala-Network/phala-cloud/blob/2657978f59bbbdb6476f89d9519bbc78ea12e840/js/src/actions/cvms/provision_cvm.ts), [pinned client](https://github.com/Phala-Network/phala-cloud/blob/2657978f59bbbdb6476f89d9519bbc78ea12e840/js/src/client.ts), [public OpenAPI](https://docs.phala.com/openapi.json).

## Deeper research: account state, key permissions and console transport

The observations below do not identify a rejection cause. They are retained to explain the research and prevent their reuse as unsupported account/payment diagnoses. The successful browser/device-code login and the owner's $5 hackathon testing credit remain the starting facts.

### Public schema fields do not establish an account defect

The JavaScript published by Phala's public login page includes data schemas with separate `email_verified_at` and `account_verified_at` fields. A workspace billing-cohort schema also includes `has_truly_paid` separately from tier, billing mode and billing status. These definitions are visible in [the published schema asset](https://cloud.phala.com/_next/static/immutable/chunks/0c6bxyv5lmes-.js), SHA-256 `a7f67566559ff3a26d518e45e2cbc8cd5b1262db2de9a24680e27bcae14aaef0`.

These are public administrative schema definitions, not observations of a problem with this account. Neither the owner's values nor a connection to the rejected request was found. No administrative endpoint was requested. They provide no basis for asking the owner to pay, upgrade or verify again.

The current public [billing page](https://cloud.phala.com/about/billing) says Balance can include welcome credit. This is compatible with the owner's explanation of the $5 testing credit. `granted_balance:0` and `is_post_paid:true` do not contradict that explanation or establish a missing payment. The earlier emphasis on whether the owner had paid was unsupported.

### Billing-read denial fits the official login scope

The official [CLI login source](https://github.com/Phala-Network/phala-cloud/blob/2657978f59bbbdb6476f89d9519bbc78ea12e840/cli/src/commands/login/index.ts) requests `user:profile cvms:* nodes:*`, with no billing scope. A read-only research request to `GET /billing/state` using the saved browser-login profile received this response:

```json
{
  "error_code": "ERR-06-009",
  "message": "This API key is not allowed to use this permission",
  "details": [{"field":"permission","value":"BillingPermission.READ","message":null}]
}
```

That response is HTTP **403**, with request ID `5db86909d9d877804338fc7d0c45082b`, captured at approximately **14:42 UTC**. It is compatible with the official login's normal scope and supplies no evidence of a deployment-permission defect. The earlier deployment response was HTTP **400**, with a different body and no permission code.

The saved credential is opaque and contains no readable granted-scope metadata. The scripts resolve the selected login profile, and its stored workspace slug matches `/auth/me`. This is the result of the successful device-code login; it is not the original rejected Private AI credential or evidence that the owner manually supplied a new key. No credential replacement or permission expansion is supported by this result.

### The console request context is observably different

The publicly delivered console code creates its workspace client with `baseURL:"/api"`, `useCookieAuth:true`, and an explicit workspace header. Its bundled provision action sends `POST /cvms`. Together, those identify the console-side request path as `/api/cvms`, using the logged-in session. The rejected request instead used `X-API-Key` at `https://cloud-api.phala.com/api/v1/cvms/provision`.

Evidence: [console client configuration](https://cloud.phala.com/_next/static/immutable/chunks/3z0rictvc1xe5.js) and [bundled provision action](https://cloud.phala.com/_next/static/immutable/chunks/2xsxga2e10k58.js), with the latter's SHA-256 `d8d0549ec30022d05e9fcfc3ece86ef10c79e43d30ce4e5956b7ffff74a1a818`. Only public assets were read; no browser session data or cookies were accessed.

The current public SDK says the legacy endpoint remains supported. The observed transport difference therefore does not establish a broken route, an API-key deployment ban, or a bypass. It does explain why offline SDK body parity cannot settle whether the provider-recommended console path behaves the same way. A normal console submission remains the next supported observation; it has not been executed in this session.

### Old free-tier advice is not a current remedy

The [January 2026 FAQ](https://github.com/Phala-Network/phala-docs/blob/53277cbbd29ef1be979259e5b59beea949e1d6be/phala-cloud/faqs.mdx) described Free users, payment verification and a one-CVM limit. On **6 October 2026**, Phala explicitly [removed that guidance](https://github.com/Phala-Network/phala-docs/commit/1ad6a458afbc72bfed4d2a142430f20bc1109c92), stating that there is no Free tier. The same correction says welcome credit goes into Balance. An old article's advice to add a card or upgrade out of a Free tier is not evidence of a required fix for this account.

### What the two rejections can establish

| Shared or changed factor | Consequence for causal reasoning |
| --- | --- |
| Same intended account/profile, application name, official Node image reference, instance type, OS image, KMS and legacy API path | The two denials do not distinguish restrictions on these shared factors |
| Both use an inline compressed application archive and `node -e` bootstrap | A loader/image-pattern hypothesis has not been isolated or proven; the public docs do not specifically identify this loader as a trigger |
| Compression, payload size, bundled application revision and measured runtime-mode configuration changed | Multiple variables changed together. The second denial proves that the size repair did not obtain acceptance; it does not identify a unique shared cause |
| No VM was launched | Actual application execution failures are excluded. Static inspection of submitted configuration or packaged source remains an unresolved possibility |

The current troubleshooting guide describes this message category as an application/image restriction, while the supplied provider response declines to identify the check. Neither source establishes a defect in this account. No available observation identifies the evaluated condition, whether multiple conditions failed, or whether the two requests hit the same check. Ranking payment, verification, packaging or transport hypotheses as likely causes would go beyond the evidence.

Broader GitHub code/issue searches and public web searches found no independently verifiable case matching the exact denial with a confirmed remedy. Unrelated deployment reports and old billing guidance were not treated as proof. Search coverage is incomplete: Bing returned no items for the exact queries, and Google returned a JavaScript redirect page rather than usable results.

All new evidence is under `.local/phala-deep-research-20261107/`, including `published-client.json`, `console-routes.json`, `console-auth.json`, `billing-structured-error.json`, `credential-metadata.json`, `workspace-binding.json`, historical FAQ snapshots and source hashes. Three read-only billing requests were made to capture the structured denial after earlier captures omitted its nested error body. No deployment variants, payments, permission changes or administrative requests were made. Runtime source and the verified V3 payload are unchanged. The precise rejection cause and a successful remedy remain unconfirmed.
