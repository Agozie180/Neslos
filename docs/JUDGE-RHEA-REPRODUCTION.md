# Rhea evidence reproduction

This is the safe reproduction path for the funded Rhea testnet claim. It needs no wallet, credential file, test token or transaction approval, and it cannot mint, supply, withdraw or change account state.

## One-command verification

Use exactly Node 24.22.2 and the checked-in lockfile:

```sh
npm ci
npm run verify:rhea
```

The verifier reads [the sanitized evidence record](../deploy/rhea-funded-cycle-20261112/record.json) and makes read-only JSON-RPC requests to `https://rpc.testnet.near.org`. A successful result prints `"ok": true`, `"readOnly": true` and `"fullyReturned": true`.

It independently checks:

- the fixed testnet identities: `neslos.testnet`, `usdc.fakes.testnet` and Rhea's testnet contract;
- all five recorded transaction hashes are finalized successfully and signed by `neslos.testnet`;
- each receiver and method matches the retained flow: token storage, Rhea storage, mint, `ft_transfer_call` supply and Rhea `execute` withdrawal;
- the supply receipt records a 100,000-atomic-unit transfer and Rhea deposit;
- the withdrawal receipt records Rhea's successful withdrawal and the 100,000-atomic-unit transfer back to the owner;
- the three referenced snapshot blocks remain available;
- the retained plan hash and full-principal-return assertions are present.

If the public RPC is temporarily rate-limited, wait briefly and rerun the same command. An alternate compatible HTTPS NEAR testnet RPC can be selected without changing the record:

```sh
npm run verify:rhea -- --rpc https://YOUR_TESTNET_RPC
```

## Manual receipt review

The readable [funded-cycle report](RHEA-TESTNET-VALIDATION-2026-11-12.md#funded-cycle) links every transaction to NearBlocks. The two principal-bearing receipts are:

- [Supply 0.1 test USDC](https://testnet.nearblocks.io/txns/6Fsge4MMh4Y936XujgLo8N69xWouu7tgAbzDSJ4FGDRV)
- [Withdraw the position](https://testnet.nearblocks.io/txns/J8xQfmf8xxPMYMGauqz54XQkSUXB6jkXWfWWyAqCgm7x)

The retained snapshots show 1,000,000 wallet units before supply, 900,000 plus Rhea shares after supply, and 1,000,000 after withdrawal. The residual Rhea balance is below one underlying atomic unit and the record marks underlying residual principal as zero.

## Why the funded mutation is not repeated

The historical transaction receipts are immutable and reproducible without keys. Repeating mint/supply/withdraw against `neslos.testnet` would mutate owner state, consume testnet NEAR and create a second proof with different hashes. The repository therefore exposes read-only receipt verification instead of a funded replay command.

Any new funded cycle should use a fresh disposable testnet owner, a newly reviewed plan hash, bounded test-token amounts and its own journal/evidence directory. It must not reuse the retained hashes or be described as reproduction of the 12 November cycle.

This evidence proves a public owner-wallet Rhea testnet supply/withdrawal cycle. It does not prove vault custody, confidentiality, mainnet execution or profitable yield.
