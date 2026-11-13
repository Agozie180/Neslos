# Hackathon research

Project status was updated on 12 November 2026; the live event's deadline, publication and eligibility requirements were last checked on 9 November. Read the [live brief](https://nearhackathon.com/HACKATHON.md) again before submission; the latest retained full copy is in [sources](sources/HACKATHON-2026-11-06.md). See [current status](STATUS.md), [private research proof](NEAR-PRIVATE-RESEARCH-2026-11-09.md), [funded Rhea cycle](RHEA-TESTNET-VALIDATION-2026-11-12.md), [funded owner-wallet settlement](CONFIDENTIAL-SETTLEMENT-2026-11-09.md) and [testnet/Confidential Intents research](CONFIDENTIAL-TESTNET-RESEARCH-2026-11-06.md) for dated evidence.

## Verified event facts

- NEAR HACKATHON runs 1–14 November 2026. Deadline: **14 November 23:59 UTC**, or **15 November 00:59 Lagos time**.
- Judging starts 16 November; results by 18 November 23:59 UTC.
- $250,000 total: $55,000 overall grand prize and $10,000 / $3,000 / $2,000 in each of thirteen tracks. USD amounts paid in NEAR.
- No registration is required to start. Public repo + human-published public X demo are required before the one final submission per project.
- Work since the 19 October announcement qualifies; older baselines and reused libraries must be disclosed. AI-assisted work is allowed.
- Testnet-only work is eligible in every track, and no named integration is mandatory. **Hosted NEAR Intents / Confidential Intents has no supported testnet.** Mainnet `dry: true` quotes require no funded transaction; an independently deployed verifier is a separate environment, not the hosted confidential service.
- A local-only demo is eligible with reproducible instructions and a video. Hosted demos should remain available through 18 November, ideally 25 November. Neslos uses its public Vercel rehearsal for that access; the private TDX proof is archived after a finite verification session. Continuous paid TDX hosting is outside the operating plan.
- Humans decide awards. Claude Code and Codex screen reproducibility and feature claims.
- Submission requires the human's actual team/contact/payout information, chosen tracks, links, consent and approval of the exact final payload. No placeholders or invented account.

The site publishes **no weighted rubric**. Its FAQ says: "Claude Code & Codex screen every project first: they check that it runs and does what the README says. The human judges above make the decisions. Previous NEAR hackathons evaluated technical implementation, design, impact, originality and sustainability — a good guide to prepare by." We do not invent weights.

The roughly **2.4 NEAR** estimate concerns code-storage stake for an optional mainnet Neslos vault, before state and gas costs. It is neither an eligibility requirement nor a Confidential Intents settlement fee. Existing-wallet production integration can avoid deploying that vault but still requires real supported assets and fees; it would not prove Neslos vault enforcement. [Sources and no-mainnet-spend alternatives](CONFIDENTIAL-TESTNET-RESEARCH-2026-11-06.md).

All track IDs: defi, thesis, privacy, business, swarms, security, agents, realworld, games, nfts, memecoins, social, open.

## Track fit and evidence

| Track | How Neslos fits | Current evidence and scope |
| --- | --- | --- |
| **Security** (`security`) | Neslos constrains agent spending with on-chain budget enforcement, signed authorizations and replay protection in its NEAR vault. | [Public testnet enforcement](VAULT-COMMERCE-DEPLOYMENT-2026-11-06.md), adversarial tests and retained-transaction recovery |
| **Privacy** (`privacy`) | Neslos protects research with attested TDX and encrypted inference, and separately demonstrates an owner-wallet Confidential Intents round trip. | [TDX research](NEAR-PRIVATE-RESEARCH-2026-11-09.md) under disclosed provider-administration trust; [full principal return](CONFIDENTIAL-SETTLEMENT-2026-11-09.md) with a failed native fee cap; integrated TDX/vault settlement remains unproved |
| **DeFi** (`defi`) | Neslos analyzes live Rhea lending markets for yield, liquidity and risk to produce allocation proposals governed by the owner's treasury policy. | [Live market research](NEAR-PRIVATE-RESEARCH-2026-11-09.md), [deterministic eligibility/ranking](../src/core/research.ts) and a separate [funded public owner-wallet testnet cycle](RHEA-TESTNET-VALIDATION-2026-11-12.md) |
| **Swarms** (`swarms`) | Neslos coordinates three specialist researchers, a strategist and a deterministic guardian under one shared treasury policy, with research findings able to veto or narrow a proposal. | [Three signed researcher reports](NEAR-PRIVATE-RESEARCH-2026-11-09.md) and [strategy constraints](../src/core/strategy.ts); the guardian retains deterministic control |

## Sources studied

| Source | Finding |
| --- | --- |
| [Official website](https://nearhackathon.com/) and [HACKATHON.md](https://nearhackathon.com/HACKATHON.md) | Event facts, publication rules and final submission contract |
| [Official starter prompts](https://github.com/nearai/near-hackathon-prompt-examples) | Read setup, DeFi, Privacy, Swarms, Security, Agent Economy and submission guide. The live brief takes precedence over outdated example wording. |
| C:/Users/USER/skill-md-repo/SKILL.md | Hackathon-Winning Playbook v2: spec before code, thesis enforced by tests, measured claims, guardrail demo, reproducibility and limitations |
| [NEAR agent skills](https://github.com/near/agent-skills) | Read contract, private inference and Intents skills. Use official contract scaffold, current APIs, exact asset IDs and private callbacks. |
| [Rhea SDK documentation](https://github.com/rhea-finance/rhea-sdk-docs) | Lending and DEX integration are distinct. Official lending SDK is burrow-sdk-python. |
| [Lending API docs](https://github.com/rhea-finance/burrow-sdk-python) | Production host https://lendingsdk.rhea.finance; /list_token_data supplies APY, base/reward components, TVL and liquidity. |
| [Live Rhea feed](https://lendingsdk.rhea.finance/list_token_data) | Successfully returned 18 markets during research. Fetch time does not establish upstream observation time. |
| [Confidential swaps](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/confidential-swaps.md) | Standard quote confidentiality is basic or advanced. Embedded private balances need signed intents. Entry/exit transactions remain public. |
| [Hosted service versus independent verifier research](CONFIDENTIAL-TESTNET-RESEARCH-2026-11-06.md) | Official docs explicitly exclude a hosted testnet; source contracts support independent testing. Testnet RPC options and generic deployer instances do not establish a FAR testnet. |
| [1Click integration](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request.md) and [pinned native-deposit example](https://github.com/near-examples/near-intents-examples/blob/32247f923f1bed9a21b4ffdd98b7ce3541a58688/1click-example/3-send-deposit.ts) | Discover asset IDs, bind the refund destination and route, validate minima and observe terminal status. The tested `ORIGIN_CHAIN` route for `nep141:wrap.near` takes native NEAR; its asset identifier does not imply an `ft_transfer` deposit. |
| [NEAR AI SDK](https://docs.near.ai/cloud/inference-sdk/javascript.md) | E2EE is opt-in; verifyResponse is explicit; both gateway and model need strict TCB policies. The pinned 0.3.0 release requires Node >=24.22.1; the project uses Node 24.22.2. |
| [NEAR AI verification](https://docs.near.ai/cloud/verification/index.md) | Merely fetching a report is not verifying nonce, hardware chain, measurements, signer and exact response bytes. |
| [OutLayer](https://github.com/out-layer/outlayer) and [custody skill](https://skills.outlayer.ai/agent-custody/SKILL.md) | TDX custody/compute, separate mainnet/testnet API hosts. Hosted Intents remains mainnet-only. Its wallet policy is not automatically a Neslos on-chain cap. |
| [dstack SDK](https://github.com/Dstack-TEE/dstack/tree/master/sdk/js) | Main branch documented v1 while npm latest was 0.5.8. Use the pinned published interface and quote-backed measurements. |
| [DCAP verifier](https://github.com/Phala-Network/dcap-qvl/tree/master/dcap-qvl-js) | JavaScript can verify Intel signatures, TCB, report data and TDX measurements. Simulator evidence must fail. |

Q-006 in the event brief quotes 0.2% without a 1Click JWT, while the current API skill states 0.25%. The app uses actual quote amounts and current API documentation instead of assuming a constant fee.

## Integration observations after implementation

The Rhea response captured on 1 November contains 18 raw markets; 10 match the supported-token normalizer. It is retained in `fixtures/rhea-2026-11-01.json`. Reference mode labels the capture date and is never accepted to authorize funded private activity.

The early confidential 1Click probe returned **HTTP 401 without a partner JWT**. Subsequent credentialed checks verified authentication, private-balance reads, signed 0.001 wNEAR shield/unshield quotes and an unsigned recovery intent. Those 6 November quotes are historical. On 9 November, fresh quotes supported a [funded owner-wallet round trip](CONFIDENTIAL-SETTLEMENT-2026-11-09.md): 0.001 native NEAR entered the private balance and returned in full, with a finalized return receipt checked. Native charges of 0.0071149895375 NEAR exceeded the stated 0.004 NEAR cap; that failure remains in the evidence. Preparation stops before paid research if the partner credential is absent. [Earlier evidence](TESTNET-TDX-2026-11-07.md) · [Authentication and recovery](CONFIDENTIAL-AUTH.md).

Reading and testing official SDK 0.1.26 showed that its signature excludes `confidentiality`, while covering `recipientType`, `recipient` and output minima. The adapter therefore requires signed `CONFIDENTIAL_INTENTS` routing and validates the request echo. [Privacy analysis](PRIVACY.md) describes the remaining provider trust.

The policy vault has passed local sandbox execution and its [upgrade and commerce proof are deployed on testnet](VAULT-COMMERCE-DEPLOYMENT-2026-11-06.md). The earlier [inference review](INFERENCE-LIVE-REVIEW-2026-11-06.md) independently reproduced provider boot measurements and identified shared-signer routing. The [9 November private research proof](NEAR-PRIVATE-RESEARCH-2026-11-09.md) adds exact direct TLS/signer/instance pins, fresh TDX/GPU verification, reviewed history and explicit provider-administration trust. Three signed researchers completed inside Neslos TDX. This establishes the encrypted exchange under that policy, not independently measured loaded weights.

The [Phala request audit](TDX-DEPLOYMENT-STATUS.md#request-compatibility-audit-addendum) confirmed an oversized historical inline payload and added size guards. Standard images subsequently deployed successfully; [private research, owner controls and restart persistence passed on 9 November](NEAR-PRIVATE-RESEARCH-2026-11-09.md). The finite CVM is retired and the testnet vault restored paused. The earlier policy-rejection predicate remains undisclosed. The [verification record](PROOF.md) distinguishes those results, the owner-wallet settlement and the remaining integrated TDX/vault payment path; [security notes](../SECURITY.md) record the transitive `elliptic` advisory.

## Product conclusions

"Best" means the highest eligible observed opportunity among the markets queried, under the user's constraints. It is not a claim to cover every NEAR protocol or a return guarantee. Separate base and incentive yield; reject unknown assets, invalid rates, missing liquidity and unapproved venues. Do not count native staking yield twice. Disclose stablecoin, oracle, bridge and public-position risks.

Neslos must demonstrate its negative case as clearly as its successful case: an untrusted proposal that cannot spend. A funded reserve is not a DeFi position. A local signed receipt is not a chain transaction. A downloaded quote is not verified hardware.

The deployed vault proof, funded Rhea cycle, provider boot reconstruction, model runtime approval, Neslos TDX hosting, paid inference, confidential settlement and final publication are distinct claims. Testnet vault enforcement, public owner-wallet Rhea lending, private NEAR AI research in TDX, the owner-wallet Confidential Intents round trip and the live Vercel rehearsal have evidence. Independently measured model weights, funded TDX/vault settlement, vault-custodied lending and final submission remain unfinished. The scoped inference policy explicitly trusts provider deployment administration, and the settlement proof retains its native fee-cap failure. A testnet-only submission can present completed work without purchasing a mainnet vault or claiming missing integrations.
