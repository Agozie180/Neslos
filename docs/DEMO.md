# Neslos: 90-second demonstration

The one sentence to remember: **agents can propose; only the policy can authorize.**

The revised checkout also has a guided **Boundary challenge** and an in-app **Evidence room**. Use the [competition package](SUBMISSION.md) for its 60-second route, human narration and submission text. `npm run demo:record` records the actual local rehearsal after `npm run dev`; the script asserts successful outcomes before finishing. The recording is silent and requires human review before publication. Deploying this revision to the public demo remains a release gate.

Use the [live Vercel rehearsal](https://neslos.vercel.app) or the local application. The hosted frontend/API and three production browser tests passed on 9 November. Present the retained [testnet commerce proof](VAULT-COMMERCE-DEPLOYMENT-2026-11-06.md) and [private NEAR AI research proof](NEAR-PRIVATE-RESEARCH-2026-11-09.md) alongside the rehearsal. All three researchers completed inside independently verified TDX. That temporary server was deleted after verification to stop hosting charges; the public demo and evidence archive support the presentation without a paid TDX instance running.

| Time | Action | Evidence to show |
| --- | --- | --- |
| 0–12s | Open Policy vault: $500/day, $200/action, 50 bps, approved venues and recipients. | State that this session is a rehearsal, and show the separate compiled NEAR contract proof. |
| 12–28s | Return to Control room and click Overspend. | Guardian blocks execution; allowance stays $500. Open the failed checks. |
| 28–40s | Try Wrong recipient, or Race 3 agents. | A named counterparty constraint or shared nonce/allowance prevents the attempted spend. |
| 40–58s | Launch a $150 allocation-reserve rehearsal. | Researchers cite Rhea yield components and exit liquidity; the six stages advance. |
| 58–68s | Inspect the leading opportunity. | Show its source, ranking rule, exclusions and public-position risk. A reserve is not a lending deposit. |
| 68–83s | Open Audit trail → Verify integrity → Test a tampered copy. | Valid receipts pass in the browser; the altered copy is rejected. |
| 83–90s | Show testnet enforcement and retained private research/settlement evidence. | Three signed reports, encrypted audit and restart checks passed in TDX. The separate owner-wallet round trip returned full principal but exceeded its native fee cap; integrated private-vault settlement remains unproved. |

Use the reproducible reference checkbox for a stable recorded demonstration. Explain that the 1 November data is captured, not current. For a live-data demonstration, refresh and retain the actual source response/time.

Suggested narration:

“Neslos is a private agent treasury on NEAR. Researchers compare opportunities; a strategist proposes; a deterministic guardian checks the owner's rules. The spending contract enforces the shared cap even when several agents compete. Here, an overspend is blocked and an allowed rehearsal produces a receipt we can verify. Separately, three NEAR AI researchers completed inside independently verified Intel TDX. Their signed research, encrypted audit and restart checks are archived. We retired the server after verification to stop hosting charges. Agents propose. Your policy decides.”

Use the dated hardware, research and chain receipts for the claims they demonstrate. Label the browser recording as a rehearsal. The research archive proves the separate private-client/CLI flow under its declared trust policy; it does not establish a funded settlement or a currently running TDX endpoint.

The [9 November settlement report](CONFIDENTIAL-SETTLEMENT-2026-11-09.md) adds a funded owner-wallet provider round trip with full principal recovery and an independently checked return receipt. Keep its failed native fee cap visible. It used no TDX or Neslos vault and does not establish a single research-to-vault-to-settlement execution.

## Evidence for review

| Review step | Expected result | Source |
| --- | --- | --- |
| Run the public or local demo | Overspend denied, allowed rehearsal completes, original audit verifies and a tampered copy fails | [README walkthrough](../README.md#try-it-in-90-seconds) |
| Run local checks | Application/build and browser checks pass; Linux covers platform-specific checks | [Reproduction commands](../README.md#reproduce-the-checks) |
| Inspect chain enforcement | Finalized public testnet transactions and fixture-token balances support payment/limit/replay claims | [Commerce proof](VAULT-COMMERCE-DEPLOYMENT-2026-11-06.md) |
| Inspect private research | Three signed researchers, verified hardware/build inputs, restart and budget rejection; provider-administration trust disclosed | [Research proof](NEAR-PRIVATE-RESEARCH-2026-11-09.md) · [Evidence index](../deploy/near-private-research-20261109/record.json) |
| Inspect the owner-wallet settlement | Full 0.001 NEAR principal returned with a finalized receipt; native fee-cap failure disclosed | [Settlement proof](CONFIDENTIAL-SETTLEMENT-2026-11-09.md) · [Evidence index](../deploy/confidential-settlement-20261109/record.json) |

The archive contains public hardware/build evidence and sanitized results. Private prompts and receipt openings remain with the owner. Reviewers can inspect the committed evidence without cloud credentials or renting a new TDX instance; repeating a live hardware/inference session is a separate optional paid operation.

## Submission preparation

The deadline is 14 November 2026 at 23:59 UTC (15 November at 00:59 in Lagos). The [README explains the fit for Security, Privacy, DeFi and Swarms in one sentence each](../README.md#hackathon-tracks), with evidence links; the [research guide](RESEARCH.md#track-fit-and-evidence) records their scope and submission IDs. Add the Agents track only after a compatible paid-job integration is demonstrated.

Track the remaining publication work here:

- [ ] Make the reviewed repository public for judging.
- [ ] Record the demo using the walkthrough and dated proof above; keep the public rehearsal accessible through judging.
- [ ] Have the human publish the public X demo, mention NEAR HACKATHON, tag `@NEARProtocol` and `#NEARHackathon`, and retain the post URL.
- [ ] Collect the human's actual team/contact details, mainnet payout account, consent and final track selection.
- [ ] Recheck the [live event brief](https://nearhackathon.com/HACKATHON.md), review the exact final payload and submit once.

The event accepts attached video or screenshots for an accessible hosted demo; a local-only demo requires video. A recording is planned for Neslos. The user must approve publication and the exact final submission. Do not invent a deployment, team member, prize result or account address. Continuous TDX hosting is not part of this checklist.

The event does not publish a numerical scoring rubric. Protect the strongest evidence: on-chain spending enforcement, an adversarial demonstration, independent verification, and a runnable product.
