# Neslos: 90-second demonstration

This repo also has a guided **Boundary challenge** and an in-app **Evidence room**. The [competition package](SUBMISSION.md) contains a 60-second route, narration and submission text. `npm run demo:record` records the local rehearsal after `npm run dev`; the script asserts successful outcomes before finishing. The local recording is silent, excluded from future Git tracking and still requires human review before publication.

Use the [live Vercel rehearsal](https://neslos.vercel.app) or the local application. Production includes Vercel Runtime Cache restoration for cross-instance rehearsal sessions, the `/owner` SPA rewrite, the **Boundary challenge** and the **Evidence room**. Separate records cover [testnet vault commerce](VAULT-COMMERCE-DEPLOYMENT-2026-11-06.md), the [funded Rhea cycle](RHEA-TESTNET-VALIDATION-2026-11-12.md), [private research](NEAR-PRIVATE-RESEARCH-2026-11-09.md) and the [live owner browser](OWNER-BROWSER-VALIDATION-2026-11-12.md). Detailed test results remain in [PROOF](PROOF.md).

| Time | Action | Evidence to show |
| --- | --- | --- |
| 0–12s | Open Policy vault: $500/day, $200/action, 50 bps, approved venues and recipients. | The interface labels the session as a rehearsal; the compiled NEAR contract has a separate proof. |
| 12–28s | Return to Control room and click Overspend. | Guardian blocks execution; allowance stays $500. Open the failed checks. |
| 28–40s | Try Wrong recipient, or Race 3 agents. | A named counterparty constraint or shared nonce/allowance prevents the attempted spend. |
| 40–58s | Launch a $150 allocation-reserve rehearsal. | Researchers cite Rhea yield components and exit liquidity; the six stages advance. |
| 58–70s | Open Evidence room and follow the Rhea supply and withdrawal links. | Finalized NEAR testnet transactions show 0.1 fake USDC supplied and the full principal returned to `neslos.testnet`. |
| 70–84s | Open Audit trail → Verify integrity → Test a tampered copy. | Valid receipts pass in the browser; the altered copy is rejected. |
| 84–90s | Show the remaining private research and settlement records. | Three signed reports, encrypted audit and restart checks passed in TDX. The separate Confidential Intents round trip returned full principal but exceeded its native fee cap; integrated private-vault settlement remains unproved. |

Use the reproducible reference checkbox for a stable recorded demonstration. The 1 November data is captured, not current. A live-data demonstration needs the actual source response and capture time retained with it.

Suggested narration:

“Neslos is a vault workflow on NEAR. Researchers compare opportunities; a strategist proposes; a deterministic guardian checks the owner's rules. The vault enforces the shared cap even when several agents compete. Here, an overspend is blocked and an allowed rehearsal produces a receipt that verifies in the browser. The evidence room links the finalized Rhea supply and withdrawal transactions: 0.1 fake USDC entered the lending market and the full principal returned to `neslos.testnet`. Three private research agents also completed inside independently verified Intel TDX. Their signed research, encrypted audit and restart checks are archived. The server was retired after verification to stop hosting charges.”

The dated hardware, research and chain receipts support separate claims. The browser recording is a rehearsal. The research archive covers the separate private-client/CLI flow under its declared trust policy; it does not establish a funded settlement or a currently running TDX endpoint.

The [12 November Rhea report](RHEA-TESTNET-VALIDATION-2026-11-12.md) adds a funded public owner-wallet supply/withdrawal cycle with full principal recovery. The [9 November settlement report](CONFIDENTIAL-SETTLEMENT-2026-11-09.md) adds a separate funded owner-wallet provider round trip with full principal recovery and an independently checked return receipt. Keep its failed native fee cap visible. Neither proof used TDX or the Neslos vault, and neither establishes a single research-to-vault-to-settlement execution.

## Evidence for review

| Review step | Expected result | Source |
| --- | --- | --- |
| Run the public or local rehearsal | Overspend denied, allowed rehearsal completes, original audit verifies and a tampered copy fails | [README walkthrough](../README.md#try-it-in-90-seconds) |
| Run local checks | Application/build and browser checks pass; Linux covers platform-specific checks | [Reproduction commands](../README.md#reproduce) |
| Inspect chain enforcement | Finalized public testnet transactions and fixture-token balances support payment/limit/replay claims | [Commerce proof](VAULT-COMMERCE-DEPLOYMENT-2026-11-06.md) |
| Inspect funded lending | Rhea accepted 0.1 fake USDC, issued shares and transferred the full principal back to `neslos.testnet` | [Rhea cycle](RHEA-TESTNET-VALIDATION-2026-11-12.md) · [Evidence index](../deploy/rhea-funded-cycle-20261112/record.json) |
| Inspect private research | Three signed researchers, verified hardware/build inputs, restart and budget rejection; provider-administration trust disclosed | [Research proof](NEAR-PRIVATE-RESEARCH-2026-11-09.md) · [Evidence index](../deploy/near-private-research-20261109/record.json) |
| Inspect the owner-wallet settlement | Full 0.001 NEAR principal returned with a finalized receipt; native fee-cap failure disclosed | [Settlement proof](CONFIDENTIAL-SETTLEMENT-2026-11-09.md) · [Evidence index](../deploy/confidential-settlement-20261109/record.json) |

The archive contains public hardware/build evidence and sanitized results. Private prompts and receipt openings remain with the owner. The committed evidence can be inspected without cloud credentials or renting a new TDX instance; repeating a live hardware/inference session is a separate optional paid operation.

## Submission preparation

The deadline is 14 November 2026 at 23:59 UTC (15 November at 00:59 in Lagos). The [README claims table](../README.md#claims--evidence) links the Security, Privacy, DeFi and Swarms statements to evidence; the [research guide](RESEARCH.md#track-fit-and-evidence) records their scope and submission IDs.

Track the remaining publication work here:

- [ ] Owner handles repository visibility and verifies the evidence links while signed out.
- [x] Record the silent local rehearsal using the walkthrough and dated proof above; keep the public rehearsal accessible through judging.
- [ ] Human-review the local recording and add narration or record the final presentation version.
- [ ] Have the human publish the public X demo, mention NEAR HACKATHON, tag `@NEARProtocol` and `#NEARHackathon`, and retain the post URL.
- [ ] Collect the human's actual team/contact details, mainnet payout account, consent and final track selection.
- [ ] Recheck the [live event brief](https://nearhackathon.com/HACKATHON.md), review the exact final payload and submit once.

The event accepts attached video or screenshots for an accessible hosted demo; a local-only demo requires video. Neslos has a retained silent local recording that still needs human review and narration before publication. The user must approve publication and the exact final submission. Do not invent a deployment, team member, prize result or account address. Continuous TDX hosting is not part of this checklist.

The event does not publish a numerical scoring rubric.
