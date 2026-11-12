# Funded Rhea testnet cycle and root-cause audit — 12 November 2026

A funded public Rhea supply/withdrawal cycle completed from `neslos.testnet` in Ubuntu WSL. The owner registered with `usdc.fakes.testnet` and Rhea, minted 1 test USDC, supplied 0.1 USDC, observed new Rhea shares, withdrew the observed position and recovered the full 0.1-USDC principal. This proves owner-wallet testnet protocol execution. It does not prove vault custody, confidentiality, mainnet execution or profitable yield.

## Root cause

The earlier failure was not one missing method. It came from conflating two deployments with different purposes:

1. Commit `7e35bcf` introduced `contracts/test-token` as a “deliberately minimal local test fixture” for sandbox cross-contract receipts.
2. Commit `8d2db21` deployed that fixture as `token.neslos.testnet` and initialized `vault.neslos.testnet` with the token ID permanently stored in vault state. The deployment plan explicitly described a public fixture-token contract demonstration.
3. Rhea commerce was added later in commits `77f3c7f`/`6e0b34c`. The existing vault was upgraded in place, preserving its original fixed token. No migration created a Rhea-compatible vault or changed the token.
4. The first funded-cycle attempt incorrectly used that fixture vault even though the requested identity was the `neslos.testnet` owner wallet.
5. The client read Rhea `get_asset` but did not validate its `null` value before starting token reads. The later missing `ft_metadata` call therefore masked the primary failure.

The live WSL audit confirmed every layer:

- Rhea testnet listed 17 assets, including `usdc.fakes.testnet`, but returned `null` for `token.neslos.testnet`.
- Rhea's configured owner is `ref-finance.sputnikv2.testnet`. Published contract source makes `add_asset` owner-only; `neslos.testnet` has no role in that DAO policy.
- `token.neslos.testnet` exports `ft_balance_of` and `ft_transfer`, but lacks `ft_metadata`, `ft_transfer_call`, resolver behavior and storage management.
- `vault.neslos.testnet` fixes `token_id` at initialization and exposes no token setter. Its current policy and output asset also bind the fixture token.
- Before the successful cycle, neither `neslos.testnet` nor the vault was registered with Rhea; the owner also lacked supported-USDC storage registration and had a zero supported-USDC balance.

The foundational defect was therefore a scope-extension/migration failure: a sandbox fixture deployment was reused as though it were a protocol integration. Upgrading only the fixture token would still not list it in Rhea, and listing it would require external Rhea governance.

## Fixes

The lending preflight now:

- validates a non-null, schema-valid Rhea asset before any token read;
- inspects deployed token exports at the same finalized block;
- distinguishes unsupported assets, missing metadata and missing transfer-call support;
- stops before plan creation or signing on incompatibility.

Regression tests cover the unsupported-asset and token-interface branches. The original fixture-vault position command now returns `LENDING_ASSET_UNSUPPORTED` instead of an ambiguous RPC method error.

The funded validation used the correct route instead of mutating the historical fixture deployment: `neslos.testnet` directly supplied a Rhea-listed test token. The exact plan was hash-bound as `ea6f8ad054013853928d363de13fc62df96124202bf447280fc047cc634ec21d`, and every signed transaction was journaled before broadcast.

## Judge-safe reproduction

Run `npm run verify:rhea` from the repository root. It needs no credentials and performs only read-only NEAR testnet RPC calls. It validates every recorded hash, signer, receiver, method, supply/withdrawal receipt log, referenced block and the full-principal-return record. See the [short judge guide](JUDGE-RHEA-REPRODUCTION.md) for setup, expected output, manual explorer links and the reason a funded mutation is intentionally not exposed as a judge command.

## Funded cycle

| Step | Finalized transaction |
| --- | --- |
| Register `neslos.testnet` with test USDC | [`46uuTmmX6s7e5AEJYdVCjVbHRt9C56LdpgFP3TwLJ8db`](https://testnet.nearblocks.io/txns/46uuTmmX6s7e5AEJYdVCjVbHRt9C56LdpgFP3TwLJ8db) |
| Register `neslos.testnet` with Rhea | [`EuWwX4KfJo8o5rPve11XLJx7pXTJ8EyNdWu6AbvXGJ3Q`](https://testnet.nearblocks.io/txns/EuWwX4KfJo8o5rPve11XLJx7pXTJ8EyNdWu6AbvXGJ3Q) |
| Mint 1 test USDC | [`3NYPeacjgocdmN2BaAT5mwdXth8F6ZsYrJWSVLgV6HXm`](https://testnet.nearblocks.io/txns/3NYPeacjgocdmN2BaAT5mwdXth8F6ZsYrJWSVLgV6HXm) |
| Supply 0.1 test USDC | [`6Fsge4MMh4Y936XujgLo8N69xWouu7tgAbzDSJ4FGDRV`](https://testnet.nearblocks.io/txns/6Fsge4MMh4Y936XujgLo8N69xWouu7tgAbzDSJ4FGDRV) |
| Withdraw the observed position | [`J8xQfmf8xxPMYMGauqz54XQkSUXB6jkXWfWWyAqCgm7x`](https://testnet.nearblocks.io/txns/J8xQfmf8xxPMYMGauqz54XQkSUXB6jkXWfWWyAqCgm7x) |

At block `277375738`, the wallet held `1000000` atomic units and had no supplied shares. At block `277375768`, the wallet held `900000`; Rhea reported `7265160304104410` shares and protocol balance `100000030289635349`. The supply resolver returned `100000`, proving full acceptance.

The withdrawal receipt transferred `100000` atomic units from Rhea back to `neslos.testnet`. At block `277375798`, the wallet was back to `1000000`. Rhea retained `37245765755` protocol precision units—less than one underlying atomic unit—because interest updated between observation and execution. The principal is fully returned; the remaining shares represent non-withdrawable sub-atomic dust, not missing principal.

Registration plus gas cost `0.104464039660835000000002` testnet NEAR. The sanitized evidence record is [record.json](../deploy/rhea-funded-cycle-20261112/record.json).

## Boundary

The existing fixture vault remains intentionally unchanged, paused at policy version 13 with its fixture token and prior balance. A future vault-custodied Rhea proof should deploy a separate vault fixed from initialization to a Rhea-supported token, register that vault with both contracts and fund it with that token. Retrofitting the historical fixture vault would require a new reviewed state migration and is not necessary to prove owner-wallet Rhea compatibility.
