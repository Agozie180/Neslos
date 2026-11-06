# Reviewed continuation — 6 November 2026

The [audit](AUDIT-2026-11-06.md) is complete for this working tree, and five confirmed defects have fixes and regressions. The remaining objective is to prove the integrated private flow, then submit honest evidence.

## Concrete build available

- Source base: `482de6a34ee29780e96c00ebaf1075f67a8bf2fd`; branch `feat/live-execution-and-agent-commerce`, including preserved pre-existing owner/commerce work and this audit's fixes.
- Verified source digest: `92a2e68f5c5ddf2308f037c358a95b2ac5c23d08f3dafef254528a316e2d8284`.
- 285 application tests, 6 browser tests, 13 Rust tests and one sandbox suite passed; TypeScript/build and TEE container checks passed.
- Local TEE image: `neslos-tee:audit-20261106`, Linux/amd64, ID `sha256:19de979b347b0095c199d752f203aaa424bbfd6ce678f34cfb2c441c1c678dd1`.
- Vault WASM: `artifacts/policy_vault.wasm`, 203266 bytes, SHA-256 `c15ce323dccfc8d7f8d026c1e9bc51f8ef383b61065cd4682b8579cae6a32c46`.

No commit, push, public release, image publication, chain deployment, funded trade or paid inference was performed by this audit.

## Next publication action for owner review

Commit the verified project files on the existing branch, push that branch to `https://github.com/Agozie180/Neslos`, and make that repository public for hackathon review. Keep `.env`, `.private`, `.local`, generated private plans/journals and credentials excluded. The public README will continue to state that private live execution is unverified and the testnet deployment predates the resume fix. Do not merge over another branch or rewrite history.

The official [HACKATHON.md](sources/HACKATHON-2026-11-06.md) puts “Make the repository public, push, or force-push” under “Never without the human's explicit confirmation.” This is the reason publication awaits confirmation; local coding/testing has already been completed.

## Private execution acceptance sequence

1. Publish the reviewed TEE image to an owner-controlled registry and verify the actual remote digest. Generate a deployment bundle from that digest; a local image ID alone is not a registry availability check.
2. Deploy a CPU Intel TDX instance in attestation-only mode, without private work or credentials. Independently establish the OS/app measurements from reviewed platform inputs and verify a fresh quote. Never copy the remote server's advertised values into the allowlist merely to make verification pass.
3. Configure the approved inference policy and bounded credit reservation policy, reverify the runtime, and prepare the exact owner transaction to pin its executor. The existing testnet contract also needs the reviewed WASM. Each signed operation needs an exact plan.
4. Produce genuine encrypted NEAR AI research before introducing payment. Preserve its verified response and signed audit receipt.
5. For Intents, use a separately approved mainnet vault/payment plan, owned confidential destination and live signed quote. Demonstrate one rejected overspend and one bounded successful dispatch/settlement. A public testnet fixture transfer is not that proof.
6. Record the complete demonstrated flow, publish the public demo post through the human, and confirm the final submission payload by the deadline.

The live CPU catalogue on 6 November lists `tdx.small` at $0.058/hour (1 vCPU, 2 GB RAM, default 20 GB disk). The dated storage rate is $0.000139/GB/hour: about $0.06078/hour combined, subject to reconfirming current billing. The existing cost notes record a $3 combined cap; this does not grant new publication or transaction authority. The workspace is post-paid, so establish reliable stop/deletion and retained-storage handling before launching. No provider-enforced spending ceiling was established.

This sequence is the remaining implementation/release work, not a claim that deployment or private settlement is already complete.
