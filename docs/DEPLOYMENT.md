# Deployment and verification

The [public rehearsal](https://neslos.vercel.app) and local application are ready to run. The separate private runtime completed [verified NEAR AI research inside TDX on 9 November](NEAR-PRIVATE-RESEARCH-2026-11-09.md), including encrypted audit and restart persistence. Its temporary server was deleted after verification to stop hosting charges. The demo and archived evidence remain available without continuous TDX hosting.

For the implemented private owner CLI, dedicated TEE image, bootstrap, audit access and transaction workflow, use the [TEE runbook](TEE-RUNBOOK.md). It also records dated free-credit options to recheck before a new deployment. The sections below retain contract/testnet setup and the underlying configuration model.

The 6–7 November inline provisioning attempts are [historical investigations](TDX-DEPLOYMENT-STATUS.md#historical-attempts-and-audits); standard-image deployments subsequently succeeded. Their earlier provider response is no longer the current deployment status. For public vault commerce and the testnet vault's reviewed, state-preserving upgrade procedure, see [Vault commerce](COMMERCE.md). The rehearsal API remains separate from funded owner controls.

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

The rehearsal is live at **https://neslos.vercel.app**. Vercel builds the Vite frontend with `npm run build:web`, serves `dist/web`, rewrites `/api/*` to `api/index.ts`, and rewrites `/owner` to the SPA entry. The API entry exports the existing Express application, permits the configured Vercel origins, persists rehearsal sessions in Vercel Runtime Cache and registers mission work with `waitUntil` so a 202 response does not suspend execution. Browser affinity reduces routing churn but is not relied upon for durability. The function includes the reference dataset and has a 60-second limit. No TEE or owner signing credentials are required for this public rehearsal.

Production includes the cross-instance session repair and owner-route rewrite identified by the earlier hosted review. Runtime Cache stores only the simulated rehearsal session and has a two-hour TTL; it is not an owner journal or funded execution record. In PowerShell, run `$env:NESLOS_E2E_URL='https://neslos.vercel.app'` followed by `npm run test:browser` to reproduce the hosted browser checks. Exact current and historical results remain in [PROOF](PROOF.md).

The Dockerfile builds a standalone Node application. Set HOST=0.0.0.0 and PORT as required by the host. Behind HTTPS, set NODE_ENV=production and NESLOS_PUBLIC_ORIGIN to the exact public HTTPS origin. Production cookies require HTTPS.

Locally, the application uses isolated in-memory rehearsal sessions. On Vercel, the same bounded state is serialized to Runtime Cache so another function instance can restore it; the two-hour TTL still makes it temporary demo state. The public rehearsal is the hosted demo to keep available through judging. The private TDX proof uses archived evidence and optional finite verification sessions, with no requirement to keep a paid CVM running.

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

The plan fixes `vault.<owner>` and `token.<owner>`, 3 and 2 testnet NEAR respectively, the exact WASM hashes, and a paused vault with 500/day and 200/action test-token limits. Deployment preserves at least 1 testnet NEAR in the owner account. The proof transfers 150 test tokens, checks overspending and replay rejection, confirms a failed transfer restores allowance, lowers/restores policy without resetting consumption, records settlement, and finishes with pause and a 50-token owner withdrawal. These are public test-token transactions, not USDC or cross-chain settlement. The fixture is not standards-complete or listed by Rhea and must not be reused as a lending asset; use a separately initialized vault or owner-wallet proof with a Rhea-supported token.

Signed transaction bytes are saved before broadcast under `.private/testnet/transactions`. A repeated operation checks its saved hash rather than signing another payment. Proof recovery requires a contiguous sequence of finalized, expected receipts and matching on-chain policy, nonce, balances, and records. A different state, an unresolved transaction, a UTC-day change after spending, or an emergency-pause record stops recovery. Preserve the whole private directory; deleting a journal is not a recovery procedure. Repeating a fully completed proof reconciles evidence without making new transfers.

On this Windows workspace, run through Ubuntu WSL:

```powershell
wsl.exe -d Ubuntu -- bash /mnt/c/Users/USER/Neslos/scripts/ubuntu.sh verify
wsl.exe -d Ubuntu -- bash /mnt/c/Users/USER/Neslos/scripts/ubuntu.sh test:browser
wsl.exe -d Ubuntu -- bash /mnt/c/Users/USER/Neslos/scripts/ubuntu.sh test:contract
wsl.exe -d Ubuntu -- bash /mnt/c/Users/USER/Neslos/scripts/ubuntu.sh testnet -- status
```

The wrapper syncs source into `$HOME/.cache/neslos-ubuntu`, uses Linux dependencies/builds, and selects rustup's Cargo even in a non-login shell. It locks that workspace with `flock`; run tasks sequentially. It copies back only changed evidence belonging to the current task and records the task, source identity, exit code and copied paths in `artifacts/wsl-run.json`. A failed or unrelated command cannot restore unchanged cached success reports.

The sync excludes `.env` and `.private`. Its default owner credential is the existing Windows `.private/near/testnet/neslos.testnet.json`; generated executor keys and transaction journals stay in the Linux workspace's `.private/testnet`. Retain that directory across resumes. Install Playwright's Chromium in Ubuntu before browser checks; the Windows download cannot be used there. Docker is not needed for this workflow.

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
4. Provide an inference policy with an approved modelId, independently derived model boot registers and OS/Compose hashes, and reviewed Compose Manager source/history. Choose either gateway boot/Compose approval or the strict direct NEAR policy with exact TLS/signer/instance pins, expiry and explicit provider-administration trust. Its schema is inferencePolicySchema; see the [current policy requirements](TEE-RUNBOOK.md#enable-private-research).
5. Inject NEARAI_API_KEY, ONECLICK_JWT, NESLOS_OWNER_TOKEN (a random 32-byte hex secret), NESLOS_NETWORK, NESLOS_VAULT_ACCOUNT, NESLOS_TEE_POLICY_FILE and NESLOS_INFERENCE_POLICY_FILE through the platform's encrypted environment mechanism. File-based policies must be mounted inside the container at those paths; for encrypted policy values, use `NESLOS_TEE_POLICY_JSON` and `NESLOS_INFERENCE_POLICY_JSON` instead, as in the [runbook](TEE-RUNBOOK.md#enable-private-research). `ONECLICK_JWT` is needed for confidential quotes, not research-only commands.
6. Set NESLOS_DSTACK_SOCKET (default /var/run/dstack.sock) and NESLOS_JOURNAL (default /data/neslos-audit.json). Keep the journal persistent; it contains authenticated ciphertext, not plaintext keys.
7. Start npm run tee. Invalid/missing hardware evidence or measurements stop initialization.
8. The owner verifies a fresh GET /attestation/<64-hex-challenge> response, then pins that exact executor key in the vault. A self-reported readiness endpoint is not attestation.
9. Call privateCommand() from the owner-controlled client. It verifies hardware first, then HPKE-encrypts the job and authentication secret, and verifies/decrypts the reply.

The private runtime uses a separate process and **does not submit transactions automatically**. It prepares a signed, policy-bound authorization and a reviewable NEAR FunctionCall. `npm run private -- plan` reconstructs and checks that call; `submit` requires the exact plan hash and uses durable transaction recovery. Owner policy, executor pinning, pause and withdrawal use the same workflow. The contract is the final spending authority. See the runbook for the complete commands and testnet-only private research.

After dispatch, the observe command checks the finalized vault record and the matching provider quote/status. It prepares an attested observer-signed settlement record; unknown results never resend funds. This is a trusted provider-status observation, not an independent cross-chain proof of delivery.

Keep the same command ID and identical payload when recovering an interrupted request: the runtime returns its persisted result. Give each **new settlement poll a fresh UUID**, including after a pending result. Reusing an observation ID intentionally returns the original observation. `KNOWN_DEPOSIT_TX` is pending and does not prepare an Unknown settlement call.

Authorizations are released only after the encrypted journal is persisted; Linux also syncs its directories after atomic writes. If persistence fails, the process refuses subsequent private commands with `JOURNAL_UNAVAILABLE`. Restore writable durable storage, retain the manifest and complete segment directory, and restart to recover from disk. Do not delete history to bypass recovery or reset inference credit. Immutable segments support bounded rotation up to 128 MB and 10,000 completed/failed commands. See the [backup and recovery procedure](OWNER-WORKSPACE.md#journal-backup-and-recovery). Authenticated requests that expire while queued are rejected before execution starts.

The testnet fixture vault is deployed. [Private NEAR AI research passed inside independently verified TDX on 9 November](NEAR-PRIVATE-RESEARCH-2026-11-09.md), including signed reports, audit opening, restart persistence and budget rejection. That finite CVM is retired and the vault restored paused at version 13. The direct policy explicitly trusts provider deployment/weight administration; funded mainnet integration remains unverified. The testnet CLI does not connect the rehearsal browser to the private runtime.

## Dry confidential quote probe

    npm run quote:dry

This uses actual token discovery and the official signature verifier. The confidential endpoint returned HTTP 401 without a JWT during the 1 November probe. Set ONECLICK_JWT to the **partner JWT** in the process environment or a local .env file; the client sends it as `X-API-Key`. An owner's User-Session token is for private account reads and must not replace the partner credential. See [Confidential Intents authentication](CONFIDENTIAL-AUTH.md) for endpoint-specific credentials and recovery requirements. A missing token is displayed as a setup requirement. No public/unsigned quote is substituted for a confidential one.

## Independent receipt verification

The Audit trail page uses the browser's Web Crypto implementation, not a server's asserted result. Export the bundle and keep its signing key and checkpoint separately. The test of a tampered copy alters a local copy and must fail.

For hardware evidence:

    npm run verify:attestation -- evidence.json approved-measurements.json YOUR_FRESH_64_HEX_CHALLENGE

The nonce must be the verifier's challenge. Do not use a nonce supplied by an untrusted evidence provider.
