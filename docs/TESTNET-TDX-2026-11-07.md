# Testnet TDX continuation — 7 November 2026

**Latest:** the [provider-response follow-up](TDX-PROVIDER-FOLLOWUP-2026-11-07.md) supersedes the earlier continuation steps below. A new compact, attestation-only bundle preserves all application/lock bytes, passes 579 application tests and Linux packaging checks, and fits the provider limit. Its corrected API submission still received a policy denial. No CVM was committed; Phala offers no pre-approval and specifically suggests the normal console flow.

**Subsequent local repair:** the [V3 startup audit](TDX-STARTUP-AUDIT-2026-11-07.md) adds full installed-dependency and exact application-file verification before import. All 582 current application tests and actual Linux startup/tampering checks pass. The new 150,387-byte candidate has not been submitted; the historical provider denial remains unresolved.

The requested target is the existing vault owned by **`neslos.testnet`**. Its contract is already deployed and matches the current build. **A Neslos TDX VM has not been launched.** The saved Phala denial concerns the older oversized inline request; the current full-image candidate passes offline schema validation and has not been submitted. The read-only Cloud API authenticates and returns zero CVMs. The [root audit](BLOCK-ROOT-AUDIT-2026-11-07.md) records the exact distinction and the unresolved provider decision.

## Verified target

| Item | Evidence from this continuation |
| --- | --- |
| Owner | `neslos.testnet`; approximately 4.934255 testnet NEAR available |
| Vault | `vault.neslos.testnet` |
| Asset | `token.neslos.testnet`; 739 fixture tokens in the vault |
| Finalized snapshot | Block 276618466; policy version 9; paused |
| Deployed and rebuilt WASM SHA-256 | `545e140a2f452f609ba55b5623d1d48994bde32335c0a7fc05acd644e7cf8aa0` |
| Cloud account | Authenticated; $5 balance; post-paid; zero CVMs returned |

The owner is not the contract account. Replacing `neslos.testnet` with contract code would be unnecessary. No chain transactions or paid inference calls were made during this continuation. Testnet NEAR pays chain fees, not TDX hosting. The retained combined implementation budget is $3, allocated as $2.75 hosting and $0.25 inference; the post-paid account's credit balance is not a spending cap.

## Work completed

- Added `--testnet-vault vault.neslos.testnet` to `npm run tee:bundle`. It binds the network and vault into the measured Compose and rejects invalid or non-testnet targets before writing output.
- Corrected gateway provenance verification for the provider's newer layout. API and ingress remain required; present VPC components still require their build signatures. Mutable/unresolved images and unknown provider repositories are rejected. Fresh live gateway verification passed after the change.
- Rebuilt the Linux/amd64 runtime as `neslos-tee:testnet-20261107`. Its image is local, not published to a registry or launched on TDX. Container build attestations do not establish Intel hardware execution.
- Rechecked the retained 6 November confidential proof preflight. Both 0.001 wNEAR quote signatures and the unsigned recovery intent validate at their historical timestamps. Those quotes are expired; the record contains zero transactions and zero spending signatures. The partner-key and quote-readiness work therefore predates this continuation and is more advanced than the older status text described.

## Verification

- Final application verification: **574 passed, four Windows platform skips**, TypeScript and production build passed.
- Browser: **six tests passed** in Ubuntu, covering desktop/mobile rehearsal and fixture-backed owner flows.
- Contract: **25 Rust unit tests and both local sandbox suites passed**. The unchanged contract WASM matches the deployed testnet code.
- Restricted container: rebuilt and checked without network access, with a read-only filesystem and dropped capabilities. The bootstrap refuses private work and rejects fake hardware; this is software validation, not a TDX quote.

Each generated verification report identifies its run and source digest. Browser and contract checks were completed before the subsequent gateway-only compatibility fix; their respective application paths and contract sources were unchanged by it. Final application and container checks include that fix. Fresh browser screenshots are retained in the ignored `.local/testnet-tdx-20261107/screenshots` directory instead of replacing the repository's earlier screenshots.

## Inference evidence and remaining limit

The first fresh Qwen capture used a one-GPU VM and a ten-action manager history. Selecting its actual `prod/qwen38-27b-abliterated-cc-1gpu.yaml` file verifies the base Qwen proxy and Compose Manager build provenance. The base proxy selection does not request the abliterated model.

The reviewed source file at commit `75d31e6461dc51465a81ff69203200a51a820d1c` has SHA-256 `cd58c977f2fbb98e4a242fe83a5d2911355b78247c3dac875012534adc1e49d4`. Its complete canonical action-history hash is `3d7ddacf8ee207bda5f972c4a2bbc3bd99e557c380f4e94b3cb8b013c436f3fe`.

Using the previously pinned dstack measurement calculator and OS artifacts, the actual 12-vCPU, 200-GiB, one-GPU configuration independently reproduced MRTD, RTMR0–2, and all 13 RTMR0 events. The calculator was given VM configuration and OS artifacts, not expected quote digests. Its script, log and comparison are retained under `.local/testnet-tdx-20261107/`.

A later fresh request returned the eight-GPU deployment, whose later Compose mutations remain ambiguous for the requested Qwen service. The fixed gateway check passed, but model approval correctly failed with `PROVENANCE_COMPOSE_AMBIGUOUS_MUTATION`. No approval file was generated and no paid completion was requested. Build signatures and boot reconstruction alone do not establish the complete current engine, weight, administrative-history and fleet-routing trust scope.

The root audit confirmed that these captures share both their signer and signing public key despite different Compose hashes and action histories (10 versus 86 actions). The SDK encrypts to that model key. Signer filtering cannot isolate the reviewed one-GPU deployment, and a successful preflight does not pin subsequent routing. This requires a supported isolation mechanism or a review covering the shared key's full deployment scope.

## Work still required

1. Obtain Phala's review of the exact rejected request and a supported remedy, or an independently approved TDX/dstack host. The retained [provider response](TDX-DEPLOYMENT-STATUS.md) says: “You are not allowed to deploy the target applications since it violates our terms of use.” Its matched rule is unknown; it does not establish a ban on the account or a rejection of the current build. Offline schema success does not establish provider acceptance. No provisioning retry or alternate payload was submitted.
2. Publish the reviewed runtime image to an owner-controlled registry, verify the remote digest, and render the bundle with `--testnet-vault vault.neslos.testnet`. Configure bounded hosting teardown before launch.
3. Launch in attestation-only mode, derive the Neslos VM's own measurements, verify a fresh quote, and pin its executor in the existing testnet vault using the owner account. Provider-model attestations cannot substitute for this step.
4. Finish approval of a supported model deployment and its routing/history, then enable bounded encrypted research. Research can use the testnet vault while spending remains paused; mainnet market assets need appropriate research allowlists.
5. Demonstrate private research and its verified audit receipt from the deployed runtime. Hosted Confidential Intents has no testnet, so funded confidential settlement is a separate mainnet integration and cannot be completed using testnet tokens.
6. Complete the public demo, human-published demo post and confirmed hackathon submission. This continuation has not published or submitted the project.

Local diagnostics and preflight payloads remain private. They contain operational evidence and are not public hardware proof. The owner has authorized the support draft in `.local/phala-provision-audit-20261106/support-draft.md`; submission remains blocked by unavailable browser access and Brave's Computer Use approval rejection. It has not been sent. The [root audit](BLOCK-ROOT-AUDIT-2026-11-07.md) also records upstream inference issue 1087 and the current GitHub session's missing package-publication scope.
