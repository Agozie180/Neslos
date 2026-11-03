# Deployment and verification

The local rehearsal is ready to run. The live path is intentionally a different process: it must prove its hardware identity before it can handle private jobs. Do not expose the rehearsal API as a funded owner wallet.

## Local application

Use Node 24.22.2 (minimum 24.22.1), npm, and the checked-in lockfile.

    npm ci
    npm run dev

Open http://127.0.0.1:5173. No wallet, inference key or funds are required. On this Windows workspace, the scripts also recognize the verified Node binary in .tools.

For a production-style local build:

    npm run verify
    npm start

Open http://127.0.0.1:8787. The default bind address is loopback.

## Local NEAR proof

Install Rust 1.93.0 with the wasm32-unknown-unknown target and cargo-near 0.22.0. On Windows, use WSL Ubuntu. The wrapper automatically uses the locally verified cargo-near binary when present.

    sudo apt-get update
    sudo apt-get install --yes build-essential pkg-config libudev-dev
    cargo install cargo-near --version 0.22.0 --locked
    npm run test:contract

This builds the policy vault and a clearly labelled local test token, then deploys them into near-sandbox. It verifies real cross-contract receipts, actual test-token balances, negative authorizations, owner policy updates, callback privacy, failed dispatch reconciliation, settlement and paused recovery. It cannot transfer mainnet assets.

Outputs appear in artifacts: policy_vault.wasm, its ABI, contract-output.log and contract-verification.json. A successful host build is not a claim of byte-identical reproducible Docker builds.

## Hosting the rehearsal

The Dockerfile builds a standalone Node application. Set HOST=0.0.0.0 and PORT as required by the host. Behind HTTPS, set NODE_ENV=production and NESLOS_PUBLIC_ORIGIN to the exact public HTTPS origin. Production cookies require HTTPS.

The application uses isolated, bounded, memory-only rehearsal sessions. Use a single process or sticky routing for a demo; a restart expires its sessions. Publish only after reviewing the intended host and public URL. Keep it available through judging.

    docker build -t neslos-rehearsal .
    docker run --rm -p 8787:8787 -e HOST=0.0.0.0 neslos-rehearsal

The example remains local. For public HTTPS hosting, apply the production environment settings above.

## Owner testnet CLI

The official `near-api-js` 7.4.0 SDK drives the owner commands. The public deployment is [vault.neslos.testnet](https://testnet.nearblocks.io/address/vault.neslos.testnet); [deployment evidence](../deploy/testnet.json) records finalized transaction hashes, downloaded code hashes, and its initial configuration. Its asset is a minimal test fixture token, and its executor is a local test key. This deployment does not demonstrate hardware privacy or Intents routing.

For a fresh, funded owner testnet account, use a private NEAR credential JSON containing `account_id`, `public_key`, and `private_key`. Keep that file outside version control. Run these commands individually, inspecting the saved plan before deployment:

```sh
npm run testnet -- status --credentials /private/owner.testnet.json
npm run testnet -- plan --credentials /private/owner.testnet.json
npm run testnet -- deploy --credentials /private/owner.testnet.json
npm run testnet -- prove --credentials /private/owner.testnet.json
```

The plan fixes `vault.<owner>` and `token.<owner>`, 3 and 2 testnet NEAR respectively, the exact WASM hashes, and a paused vault with 500/day and 200/action test-token limits. Deployment preserves at least 1 testnet NEAR in the owner account. The proof transfers 150 test tokens, checks overspending and replay rejection, confirms a failed transfer restores allowance, lowers/restores policy without resetting consumption, records settlement, and finishes with pause and a 50-token owner withdrawal. These are public test-token transactions, not USDC or cross-chain settlement.

Signed transaction bytes are saved before broadcast under `.private/testnet/transactions`. A repeated operation checks its saved hash rather than signing another payment. Proof recovery requires a contiguous sequence of finalized, expected receipts and matching on-chain policy, nonce, balances, and records. A different state, an unresolved transaction, a UTC-day change after spending, or an emergency-pause record stops recovery. Preserve the whole private directory; deleting a journal is not a recovery procedure. Repeating a fully completed proof reconciles evidence without making new transfers.

On this Windows workspace, run through Ubuntu WSL:

```powershell
wsl.exe -d Ubuntu -- bash /mnt/c/Users/USER/Neslos/scripts/ubuntu.sh verify
wsl.exe -d Ubuntu -- bash /mnt/c/Users/USER/Neslos/scripts/ubuntu.sh test:browser
wsl.exe -d Ubuntu -- bash /mnt/c/Users/USER/Neslos/scripts/ubuntu.sh testnet -- status
```

The wrapper syncs source into `$HOME/.cache/neslos-ubuntu`, uses Linux dependencies/builds, and copies public evidence back. It excludes `.env` and `.private`. Its default owner credential is the existing Windows `.private/near/testnet/neslos.testnet.json`; generated executor keys and transaction journals stay in the Linux workspace's `.private/testnet`. Retain that directory across resumes. Install Playwright's Chromium in Ubuntu before browser checks; the Windows download cannot be used there. Docker is not needed for this workflow.

## Owner-controlled on-chain policy

The compiled contract initializer accepts:

- owner_id: the actual owner NEAR account;
- token_id: the budget asset contract (native NEAR USDC for the live adapter);
- network: testnet or mainnet, bound into every authorization;
- executor_public_key: the independently verified TEE's 32-byte Ed25519 public key, hex encoded;
- policy: integer limits, quote age, salted venue/counterparty commitments, allowed output assets, confidentiality and pause.

Use src/core/crypto.ts::commitment with a **different random 32-byte salt per opening**. The counterparty value is the real Confidential Intents recipient identifier, not a UI nickname. Store openings only in the owner's private environment and the encrypted TEE request. The contract stores their commitments.

Native NEAR USDC is:
17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1

Register the vault's FT storage before funding it. Owner governance/full-access keys must remain outside the agent. Testnet deployment verifies contract behavior with a test asset; **1Click has no testnet**.

Review the deployed code hash, contract account, initializer, access keys, attached deposits and network before the owner signs a deployment or policy transaction. Never invent an explorer link.

## Attested runtime

The implementation is in src/tee/runtime.ts, src/tee/index.ts and src/core/private-client.ts.

1. Provision a genuine dstack Intel TDX confidential VM with the reviewed image. Mount its guest-agent socket and persistent encrypted-journal volume.
2. Establish approved OS/application measurements through the trusted build/provisioning process. Obtain quote evidence without private requests; independently verify its Intel chain, runtime measurements and key binding.
3. Provide a strict TEE measurement file matching teePolicySchema. It must contain format=neslos-tdx-policy-v1 plus actual 48-byte mrTd and rtMr0…rtMr3 values in lowercase hex.
4. Provide an inference policy file with an approved modelId and independently pinned gateway/model osImageHash and composeHash values. Its schema is inferencePolicySchema.
5. Inject NEARAI_API_KEY, ONECLICK_JWT, NESLOS_OWNER_TOKEN (a random 32-byte hex secret), NESLOS_NETWORK, NESLOS_VAULT_ACCOUNT, NESLOS_TEE_POLICY_FILE and NESLOS_INFERENCE_POLICY_FILE through the platform's encrypted environment mechanism.
6. Set NESLOS_DSTACK_SOCKET (default /var/run/dstack.sock) and NESLOS_JOURNAL (default /data/neslos-audit.json). Keep the journal persistent; it contains authenticated ciphertext, not plaintext keys.
7. Start npm run tee. Invalid/missing hardware evidence or measurements stop initialization.
8. The owner verifies a fresh GET /attestation/<64-hex-challenge> response, then pins that exact executor key in the vault. A self-reported readiness endpoint is not attestation.
9. Call privateCommand() from the owner-controlled client. It verifies hardware first, then HPKE-encrypts the job and authentication secret, and verifies/decrypts the reply.

The complete runtime uses a separate private process and **does not submit transactions automatically**. It prepares a signed, policy-bound authorization and a reviewable NEAR FunctionCall. The owner or an explicitly authorized relayer submits that call. The contract is the final spending authority.

After dispatch, the observe command checks the finalized vault record and the matching provider quote/status. It prepares an attested observer-signed settlement record; unknown results never resend funds. This is a trusted provider-status observation, not an independent cross-chain proof of delivery.

The testnet fixture vault is deployed. A provisioned TEE, independently pinned hardware executor, verified inference, and funded mainnet integration remain unverified; no example measurement is accepted as a real one. The testnet CLI does not connect the rehearsal browser to the private runtime.

## Dry confidential quote probe

    npm run quote:dry

This uses actual token discovery and the official signature verifier. The confidential endpoint returned HTTP 401 without a JWT during the 1 November probe. Set ONECLICK_JWT in the process environment or a local .env file. A missing token is displayed as a setup requirement. No public/unsigned quote is substituted for a confidential one.

## Independent receipt verification

The Audit trail page uses the browser's Web Crypto implementation, not a server's asserted result. Export the bundle and keep its signing key and checkpoint separately. The test of a tampered copy alters a local copy and must fail.

For hardware evidence:

    npm run verify:attestation -- evidence.json approved-measurements.json YOUR_FRESH_64_HEX_CHALLENGE

The nonce must be the verifier's challenge. Do not use a nonce supplied by an untrusted evidence provider.
