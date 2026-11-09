# Private NEAR AI research proved — 9 November 2026

**A complete private research job passed inside Neslos's independently verified Phala TDX runtime at 16:15:54 UTC.** The lending, liquidity and risk researchers each returned a verified NEAR AI report covering both live USDC/USDT markets. The encrypted audit, signed receipt opening, wrong-owner rejection and replay without additional inference passed. After a CVM restart, the result, keys, audit checkpoint and all six TDX inference reservations survived; a new job was rejected before inference at the call limit.

The temporary server was deleted at 16:22 UTC after verification. The testnet vault's original policy and executor key were restored, still paused at version 13. Token balances, nonce and spending consumption are unchanged. No funded settlement was attempted. The [Vercel rehearsal](https://neslos.vercel.app) remains a separate simulated-funds application.

The [evidence index](../deploy/near-private-research-20261109/record.json) lists SHA-256 and byte length for each archived artifact. Raw owner jobs, receipt openings, credentials and provider captures remain private. Their [retained-byte commitments](../deploy/near-private-research-20261109/private-evidence-commitments.json) support later owner review; hashes alone do not let a third party verify private report contents. The archive includes the public Neslos quote, measurements, Compose, exact build-source receipt, sanitized results and restoration/retirement evidence. These are historical checks, not a currently running service.

## What changed and why it worked

The [deployment/history audit](MODEL-DEPLOYMENT-AUDIT-2026-11-09.md) established that the latest GLM rejection was a conservative source-selection rule, not a demonstrated engine mismatch. The manager records attempted launches and omits effective runtime state. Direct TLS could distinguish the observed standard and long-context endpoints despite their shared inference signer. The implemented path therefore requires an explicit, bounded policy with **reviewed provider-administration trust**.

| Change | Enforced behavior |
| --- | --- |
| Exact SDK upgrade to `@nearai/inference-sdk@0.3.0` and opt-in direct client | E2EE, OHTTP, Ed25519, zero attestation cache TTL, exact origin/TLS key/signer/instance and approval expiry |
| Additional proxy/manager association | Both nonce-bound quotes must have matching reviewed registers, report-data nonce binding and authenticated instance events; the SDK independently verifies quotes and event replay |
| Reviewed history exceptions | Only individually hashed trailing restarts or disjoint launches may be explicitly reviewed. The complete history hash stays pinned; changed, duplicate, misplaced, unused and unreviewed entries reject |
| Address selection with pinned HTTPS | A reviewed IPv4 route preserves hostname, SNI and certificate validation. No serving-key expansion or unpinned fallback |
| Bounded TLS retry | At most six connection attempts, only after a definite handshake SPKI rejection. HTTP failures, timeouts and unknown inference outcomes are not retried |
| NVIDIA response retention | Verify the same signed NRAS bytes after one three-second wait for `not_yet_valid`; no time tolerance or signature/nonce/issuer bypass |
| Constrained research output | Send a JSON schema generated from the actual Zod report schema; independently validate the response after signature verification |
| Reviewed GLM output controls | `thinkingTokenBudget:null` and `reasoningEffort:"none"` avoid spending the output allowance on reasoning; an earlier zero-token setting produced malformed output |

The first TDX job made three calls but failed schema validation for two researchers. Its reservations remain charged. A code/image update enabled full JSON-schema constrained output, and the next three-call job passed. JSON-object mode alone was insufficient. No malformed report was accepted and no failed reservation was refunded.

## Provider approval and its limits

The [reviewed inference policy](../deploy/near-private-research-20261109/reviewed-inference-policy.json) selected `z-ai/glm-5.3-flash` at `https://glm-5-3-flash.completions.near.ai/v1`, with:

- TLS SPKI SHA-256 `aaf70a60f0e55a3cfcdb3d58142a25e34b620c85e2d796e91edfd9086ca09b27`.
- Ed25519 signer `5a0210f2442c79355784f9de021985429561da5bacc3a4424b01ac52b7e0caff`.
- Provider instance `19aea1693533dc2d529db03e3f725f20bde8d66d` and reviewed connection address `160.72.54.150`.
- Approval expiry **10 November 2026, 00:00 UTC**. This is an archived approval, not a reusable future authorization.

The 250-action history retained the first 243 previously reviewed actions exactly. Selected proxy launch index 247 uses source commit `4d64477b298038f59e92b268a2a5feb34e597fe0`, file `prod/GLM-5.3-Flash-SGL-TP2x4-W4AFP8-V12Q8.yaml`, SHA-256 `e88b040e8ecdb7869ac855880719f6d184c035f0199753bef64ed338f8622922`. The exact successful nginx restart at index 248 and registrar-only launch at 249 were explicitly reviewed. The registrar has no host mounts, privileges or build; its script registers routing and sends fixed health checks. Its administrative effects remain trusted. A different TLS key still rejects.

The [approval review](../deploy/near-private-research-20261109/approval-review.json) preserves the full history hash and the two exception hashes. The earlier audit independently checked proxy, manager, engine and immediate-base publisher provenance. A [fresh free preflight](../deploy/near-private-research-20261109/provider-preflight-summary.json) passed at 16:07:27 UTC, before the successful research job. Runtime requests also require fresh SDK verification.

**This proves the verified confidential channel and signed responses under the declared policy. It does not independently prove the bytes of currently loaded model weights, all effective environment values, or every possible provider backend.** The provider's deployment and routing administration remains a trust dependency. The exact TLS pin narrows the admitted endpoint; it does not make the manager's action history an immutable runtime manifest. An enforced, quote-bound runtime/weight manifest or an immutable deployment would support a stronger claim. The [Tinfoil investigation](PRIVATE-AI-ALTERNATIVE-2026-11-09.md) remains a researched alternative, without adding another backend to this project.

## Neslos TDX and research evidence

| Item | Retained result |
| --- | --- |
| Final private image | `ghcr.io/agozie180/neslos-tee@sha256:d432e429fa798180b1b61b39b772c522347191f1dd369fb595997f4a2a17f08f` |
| Exact source | All 63 build inputs match the retained Linux build context; [source receipt](../deploy/near-private-research-20261109/source-receipt.json) |
| Deployment | Production `dstack-0.6.1`, `tdx.small`, 20 GB disk; CVM `372acf7c-e25a-45b7-8ee1-fd85ff0508a3` |
| Hardware and boot | Intel/DCAP `UpToDate`, debug off, fresh nonce/key binding; independently calculated MRTD and RTMR0–2 match; all 11 RTMR3 event digests recomputed and replayed |
| Application | Exact final image and Compose hash `dec29c5b5c5f142b34c4e0bff3b16d52bed4d580518e2aee7aab31e1287df917`; [verification](../deploy/near-private-research-20261109/verification.json) |
| Research | Three `verified-near-ai` researchers, two assessments and six findings each, live source mode; [result summary](../deploy/near-private-research-20261109/research-proof.json) |
| Receipt and replay | Signed opening verified, wrong owner rejected, identical same-job replay with no additional calls |
| Restart | Fresh hardware/keys verified; identical prior audit/checkpoint/result; receipt still decrypts; six-call accounting retained; [restart proof](../deploy/near-private-research-20261109/restart-proof.json) |
| Exhaustion | A new job rejects with `INFERENCE_BUDGET_EXHAUSTED` before inference; usage unchanged |
| Cleanup | HTTP 404 and empty CVM inventory; [retirement](../deploy/near-private-research-20261109/retirement.json) |

Successful job ID: `bbcb3b3b-8eff-4d79-beac-26fb171ad44d`. Result SHA-256: `bb101e8984df9316dd1cfeee68f042ce0705fd69776027354d21195adbc0c837`. Retained completed-job audit checkpoint: `f38fcb74a3f8cd0a1953eabac3f6cf4510fac56fe14c98b9b619c796d17a8b45`.

The proof used the owner CLI/private-client path. Browser tests for the separate owner workspace use fixtures and do not establish a live owner-browser session. The archive's container smoke result correctly says `genuineHardwareVerified:false`; the real hardware proof is the separately verified CVM quote.

## Testnet restoration and cost

The owner signed four testnet governance transactions locally: pin the verified executor, permit the two research assets and temporary venue commitment while keeping pause, then restore the original policy and executor. The [restoration summary](../deploy/near-private-research-20261109/vault-restoration.json) contains all transaction hashes. Policy versions advanced from 9 to 13. No token transfer, funding, settlement or unpause was performed by this proof.

| Reservation | USD |
| --- | ---: |
| Three local diagnostic inference calls | 0.00212376 |
| Six TDX calls, including the failed job | 0.00847248 |
| Total inference reservation | **0.01059624** |
| Four conservative one-hour hosting reservations at $0.060780/hour | 0.24312000 |
| Combined conservative reservation | **0.25371624** |

These are reservations, not a reconciled provider bill. They remain within the authorized **$3 combined**, **$2.75 hosting / $0.25 inference** allocations. No active CVM remains. The [budget summary](../deploy/near-private-research-20261109/budget-summary.json) retains all nine calls; restart and image updates did not reset credit.

## Verification and running again

Ubuntu WSL verification passed **638 tests in 46 files**, with zero failures or skips, plus TypeScript and production web/server builds. The JSON runner counts 104 suites including nested suites; that is not a file count. The restricted Linux container smoke passed, including rejection of fake hardware. See [local checks](../deploy/near-private-research-20261109/local-checks.json) and [build verification](../deploy/near-private-research-20261109/app-verification.json). The isolated runner had no Git metadata; a separate [139-file comparison](../deploy/near-private-research-20261109/test-source-receipt.json) binds its retained application, tests, scripts and configuration to this source. GitHub checks identify the pushed revision separately in [STATUS](STATUS.md).

Use the [private research runbook](TEE-RUNBOOK.md#enable-private-research) for another run. Provision a finite reviewed deployment, verify fresh Neslos hardware, review any provider history/key/instance changes, run the free preflight, and set a budget that carries prior reservations forward. Keep owner keys local and journal/checkpoint backups intact. An expired approval or retired endpoint must not be revived by copying current observed hashes or resetting credit. Research works while the vault is paused; funded Confidential Intents settlement is separate unfinished work.
