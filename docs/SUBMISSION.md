# Neslos competition package

Updated **12 November 2026**. The live [event brief](https://nearhackathon.com/HACKATHON.md) was last rechecked on 9 November and must be checked again before submission. Deadline: **14 November, 23:59 UTC / 15 November, 00:59 Lagos**. This is a review package, not a submitted application.

## The idea a judge should remember

**Agents propose. Your policy decides.**

Neslos lets a treasury owner delegate opportunity research and payment preparation while keeping spending authority in an owner-defined NEAR vault. The product's defining moment is a denied transaction: the agent asks for $501, but the owner's $200 action limit holds. The same workflow accepts a $150 reserve and leaves $350 of the day's allowance. Its encrypted receipts can be checked and deliberately tampered with in the browser.

Lead with **Security**, supported by **Privacy**, **Swarms** and **DeFi**. The same spending boundary connects all four. Do not add unrelated tracks to inflate coverage. The event has no published weighted scoring rubric; neither a placement nor an advantage over a specific number of competitors is established.

## Why this product is useful

The initial user is a small team or individual treasury owner who wants help comparing yield and liquidity, but needs explicit control over recipients, routes and daily exposure. A proposal needs both useful research and permission to spend. Neslos separates those responsibilities: researchers can narrow or veto a choice; the guardian and vault enforce the owner's rules.

The implementation combines a shared budget, monotonic nonce, exact signed authorization and an encrypted audit trail. A model cannot enlarge the budget by rewriting a prompt. A policy edit does not replenish today's consumption. A transaction timeout does not imply a refund. These are concrete invariants with tests and separate public testnet evidence.

The next practical pilot is a tightly bounded, single-asset treasury workflow after the complete funded private-vault path and cost preflight are validated. No customer traction, revenue or production custody assurance is claimed.

## Reviewer route

The walkthrough runs from this repo with `npm run dev` and is deployed at [neslos.vercel.app](https://neslos.vercel.app). Its health endpoint is live. Production includes Runtime Cache restoration for cross-instance sessions, the `/owner` SPA rewrite, the **Boundary challenge** and the **Evidence room**.

| Time | Action | Visible result |
| --- | --- | --- |
| 0–10 seconds | Open the control room; choose **Take the 60-second challenge** | The problem, policy boundary and rehearsal scope are visible |
| 10–25 seconds | **Start the challenge**, then inspect the guardian's failed checks | The $501 attempt is blocked; $500 remains. Starting explicitly resets only the simulated session |
| 25–38 seconds | **Run the $150 mission** | Researchers, strategy and guardian run; the reserve completes with $350 remaining |
| 38–48 seconds | **Verify & tamper-test receipts** | Actual browser verification accepts the original history and rejects the altered copy |
| 48–60 seconds | Open the **Evidence room** | Direct allowed/denied/replay vault receipts, the funded Rhea cycle, three signed private researchers and the disclosed settlement fee failure |

For a deeper review, download the challenge proof and evidence index, inspect the linked source records, and run `npm run verify`, `npm run test:browser` and the credential-free `npm run verify:rhea`. The [judge-safe Rhea guide](JUDGE-RHEA-REPRODUCTION.md) verifies the funded receipts without minting, supplying, withdrawing or using the owner's key. A challenge proof is explicitly scoped to its rehearsal session; its key is pinned on first use and is not a hardware identity. The evidence index is a map of archived records, not a fresh attestation.

## Recording and narration

Run `npm run dev` in one terminal, then `npm run demo:record` in another. The recorder uses only the local rehearsal, checks each expected result, creates `artifacts/neslos-demo.webm`, and renders the share card. A matching H.264 upload copy is retained locally at `artifacts/neslos-demo.mp4`; it is excluded from future Git tracking and must not be committed or pushed. The recording has no audio; use this narration for the human's final recording or voiceover:

> AI agents can research an opportunity. Who controls what they spend? Neslos puts the owner's policy in charge. This is a rehearsal with simulated funds. The daily budget is five hundred dollars; each action is capped at two hundred. Here the agent requests five hundred and one. The guardian rejects it, and the full allowance remains. Now the same agents prepare a one-hundred-and-fifty-dollar reserve. It completes, leaving three hundred and fifty. This reserve does not open a lending position. Next, my browser verifies the signed, encrypted history. Change one receipt, and verification fails. The evidence room links actual vault enforcement, a funded public Rhea supply-and-withdraw cycle, and three private AI researchers inside verified Intel TDX. A separate mainnet owner-wallet round trip returned its principal but failed its fee cap; that limitation stays visible. Agents propose. Your policy decides.

## Submission idea text

Neslos is an owner-controlled agent treasury on NEAR. Three specialist researchers assess yield, liquidity and risk; a strategist proposes an action; a deterministic guardian checks the owner's policy. A NEAR vault enforces shared spending limits, exact authorizations and replay protection before funds leave custody. The interactive rehearsal demonstrates a rejected overspend, an allowed reserve and browser verification of signed, encrypted receipts. Separate evidence establishes real testnet enforcement, a funded public Rhea owner-wallet supply/withdrawal cycle, and three signed NEAR AI researcher reports inside independently verified Intel TDX under disclosed provider-administration trust. A separate Confidential Intents owner-wallet round trip returned its full principal but exceeded its native fee cap. A complete bound private-research → vault → confidential-settlement transaction and vault-custodied Rhea cycle remain unproved. Neslos gives owners a concrete way to delegate research and payment preparation while retaining spending authority.

This text describes implemented behavior and its boundaries. It is not an API payload: team identity, email, team size, payout account, public post URL, consent and final track selection must come from the human.

## Draft X post

> Agents propose. Your policy decides.
>
> Built Neslos at NEAR HACKATHON: private agent research with spending limits enforced on NEAR. Watch a $501 request get blocked, a $150 rehearsal pass, and a tampered receipt fail verification.
>
> @NEARProtocol #NEARHackathon
> https://neslos.vercel.app

Attach the human-reviewed recording or screenshots. The post must be published by the human. Add the source link in a reply if needed. The revised challenge is live; keep the rehearsal/session limitation described accurately until the public suite is fully green.

## Questions judges are likely to ask

| Question | Answer and evidence |
| --- | --- |
| Why NEAR? | The Rust vault provides the spending boundary and public execution receipts. NEAR AI supplies the separate encrypted research service; Rhea supplies lending-market data and the public lending venue used in the funded testnet cycle. [Architecture](ARCHITECTURE.md) |
| Is this only a scripted demo? | The public demo is explicitly a deterministic rehearsal. Separate real receipts establish vault behavior and a funded Rhea cycle; the TDX archive records three signed live-market researchers. [Verification record](PROOF.md) |
| What is private? | Research exchange and audit contents have encryption and attestation controls. Public deposits, amounts and timing remain observable; model administration is trusted. [Privacy](PRIVACY.md) |
| What happens if agents race? | They share allowance reservation and a monotonic nonce. Competing proposals cannot each assume they own the whole budget. [Vault](../contracts/policy-vault/README.md) |
| Does this invest real money in lending? | The demo reserve is still simulated. Separately, `neslos.testnet` completed a funded public Rhea testnet cycle with fake USDC and recovered its full principal; it did not use the vault or private runtime. [Validation](RHEA-TESTNET-VALIDATION-2026-11-12.md) |
| What failed? | The owner-wallet provider round trip returned its full principal, but gas-only estimation missed account creation and exceeded the original fee cap. The result remains failed. [Settlement report](CONFIDENTIAL-SETTLEMENT-2026-11-09.md) |
| Is the owner browser connected to real private infrastructure? | Yes. A fresh 12 November TDX session passed executor verification, credit inspection, audit verification, private receipt opening and reload recovery with zero inference calls. [Validation](OWNER-BROWSER-VALIDATION-2026-11-12.md) |

## Release gates

- [x] Deploy this reviewed revision to the public rehearsal and verify its health endpoint.
- [x] Fix process-local production session loss in the repo with Runtime Cache restoration and cross-instance regression coverage.
- [ ] Deploy the authorized revision, then rerun all ten hosted challenge/control-room/owner checks.
- [ ] Owner handles repository visibility and verifies its evidence links while signed out.
- [ ] Have the human review/record the final demo, publish the X post and retain its URL.
- [ ] Confirm actual team/contact/payout information, consent and the four proposed tracks with the human.
- [ ] Recheck the live event brief, review the exact submission payload, and submit once after explicit confirmation.
- [ ] Keep the hosted rehearsal and reviewer source link accessible through judging, ideally through 25 November.

No cloud rental, paid inference or additional funded transaction is needed to review this package. The existing fee-cap failure, integrated-payment gap and production-hardening work remain engineering limitations, not hidden release accomplishments.
