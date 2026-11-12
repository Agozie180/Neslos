# Phala credential scope audit — 4 November 2026

> Historical snapshot. The balances, zero-spend totals and remaining deployment work below describe 4 November. [Private research later passed inside verified TDX](NEAR-PRIVATE-RESEARCH-2026-11-09.md); those temporary CVMs are retired. See [current status](STATUS.md) for retained costs and remaining work.

The Phala blocker was a valid **Private AI credential stored as `PHALA_CLOUD_API_KEY`**. The diagnostic sent it to Cloud management's `/auth/me` endpoint and interpreted HTTP 401 as an invalid credential. That conclusion was incomplete: it established only that Cloud management did not accept the key.

## Evidence

Phala's [Private AI client](https://github.com/Dstack-TEE/private-ai-gateway/blob/main/apps/desktop/runtime/src/account_login/billing.rs) checks account access and credit at `GET https://cloud-api.phala.com/api/v1/private_ai/self` with `Authorization: Bearer`. Its [account login implementation](https://github.com/Dstack-TEE/private-ai-gateway/blob/main/apps/desktop/runtime/src/account_login/phala.rs) uses the same endpoint and checks user/workspace identity.

The controlled check at **2026-11-04 13:54:31 UTC** returned:

| Credential | Private AI account endpoint | Interpretation |
| --- | --- | --- |
| None | 401 | Anonymous access rejected |
| Deliberately invalid value | 401 | Invalid credential rejected |
| Existing `.env` Phala value | 200, user/workspace resolved, balance **$5.000000**, granted balance **$0.000000** | Valid Private AI account credential |

The same configured value was rejected by Cloud management using both its documented `X-API-Key` authentication and a Bearer control. This is a scope mismatch, not an expired or broken Private AI key. The previously used API version `2026-01-21` remains [supported](https://docs.phala.com/phala-cloud/references/cloud-js-sdk/api-versioning); changing the version did not resolve the mismatch.

Public model listing is not authentication evidence. A nonexistent receipt lookup and an empty chat request also returned the same 404/400 responses for missing, invalid and configured keys. Those routes did not distinguish authentication and were not used to establish key validity. No prompt, model execution, CVM creation or funded transaction was performed. Total implementation cloud spend remains **$0**.

## Correction

The local `.env` now preserves the existing key under `PHALA_AI_API_KEY`, leaves `PHALA_CLOUD_API_KEY` blank, and preserves the NEAR AI credential. A private, ignored backup was retained. Migration rechecked the credential scope and preserved other environment values before replacing the file. No credentials are committed.

`npm run cloud:status` now reports the two services separately:

| Configuration | Purpose and authentication |
| --- | --- |
| `PHALA_AI_API_KEY` | Private AI account/balance, Bearer authentication at `/private_ai/self` |
| `PHALA_CLOUD_API_KEY` | Cloud management, `X-API-Key` at `/auth/me`; then read-only CVM inventory |
| Official CLI current profile | Used for management when no nonempty Cloud environment key is configured |
| `NEARAI_API_KEY` | Existing NEAR AI no-charge validity check; the private runtime continues to use NEAR AI |

On HTTP 401, the diagnostic checks the other service's authenticated account endpoint before reporting a scope mismatch. It validates account response structure, distinguishes permissions/transport/rate limits/malformed responses, and emits allowlisted fields only. It never copies raw account/resource objects, server errors, identities, credentials or Compose data to the report. An unavailable inventory or billing field stays unknown; it is not treated as zero cost. `returnedCount` is the current inventory response size, not an exhaustive billing audit.

Environment credentials take precedence over `.env`; differing values produce a warning naming only the variable. For CLI credentials the script reads `~/.phala-cloud/credentials.json`, supports `PHALA_CLOUD_DIR` and `PHALA_CLOUD_PROFILE`, and accepts only the hosted Phala API origin. It never rewrites configuration during a status check. The public NEAR model catalogue is explicitly labelled as unauthenticated.

## Cloud authorization and deployment

The Windows and Ubuntu documented CLI stores initially had no saved management login. The owner completed Phala's [official device login](https://docs.phala.com/phala-cloud/phala-cloud-cli/login). At **2026-11-04 14:18:55 UTC**, the corrected diagnostic authenticated **both** services: Private AI using the renamed key and Cloud management using the saved official CLI profile. Cloud reported a **$5.000000 balance**, **post-paid billing**, and **zero CVMs returned**. NEAR AI's no-charge validity check also passed. The authentication blocker is resolved.

For a future login refresh:

```sh
phala login --no-open
npm run cloud:status
```

This repo has official CLI **1.1.22** installed in the ignored tools directory. On this Windows machine it can be invoked with:

```powershell
.\.tools\node-v24.22.2-win-x64\node.exe .\.tools\phala-cli\node_modules\phala\dist\index.js login --no-open
```

The owner approves Phala's device link and selects the intended workspace. Login itself does not provision anything. The resulting official profile is picked up by the corrected status command, without copying a token into chat or source control. A valid Private AI credential cannot grant management permission by changing headers.

Before provisioning, inspect available CPU TDX resources, price, retained-storage charges and a reliable stop/delete procedure. The workspace is post-paid, so its credit balance is not a spending ceiling. The owner's **$3 combined cap** remains in force, with a private allocation of $0.25 for inference and $2.75 for hosting. Genuine hardware deployment, independently approved measurements and live encrypted inference still need evidence; authentication does not complete those steps.

The diagnostic also preserves NEAR's structured USD catalogue prices (`amount × 10^-scale`) and rejects malformed or unknown-currency price fields. No listed model or price is treated as an approved attestation policy.

The read-only hosting audit found `tdx.small` (1 vCPU, 2 GB RAM) at **$0.058/hour** in the [public CPU catalogue](https://cloud-api.phala.com/api/v1/instance-types/cpu). Phala's [pricing page](https://cloud.phala.com/about/pricing), updated 6 October 2026, specifies minute-based CPU billing with no minimum and storage at **$0.000139/GB/hour**, including while stopped. A 20 GB disk adds $0.00278/hour, making one running hour **$0.06078** at these rates. Compute stops billing when the stop request is received; storage requires [CVM deletion](https://docs.phala.com/api-reference/cvms/delete-cvm). This is a dated cost estimate, not a provisioned instance or a provider-enforced spending cap. Prepare bounded teardown before launching a paid deployment.

Verification after the fix: **226 application tests across 22 files**, strict TypeScript and production builds passed in Ubuntu WSL. The new 33 diagnostic tests cover both credential-scope directions, missing/invalid controls, malformed responses, transport/permission failures, output redaction, structured pricing, environment precedence and official CLI profile resolution. All live checks used account/catalogue endpoints only; spend remained $0.
