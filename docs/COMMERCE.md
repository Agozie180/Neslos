# Vault commerce

The v2 owner CLI sends principal-bearing operations to `execute_commerce_v1` on the configured Neslos vault. The vault transfers its own fixed token and enforces its existing daily/per-action limits, nonce, policy version, venue/counterparty commitments, output asset and pause state. Public Rhea supply and withdrawal use the vault's lending account. Principal authority no longer comes from an owner-wallet lifetime allowance.

This remains **public, owner-operated execution**, separate from the attested private runtime. Every public payment or lending operation is rejected when the on-chain policy requires confidentiality. Transactions, opened venue/counterparty commitments and lending positions are public. The owner signs governance/commerce transactions and pays native NEAR costs; it does not supply the token principal from its wallet.

The implementation has automated client and contract checks. These establish neither a funded Rhea position nor a paid marketplace job. Check the dated deployment/proof records for which compiled artifact and transactions were actually verified. The fixture token in the existing testnet vault is not native USDC and is not evidence of Rhea support.

## V2 configuration

Store new configuration and its journal in a private directory such as `.private/vault-commerce/`. The schema is `vaultCommercePolicySchema` in [commerce-budget.ts](../src/owner/commerce-budget.ts). This template requires the real owner-approved salt openings from the policy's private configuration:

```json
{
  "format": "neslos-commerce-policy-v2",
  "network": "testnet",
  "account": "neslos.testnet",
  "vault": "vault.neslos.testnet",
  "totalNativeLimitYocto": "1000000000000000000000000",
  "allowPublicLending": false,
  "allowedAgentHandles": [],
  "openings": [
    {
      "venue": "testnet-direct-transfer",
      "target": "neslos.testnet",
      "venueSalt": "REPLACE_WITH_APPROVED_64_HEX_VENUE_SALT",
      "counterpartySalt": "REPLACE_WITH_APPROVED_64_HEX_COUNTERPARTY_SALT"
    }
  ]
}
```

`account` is the owner; `vault` holds principal. `network` accepts `testnet` or `mainnet`. There are no local principal-limit fields: the token and limits are read from the vault. `totalNativeLimitYocto` is a separate local lifetime reservation for the owner's gas/storage expense, not an on-chain native-NEAR limit. Each commerce transaction reserves 0.1 NEAR for gas plus its attached deposit; `execute_commerce_v1` attaches 0.01 NEAR and 300 Tgas. Storage registration has its own quoted deposit. This local journal still relies on trusted storage for freshness.

Each `openings` row names the exact `venue` and `target`; its two 32-byte hexadecimal salts must open commitments already permitted by the on-chain policy. A local row cannot enlarge that allowlist. For Rhea, use venue `rhea` and target `contract.main.burrow.near` on mainnet or `contract.1689937928.burrow.testnet` on testnet, enable `allowPublicLending`, and confirm the vault's fixed token is supported there. The contract reads Rhea's own conversion metadata and debt state before dispatch. Neither this CLI nor the Rhea path can choose a new vault token or submit arbitrary contract arguments.

## Plan, review, submit, observe

Use the same `--policy` and `--directory` options for every command. These examples use the configuration above:

```sh
npm run commerce -- status --policy .private/vault-commerce/policy.json --directory .private/vault-commerce
npm run commerce -- plan-payment --policy .private/vault-commerce/policy.json --directory .private/vault-commerce --target neslos.testnet --venue testnet-direct-transfer --amount 1000000 --out .private/vault-commerce/payment-plan.json
```

Planning reads public state and saves an exact plan; it does not sign. The example amount is one six-decimal **fixture token**, not a dollar. A paused vault or confidential policy blocks the payment plan. Commerce does not unpause or edit the owner's policy. Review the saved network, owner, vault, fixed token, target, amount, nonce/version, native costs and printed approval hash.

```sh
npm run commerce -- submit --policy .private/vault-commerce/policy.json --directory .private/vault-commerce --plan .private/vault-commerce/payment-plan.json --approve-hash EXACT_PRINTED_HASH --credentials /private/neslos.testnet.json
npm run commerce -- observe-transaction --policy .private/vault-commerce/policy.json --directory .private/vault-commerce --id SAVED_OPERATION_UUID --credentials /private/neslos.testnet.json --out .private/vault-commerce/payment-observation.json
```

Mainnet signing additionally requires `--allow-mainnet`. Plans have short expiries and signing rechecks the chain state. If an unsigned plan expires, prepare and review new terms. If an operation has been reserved or signed, recover its original journal instead of replacing it.

For a compatible public lending vault, the corresponding commands are `position`, `plan-storage --contract token`, `plan-storage --contract rhea`, and `plan-lending --operation supply|withdraw --amount ATOMIC_UNITS --out FILE`. Storage calls register the **vault**, even though the owner pays their NEAR deposit. Rhea supply is a fixed, empty-message, non-collateral `ft_transfer_call`; withdrawal is a fixed `Withdraw` action returning tokens to the vault. Debt-bearing positions are refused. Withdrawals consume the requested on-chain allowance and do not refill it.

`transactionSuccess` reports NEAR transaction execution, not settlement. Observation checks the exact owner-to-vault call, the final vault callback and a successful transfer event from the fixed-token contract. Supply also needs full acceptance by the token resolver; lending settlement separately requires a newer vault-position share change. A provider task state or successful dispatch alone cannot prove a yield-bearing position.

## Agent Market rail is blocked

The current official [A2A+x402 protocol](https://docs.market.near.ai/a2a/hire-agent-using-x402.md) requires a signed delegated `ft_transfer` from a wallet to the quoted USDC treasury. The marketplace holds that authorization until delivery. It documents no vault-call or prior vault-transfer proof rail. Replacing the delegate's receiver or paying the treasury independently would not implement that protocol.

`pay-agent` therefore rejects before loading credentials, reserving credit, signing or dispatching. Generic `plan-payment` is not a marketplace hire/payment integration. There is no paid-job claim.

`quote-agent --request FILE --maximum-amount ATOMIC_USDC --out FILE` may obtain terms for an explicitly allowed handle under a public vault policy. The request file is `{handle,messageId,brief}`, with a UUID `messageId`. This sends the brief to the marketplace and agent; do not put private material in it. Quoting returns `vaultPaymentSupported:false` and does not authorize payment.

## Journal recovery and historical v1 operations

Keep the policy, `commerce.json`, initialized marker and transaction files together. Missing initialized history is an error. The exclusive file lock survives an interrupted process; establish that no writer remains and inspect the original signed transaction before recovering it. A new directory is not a payment-retry procedure.

V1 owner-wallet configurations and saved plans are **recovery-only**. New v2 journals bind owner, network and vault and cannot reinterpret an old owner-wallet journal. Before beginning new operations with a signer previously used for v1 delegates, reconcile its outstanding authorizations. Preserve the old directory for:

- `observe-transaction`: observe the original v1 or v2 transaction without signing a replacement.
- `observe-agent`: retrieve a historically saved task's delivery state.
- `settle-agent`: verify the original v1 signed delegate and exact USDC transfer against a transaction hash and relayer.
- `expire-agent`: observe a finalized block beyond the v1 delegate expiry. Expiry does not prove nonpayment or refill its old allowance.

V2 principal limits survive local journal rollback because they are enforced by the vault. Native-cost accounting and local workflow history do not gain hostile-host rollback protection from that fact. Confirmed direct-payment failure and cancellation before a Rhea dispatch can release the original day's on-chain reservation; ambiguous/partial Rhea outcomes retain it. Never infer a refund from an HTTP error or missing reply.

## Upgrade the existing testnet vault safely

The dedicated [upgrade CLI](../scripts/upgrade.ts) is fixed to `neslos.testnet` and `vault.neslos.testnet`. It requires a paused vault and the sole expected FullAccess key. It pins the old and new code hashes, complete raw contract-state fingerprint and `get_config` response. The transaction is exactly one `DeployContract`, signed as the vault using that existing owner's signer; it contains no initializer, migration, transfer or policy change.

Run with Node 24.22.2 and the reviewed artifact:

```sh
node --import tsx scripts/upgrade.ts inspect --credentials /private/neslos.testnet.json
node --import tsx scripts/upgrade.ts plan --credentials /private/neslos.testnet.json --wasm artifacts/policy_vault.wasm --out .private/testnet/upgrade-plan.json
node --import tsx scripts/upgrade.ts execute --credentials /private/neslos.testnet.json --wasm artifacts/policy_vault.wasm --plan .private/testnet/upgrade-plan.json --approve-hash EXACT_PRINTED_HASH --journal-dir .private/testnet/upgrade-transactions --out .private/testnet/upgrade-proof.json
```

`plan` and `inspect` are read-only. Review the exact hash before `execute`. The default expected old SHA-256 is the historical `196460a40676c7901143a9adf63ce61f63e25bf862e0acb4d9d51ff491e32b73`; a different installed artifact requires its own reviewed `--expected-old-sha256`. The upgrade rechecks state before signing, then verifies the downloaded code and unchanged configuration/raw storage afterward. The NEAR deployment action itself is unconditional: these checks assume exclusive, trusted control of the one owner key during execution.

Retain the plan, exact WASM and transaction journal. Repeating the same approved operation observes the saved hash even when the code is already upgraded. New code without the corresponding journal is refused instead of being deployed again. If the upgrade succeeded but an observation/output step failed, use the same plan and journal; do not initialize the vault or create a new deployment.

Sources: [Rhea SDK](https://github.com/rhea-finance/burrow-sdk-python), [Agent Market protocol](https://docs.market.near.ai/a2a/hire-agent-using-x402.md), [privacy boundaries](PRIVACY.md), [current TDX deployment blocker](TDX-DEPLOYMENT-STATUS.md).
