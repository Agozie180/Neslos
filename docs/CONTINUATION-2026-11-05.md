# Foundation continuation — 5 November 2026

The original objective remains: researched proposals, private computation, on-chain spending limits, settlement and verifiable receipts. A local wallet budget is not a substitute for the vault; public lending is not confidential execution.

## Priority and acceptance criteria

1. Restore a reproducible working tree. Exercise the real pinned SDK serializer in commerce tests, rather than an incomplete fake public key. Run application, browser and contract verification on the final source.
2. Tighten evidence boundaries. Reject contradictory finalized block identities and inconsistent budget arithmetic. Reject unsupported or duplicate Rhea assets. Regressions must fail before each fix.
3. Audit the unfinished commerce adapter against upstream protocol code and live read-only responses. Keep it explicitly owner-operated, public and outside the vault. Do not present it as fulfilling private autonomous spending. Verify the actual position and transfer independently.
   Complete venue/counterparty editing in the real owner policy form: use existing local openings, display chain membership, preserve untouched lists, reject unknown/duplicate/empty selections and incomplete local details, and create a version-bound review plan before submission.
4. Capture a current, reproducible evidence report with exact source identity, current hackathon rules, findings, fixed defects and remaining release blockers.
5. Complete the flagship private path: provision an immutable TDX image, independently approve its measurements, verify encrypted inference, verify a signed confidential quote, then prove a bounded authorized payment and observed settlement. Never weaken attestation to turn a probe green.
6. Finish submission artifacts: public repository, short guardrail-first demonstration, human-published X post and confirmed submission payload before 14 November 2026 at 23:59 UTC.

## Architecture decisions

- Continue the existing vault and private owner workflow. Preserve unfinished local work.
- Prioritize Security and Privacy evidence; claim other tracks only to the extent demonstrated.
- Keep mainnet spending and external publication separate from code and read-only validation. The current audit has not authorized a specific funded transaction or publication.
- The owner is trusted. Hostile models cannot change amounts or allowlists; the enclave binds hidden recipient/venue openings. RPC providers, market feeds and the Intents provider remain explicit trust dependencies.
- An encrypted append-only local journal detects alteration against a retained checkpoint. It does not by itself prevent a hostile host restoring an older valid snapshot. On-chain spending stays bounded, but inference-credit accounting needs an external freshness/rollback anchor for that threat model.

## Success criterion

A judge can reproduce a rejected overspend, a permitted vault action, separate dispatch and settlement states, and an independently checked receipt. Hardware, inference and confidential settlement must each have their own real evidence before the complete private product is claimed.
