# Confidential Intents and testnet — 6 November 2026

> Historical research snapshot. The later [9 November owner-wallet Confidential Intents round trip](CONFIDENTIAL-SETTLEMENT-2026-11-09.md) returned full principal but exceeded its native fee cap. The no-spend observations and proposed next steps below describe this earlier review; funded TDX/mainnet-vault settlement remains unproved.

**A mainnet Neslos vault is not required for hackathon eligibility. The reviewed official sources do not offer a testnet deployment of the hosted NEAR Intents / Confidential Intents settlement service.** An independently deployed copy of the open-source verifier can demonstrate real contract execution with test tokens, but does not connect to the production confidential network.

This review fetched the live hackathon brief, Intents documentation and OpenAPI, current official examples, and pinned contract/solver sources. It performed public downloads only: no credentials, signatures, deposits, deployments or confidential-account queries. Raw captures and a source manifest are retained under `.local/confidential-testnet-research-20261106/`.

## What the hackathon actually requires

The current [HACKATHON.md](https://nearhackathon.com/HACKATHON.md) states:

| Rule | Exact relevant text |
| --- | --- |
| Q-007 | “Testnet for Intents? None exists or is planned. Mainnet, separate dev accounts, tiny amounts, dry: true quotes.” |
| Q-008 | “Testnet NEAR is free (near-cli faucet, near-faucet.io). Mainnet costs not reimbursed by default.” |
| Q-010 | “Testnet-only projects eligible? Yes, all tracks. Mainnet only where the integration is mainnet-only.” |
| Q-011 | “Mandatory integrations? None. Hints are hints. Own contract on NEAR that fits the track is enough.” |
| Q-012 | Local-only demos are allowed with a public repository, reproducible README and an X video; hosted demos are a plus. |

The [DeFi](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/01-defi.md) and [Privacy](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/03-privacy.md) prompts therefore do not impose a funded mainnet vault. The live brief takes precedence over prompt examples. Eligibility does not establish feature completion: the submission must still describe which actions were actually demonstrated.

## Hosted settlement: concrete deployment and API evidence

The official [Verifier Contract documentation](https://docs.near-intents.org/integration/verifier-contract/introduction.md#deployment) names `intents.near` and explicitly warns: **“There is no testnet deployment. Use small amounts for testing purposes.”**

The [Confidential Intents architecture](https://docs.near-intents.org/integration/market-makers/confidential-intents.md) describes a separate, permissioned network:

- Public NEAR uses `intents.near`.
- Private FAR uses `intents.far`, with a small validator set, no public networking and a private authenticated RPC.
- A Private PoA Bridge moves backing between a public treasury and private IMT balances. The documented production treasury account is `51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe`.
- The private relay URL and access come from the Defuse team. The [Confidential Example](https://docs.near-intents.org/integration/market-makers/confidential-example.md#configuration) calls the relay, contract, salt, treasury and 1Click base URL **production constants**. It publishes no testnet counterparts.

The live [1Click OpenAPI](https://1click.chaindefuser.com/docs/v0/openapi.yaml) declares one server, `https://1click.chaindefuser.com`. Its quote schema has no mainnet/testnet selector. [Token discovery](https://1click.chaindefuser.com/v0/tokens) returned 216 entries in this capture; none identified a testnet, devnet or Sepolia network. Its NEAR assets include `wrap.near` and the mainnet native-USDC contract. A token named `TESTNEBULA` also appears under a `.near` account: a test-like token name is not evidence of a testnet, free faucet or executable confidential route.

The supported confidential API paths are still this production service: [ordinary-chain deposits with `confidentiality`](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/confidential-swaps.md), or embedded `CONFIDENTIAL_INTENTS` balances using [signed-intent execution](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/signed-intent-execution.md). The latter documentation explicitly says there is no RPC path for confidential intents. Changing a NEAR RPC URL, account suffix, token ID or SDK base URL does not provision the corresponding treasury, bridge, liquidity and FAR deployment.

This establishes the documented supported route, not the nonexistence of every internal provider environment. No public supported confidential testnet endpoint or deployment was found in the reviewed sources. An undisclosed staging environment would require explicit provider documentation/access before relying on it.

## What the open-source contracts can do independently

The pinned [near/intents README](https://github.com/near/intents/blob/32cd1f9788a347908164fbcc56525dc6542f158f/README.md) says the verifier “can be used independently without needing anything else,” and documents release artifacts, reproducible builds and integration tests. At that revision:

- The [test environment](https://github.com/near/intents/blob/32cd1f9788a347908164fbcc56525dc6542f158f/tests/src/tests/defuse/env/builder.rs#L120) deploys the verifier with a chosen account, wrapped-token contract, fees and roles.
- The [P2P swap test](https://github.com/near/intents/blob/32cd1f9788a347908164fbcc56525dc6542f158f/tests/src/tests/defuse/intents/token_diff.rs#L26) uses actual sandbox contracts and two locally created tokens. This is a basis for testing authentic verifier execution, rather than inventing a successful provider response.
- A [FAR build variant](https://github.com/near/intents/blob/32cd1f9788a347908164fbcc56525dc6542f158f/contracts/defuse/Cargo.toml#L103) exists. Building that WASM does not create a private chain, bridge or hosted confidential backend.

An independent testnet verifier is therefore a plausible engineering option, using faucet NEAR and test-token liquidity supplied by the demo participants. This review did not build or deploy it and does not certify current testnet compatibility. Such a deployment would have its own account, state, keys and liquidity. A verifier on public NEAR testnet executes publicly; its swaps are not private merely because the code also supports FAR.

Two apparent counterexamples do not change that conclusion. The same repository lists [testnet Global Deployer instances](https://github.com/near/intents/blob/32cd1f9788a347908164fbcc56525dc6542f158f/contracts/global-deployer/README.md#deployed-instances), including `0s29e346108955b88c2d180a4ba17662b1f2cc1028`; those are generic deployment components, not a testnet hosted Intents service. The provider-linked solver has a [testnet NEAR RPC configuration](https://github.com/hairy-pointer/near-intents-amm-solver/blob/82866c5aa1313b2e82c76c10cb45009db8e4a845/src/configs/near.config.ts), but its [private relay/contract configuration](https://github.com/hairy-pointer/near-intents-amm-solver/blob/82866c5aa1313b2e82c76c10cb45009db8e4a845/src/configs/private-intents.config.ts) is separate; an RPC enum is not a confidential deployment.

## Options that preserve the budget

| Option | Real cost and evidence |
| --- | --- |
| Keep the existing Neslos testnet proof | Faucet-funded contract execution already proves the vault payment, daily cap and replay protection. It does not prove Confidential Intents settlement. Valid hackathon scope under Q-010/Q-011. |
| Obtain production `dry: true` quotes | No funded transaction. The [quote schema](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote.md) says dry responses omit `depositAddress`, `timeWhenInactive` and `deadline`. A verified response can prove quoting, routing and signature validation, never payment or settlement. Confidential endpoint authentication must still work. |
| Exercise the upstream verifier locally, then optionally on a self-managed testnet account | No purchased mainnet principal; faucet NEAR for public testnet. Can prove real signed-intent matching, rejection, transfer and withdrawal in that independent environment. Requires implementation and verification; it does not prove production FAR privacy, bridge operation or hosted liquidity. |
| Use public-verifier `simulate_intents` where applicable | The [documented view method](https://docs.near-intents.org/integration/verifier-contract/simulating-intents.md) does not change state and excludes external asynchronous side effects. It requires applicable signed inputs and state; it is not a confidential simulator or a funded settlement receipt. |
| Later, make a tiny owner-wallet production confidential transfer | The official [ordinary-chain flow](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/confidential-swaps.md) can use an existing wallet without deploying a new Neslos mainnet vault. It still needs real supported assets, viable quotes, fees, gas/storage where applicable, and a working recovery path. It would prove provider integration from that wallet, not enforcement by a Neslos mainnet vault. No such spend is authorized or performed by this research. |

There is no documented zero-cost funded production settlement in these sources. Example amounts, including the official [example repository's](https://github.com/near-examples/near-intents-examples/blob/32247f923f1bed9a21b4ffdd98b7ce3541a58688/README.md) `0.01 NEAR` default, are not guaranteed route minima or total costs. Generic fee statements also differ between examples and the live brief; actual quotes and current API permissions must determine any future budget.

For a zero-mainnet-spend delivery, retain the testnet vault evidence, add successful no-spend provider evidence only where actually obtained, and label the missing hosted confidential settlement explicitly. Self-managed verifier tests can deepen the contract demonstration without representing a custom network as the provider's service.
