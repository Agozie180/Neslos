# Confidential Intents settlement — 9 November 2026

**The owner-wallet mainnet round trip completed and returned its full principal. The native fee cap failed.** One native deposit of **0.001 NEAR** entered the owner's Confidential Intents balance; one signed withdrawal returned exactly **0.001 native NEAR** to the same wallet. Finalized NEAR receipts independently verify the return. Native charges were **0.0071149895375 NEAR**, exceeding the stated **0.004 NEAR** cap. The evidence retains `proofPassed: false`.

[Evidence index](../deploy/confidential-settlement-20261109/record.json) · [Settlement and costs](../deploy/confidential-settlement-20261109/result.json) · [Return receipt](../deploy/confidential-settlement-20261109/chain-return.json) · [Verification record](../deploy/confidential-settlement-20261109/verification.json)

## Observed result

| Check | Result |
| --- | --- |
| Funding | One finalized native Transfer of 0.001 NEAR to the validated quote's deposit address |
| Private credit | Signed `CONFIDENTIAL_INTENTS` route, provider `SUCCESS` and authenticated private wNEAR credit of exactly 0.001 |
| Withdrawal | One exact `raw_ed25519` spending payload, locally verified and persisted before submission; original owner as destination |
| Principal returned | Exactly 0.001 native NEAR; matching successful transfer receipt and wallet balance increase |
| Final private wNEAR | Empty through the unfiltered authenticated balance endpoint |
| Existing wrapped NEAR | Unchanged |
| Provider principal loss | Zero; both quoted refund and withdrawal fees were zero |
| Native fee cap | **Failed:** 0.0071149895375 NEAR charged; 0.0031149895375 NEAR above the stated cap |
| Other costs and scope | No TDX provisioning, paid inference, mainnet vault deployment or exchange trade |

Public transaction evidence:

- [Funding transaction](https://nearblocks.io/txns/4cYgdfMrJfrakjPpg45GNx1vMyAu2uaEAcba3Sbd5hjp)
- [Return transaction](https://nearblocks.io/txns/C4o7c1XW35uHmrSmffYGMHaEfxyJEFZ6qdAspqQmipJB), with successful owner-return receipt `3pvivhtJYB777jgyqjYToyHoNGRh2Le79wM1VAeEJxQ6`

Publishing both transaction hashes deliberately links this demonstration. The result establishes a working funding/withdrawal route, not unlinkability against observers of this published example.

## What failed and what changed

The funding estimate used the RPC gas price and an assumed gas allowance. It missed protocol account-creation charges. The [retained mainnet protocol configuration](../deploy/confidential-settlement-20261109/funding-protocol.json), version 88, includes an `account_creation_charge` of **0.007 NEAR** and a separate `min_gas_purchase_price`. Final receipt charges and the wallet debit agree on **0.0071149895375 NEAR**. A gas-price-only calculation did not enforce the promised limit.

The original cap was retained. Further deposits were disabled, and the existing principal was recovered using the single zero-fee withdrawal intent. No second owner-funded native transaction or replacement spending intent was created. The archive preserves the [funding runner](../deploy/confidential-settlement-20261109/funding-runner.ts.txt), [recovery runner](../deploy/confidential-settlement-20261109/recovery-runner.ts.txt) and both balance-reader versions. These are dated execution records, not a reusable funding CLI. Any future native-transfer preflight must account for current protocol charges and destination account creation before signing.

Two provider-response differences also surfaced:

- The status endpoint omits a per-request correlation ID and harmless request defaults, and represents three unused optional fields as `null`. Comparison now normalizes only those representations; the original quote digest and both signatures must verify, and every amount, fee, recipient, refund route, deadline and confidentiality field must match. This mismatch stopped before any funding signature.
- A single-token `tokenIds` query returned an empty balance while the documented unfiltered endpoint returned the funded wNEAR entry. The [balance reader](../src/owner/confidential-auth.ts) now reads the unfiltered endpoint, validates size, structure and unique token IDs, then selects wNEAR locally. The original filtered empty response cannot independently establish an empty pre-deposit private balance. Corrected reads verified the full current credit and final empty wNEAR balance.

The native funding method follows the official NEAR example: an `ORIGIN_CHAIN` quote for `nep141:wrap.near` is funded with native NEAR. The provider's asset identifier does not mean an `ft_transfer` deposit. The [pinned example](https://github.com/near-examples/near-intents-examples/blob/32247f923f1bed9a21b4ffdd98b7ce3541a58688/1click-example/3-send-deposit.ts) and its full-swap caller are retained with hashes.

## Verification and trust boundary

Before funding, 226 relevant tests, 46 focused offline checks and runner TypeScript checks passed. After the balance repair, **232 tests across five files passed with zero failures or skips**, along with runner and project TypeScript checks. Regression tests cover the omitted funded balance, unrelated assets, duplicate token IDs, public balances, malformed amounts and oversized responses. These counts identify the scoped run, not a new complete application/contract test run.

Quotes were checked with the pinned official SDK and bound to the locally approved route, amount, destination, refund and loss limit. The withdrawal signed the exact UTF-8 payload after validation. Signed bytes were journaled before submission; unknown outcomes would be observed through the saved operation rather than replaced. The final return was checked against `EXPERIMENTAL_tx_status` with `FINAL` execution and the exact successful native Transfer receipt to the owner.

Private ledger credit remains authenticated provider testimony over HTTPS. It is not an independently reproduced proof of the provider's internal ledger or confidential hardware. The SDK does not sign every quote field, including the standalone `confidentiality` flag; the signed `CONFIDENTIAL_INTENTS` route and local response binding matter. Raw quotes, account identity, balances and signed spending payloads remain private; the archive contains selected public chain identifiers, safe source snapshots and [commitments to retained private evidence](../deploy/confidential-settlement-20261109/private-evidence-commitments.json). Hashes identify bytes without proving their undisclosed contents.

This used the owner's local wallet and provider APIs. It did not exercise Neslos vault limits, attested runtime signing, autonomous research-to-payment execution or a lending position. Those integration boundaries remain separate from the completed provider round trip. The TDX server remains retired, and this proof added no hosting or inference charges.
