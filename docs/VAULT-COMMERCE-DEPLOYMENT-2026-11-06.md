# Vault commerce deployment — 6 November 2026

> This report is scoped to the historical fixture-token vault deployment. A later [funded public owner-wallet Rhea cycle](RHEA-TESTNET-VALIDATION-2026-11-12.md) completed separately and does not change this vault proof's custody or asset boundary.

The existing `vault.neslos.testnet` was upgraded in place. Its sole retained owner key authorized one `DeployContract` action. Downloaded code matched the reviewed WASM, and the full raw storage fingerprint and configuration were identical before and after deployment. No initializer, migration, new vault account or balance transfer was part of that upgrade.

| Evidence | Result |
| --- | --- |
| [Vault upgrade](https://testnet.nearblocks.io/txns/F2vC28Bm87xBSMVQKR2oyf5DBdFaAgPAvY9zuKzJYpjg) | 241,465-byte WASM; SHA-256 `545e140a2f452f609ba55b5623d1d48994bde32335c0a7fc05acd644e7cf8aa0` |
| [Fixture-token upgrade](https://testnet.nearblocks.io/txns/6kiRbYFBpyzV1VqTfNfoEkA64KxdBLBEoey9RmsoBeRE) | Adds standard NEP-141 transfer events; balances/raw state unchanged; SHA-256 `45365f13a0bd8778e92727d98e0b7e71502dd31db72a2709966730abb2443545` |
| [Verified vault payment](https://testnet.nearblocks.io/txns/AtQ8joUuaVkeZsukPj6HLTaE5qj7ApMBFyNTJ3mWLNgX) | 1,000,000 atomic fixture units transferred from vault to owner; exact call, token event and successful callback verified |
| [Daily-limit rejection](https://testnet.nearblocks.io/txns/2MYWSFeJPo5zs3oRGnKx1UM186Tu52gskNG74NwNsgnN) | Another 1,000,000-unit payment rejected with `DAILY_LIMIT` |
| [Replay rejection](https://testnet.nearblocks.io/txns/HkWPdR8g1KRRKtFZxwqNCcFcYir9ZdHdSb9YXYruH3JK) | Original request rejected with `NONCE` |
| [Policy restored and paused](https://testnet.nearblocks.io/txns/CaH1LFeJF1BTnvSuhwBM4JtvrM6KxxwYP4Cu3Aqpc1r7) | Original 500,000,000/day and 200,000,000/action limits restored; existing consumption retained |

The proof began with 60,000,000 units already consumed that UTC day. It temporarily set the daily cap to 61,500,000 and the action cap to 1,000,000. The allowed payment raised consumption to 61,000,000, leaving only 500,000 under that temporary policy. The next request was individually within the action cap but exceeded the remaining daily allowance. After restoration, the vault was paused at policy version 9, nonce 4, with 61,000,000 used and 739,000,000 fixture units held.

The earlier [60,000,000-unit payment](https://testnet.nearblocks.io/txns/5bhse4i4o6h58QUzfTpusriVT8E1psquiP8soes4APeK) succeeded on chain, but the strict client refused to claim settlement because the original minimal fixture omitted NEP-141 logs. The fixture was corrected; that payment was not repeated. The new proof uses the same strict production receipt verifier. These are test tokens, not dollars or mainnet assets.

Machine-readable records: [vault upgrade](../deploy/testnet-upgrade-20261106.json), [token upgrade](../deploy/testnet-token-upgrade-20261106.json), [commerce proof](../deploy/testnet-commerce-proof-20261106.json). The retained original deployment/proof files describe the earlier code and remain historical evidence.

## Enforcement and validation

`execute_commerce_v1` shares the private authorization path's usage map and monotonic nonce. It binds owner, network, vault, policy version, action, exact amount, expiry, target and salt openings. It cannot supply arbitrary methods or FT payloads. Confidential-only policies reject this public path. Fixed Rhea reads check protocol configuration and debt before dispatch; a changed policy, expired quote or UTC-day rollover cancels before dispatch and releases only the original reservation. Ambiguous/partial protocol outcomes retain quota. Withdrawals return to the vault and never replenish allowance.

The contract checks passed 25 unit tests and both local NEAR sandbox suites. Tests include actual old-state deserialization, mixing private/owner budget use, midnight cancellation, policy changes during asynchronous reads, replay, failures and withdrawals. The event-enabled fixture also passed the original receipt suite with exact transfer-event assertions. Reproduce with `npm run test:contract`; client/build checks use `npm run verify`.

This deployment proves public testnet enforcement. It does not prove a mainnet vault, funded Rhea position, marketplace payment, confidential settlement, paid inference response or Neslos TDX execution. The [TDX provider restriction](TDX-DEPLOYMENT-STATUS.md), [inference approval gap](INFERENCE-LIVE-REVIEW-2026-11-06.md), and [partner authentication requirement](CONFIDENTIAL-AUTH.md) remain explicit.
