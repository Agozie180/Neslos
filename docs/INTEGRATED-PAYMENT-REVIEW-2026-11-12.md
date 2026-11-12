# Integrated private payment review — 12 November 2026

The existing records prove the three major components separately, but they do not prove one complete private research → vault dispatch → confidential settlement payment.

| Component | Existing proof | Binding limit |
| --- | --- | --- |
| Private research | Three signed researchers completed inside independently verified TDX; encrypted audit, restart and budget rejection passed | The retained research record explicitly sets `fundedSettlement: false`; the testnet vault was restored without a payment |
| Vault payment enforcement | `vault.neslos.testnet` executed real fixture-token payments and rejected limit/replay violations | This is public testnet execution using `token.neslos.testnet`, not a Confidential Intents settlement |
| Public Rhea lending | `neslos.testnet` supplied and withdrew 0.1 Rhea-listed fake USDC with full principal returned | This is a separate public owner-wallet cycle; it used neither the vault nor the private research request |
| Confidential settlement | The owner-wallet 0.001 NEAR round trip returned full principal with a finalized return receipt | It used no TDX and no Neslos vault, and its native fee cap failed |

A single integrated proof would need the same request and authorization identity to bind research output, a vault-enforced dispatch and the observed settlement. No retained record has that shared identity. The current private `prepare` command requires mainnet because 1Click has no testnet, while the deployed Neslos vault is on testnet and fixed to a fixture token. Neslos has no deployed mainnet vault in the retained evidence.

The later funded Rhea cycle closed the standalone public-lending execution gap but did not close this review's binding gap. Repeating completed component proofs would not bind them into one payment. A future integrated run would require a separately reviewed mainnet vault/asset/cost plan or a purpose-built testnet settlement adapter that is clearly labelled as non-Intents.

Sources: [private research record](../deploy/near-private-research-20261109/record.json), [testnet vault commerce proof](VAULT-COMMERCE-DEPLOYMENT-2026-11-06.md), [funded Rhea cycle](../deploy/rhea-funded-cycle-20261112/record.json), and [owner-wallet settlement result](../deploy/confidential-settlement-20261109/result.json).
