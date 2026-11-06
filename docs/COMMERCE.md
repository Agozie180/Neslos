# Owner commerce experiments

This CLI is a separate **public, owner-operated** integration for Rhea lending and NEAR Agent Market. It is not part of the attested payment path. It signs from the owner's mainnet account, uses a local lifetime allowance, and does not call the Neslos vault. Neither that allowance nor the full-access owner key is an on-chain sandbox.

Do not send private briefs to external agents through this CLI: the marketplace and the hired agent receive the brief. The Rhea supply and withdrawal transactions and positions are public. These adapters have automated tests; live read-only Rhea compatibility was checked on 5 November. No funded supply, withdrawal or external-agent job is established by those tests.

## Local policy

Store configuration below `.private/commerce/`. `policy.json` follows `commercePolicySchema` in `src/owner/commerce-budget.ts`:

- `format`: `neslos-commerce-policy-v1`; `network`: `mainnet`; `account`: the actual owner account.
- `totalLimitAtomic` and `perActionLimitAtomic`: integer native-USDC units, six decimals. Zero disables principal spending.
- `totalNativeLimitYocto`: separate local NEAR reservation for gas/storage; zero disables it.
- `allowedAgentHandles`: exact marketplace handles the owner permits. Every payment still requires approval of the exact quote hash and payee.
- `allowPublicLending`: explicit boolean; keep false unless public lending is intended.

Keep the policy, `commerce.json`, initialized marker and transaction files together. Do not create a fresh directory to retry an unresolved payment. The file lock intentionally survives an interrupted process: establish that no writer remains and inspect the original signed transaction before operational recovery. File integrity and backups are the owner's responsibility; this is not hostile-host rollback protection.

## Review before execution

```sh
npm run commerce -- status
npm run commerce -- position
npm run commerce -- plan-lending --operation supply --amount 100000 --out .private/commerce/supply-plan.json
```

Planning only reads public state and saves a plan. It requires the configured policy; no example account is substituted. Supply is a fixed non-collateral `ft_transfer_call`. Withdrawal is a fixed Rhea `Withdraw` action, refuses debt-bearing accounts and converts protocol decimals with integer arithmetic. Unsupported contract calls are rejected.

For agent research, put `{handle,messageId,brief}` in a private request file; `messageId` must be a UUID. `quote-agent --request FILE --maximum-amount ATOMIC_USDC --out FILE` sends the brief without payment and requires an explicit 402 challenge on the supported NEAR USDC rail. This request still discloses the brief to the service.

`submit` and `pay-agent` require `--plan`, the printed `--approve-hash`, `--credentials` and `--allow-mainnet`. Review the exact account, amount, payee and costs first. The CLI never assumes approval from a supplied API key or an old plan. Credential files must stay private.

Reservations precede signing/dispatch and remain charged on an uncertain outcome. A saved result is reused; re-entry never sends another payment. A pending delegated agent payment blocks conflicting wallet signatures until chain settlement or authorization expiry is observed. Expiry is not proof that the payment failed, and does not replenish allowance.

## Evidence and recovery

- `observe-transaction`: reconcile the original transaction and independently query the lending position. A successful FT receipt alone is not a yield-bearing position.
- `observe-agent`: retrieve the saved task's delivery state. Delivery is not payment proof.
- `settle-agent`: verify the exact signed delegate and successful native-USDC transfer against a supplied transaction hash and relayer.
- `expire-agent`: confirm a finalized block past the original delegate's expiry; do not assert nonpayment.

Provider task IDs, headers and status messages are not chain proofs. Funded validation, operational recovery and routing through a suitable on-chain/TEE policy remain unfinished. The current marketplace protocol delegates an owner-wallet transfer; it cannot be moved behind the existing vault just by changing the receiver address.

Sources: [Agent Market A2A+x402](https://docs.market.near.ai/a2a/hire-agent-using-x402.md), [Rhea lending SDK](https://github.com/rhea-finance/burrow-sdk-python), [privacy boundaries](PRIVACY.md).
