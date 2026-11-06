# Neslos status — 6 November 2026

**Implemented and locally verified; integrated private execution is not yet demonstrated.** The [foundation audit](AUDIT-2026-11-06.md) records exact findings, fixes and limitations.

| Layer | Current evidence |
| --- | --- |
| Application/private-runtime software | 285 tests, strict TypeScript and production builds pass in Ubuntu WSL |
| Browser | 6 desktop/mobile tests pass; rehearsal and fixture-backed owner workflows |
| Contract | 13 Rust tests and one local NEAR sandbox suite pass; resume now requires the reviewed version |
| TEE package | Updated Linux/amd64 image builds and passes restricted-container fake-hardware rejection; not a genuine TDX deployment |
| Public testnet | Existing paused fixture-token vault and historical 12-step proof; deployed code predates the resume fix |
| Private infrastructure | Credentials authenticate; zero CVMs in the current Phala inventory |
| Live data | 10 normalized live Rhea markets, 2 default-policy eligible; lending reader works |
| Private settlement | Genuine TDX, encrypted inference, confidential quote and funded settlement still unverified |
| Publishing | GitHub repo private; configured demo URL returns 404; no submission evidence established |

Application, contract and browser reports share source digest `92a2e68f5c5ddf2308f037c358a95b2ac5c23d08f3dafef254528a316e2d8284`, based on `482de6a` plus this working tree. [Remote CI](https://github.com/Agozie180/Neslos/actions/runs/41851897787) passed at the base revision and does not cover these changes. [Verification record](PROOF.md).

Current compiled vault SHA-256: `c15ce323dccfc8d7f8d026c1e9bc51f8ef383b61065cd4682b8579cae6a32c46`. The testnet vault still uses `196460a40676c7901143a9adf63ce61f63e25bf862e0acb4d9d51ff491e32b73`. No chain deployment was performed by this audit.

Owner browser/CLI features include exact transaction review, policy allowlists, storage/funding, private research/audit, finite research/observation schedules and retained-hash recovery. Schedules never submit payments. Public owner-wallet lending and paid-agent adapters are separate experiments; neither runs behind the vault or inside its TEE.

Next: deploy and independently verify the private runtime, demonstrate one bounded private vault payment, resolve external freshness for hostile-host credit accounting, publish evidence, then complete the human-confirmed submission. Deadline: **14 November 2026, 23:59 UTC / 15 November, 00:59 Lagos**.
