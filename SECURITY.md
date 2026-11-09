# Security

Neslos is a hackathon implementation with automated adversarial tests, not an independently audited custody product. Read docs/PRIVACY.md for trust assumptions and visibility boundaries.

Do not put private keys, API tokens, counterparty salts, real private jobs or owner secrets in issues, logs, public audit exports or the repository. The .private directory and local .env files are ignored.

Sensitive reports should be shared privately with the repository owner through a contact channel they publish. No contact address is invented here.

Tests cover integer enforcement, concurrency, replay, scope and signature binding, owner authorization, failed dispatch, UTC day boundaries, public-action refusal, authenticated encryption, audit tampering and cross-session API access. They do not replace real TEE attestation, a funded execution observation, external dependency review or a security audit.

## Known dependency advisory

Rechecked on 9 November 2026 against the dependencies at `3aadd7e`: live `npm audit --omit=dev --json` still reports **three low-severity package entries arising from one advisory**, [GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84), in transitive `elliptic`. npm also marks `@phala/dcap-qvl` and `@nearai/inference-sdk` through that dependency chain. The installed versions have no automated fix available.

This is not a clean production dependency audit. The pinned attestation SDKs remain in place; replacing their cryptography with an unreviewed implementation would not establish safety. Review the advisory against the deployed verification path and adopt a tested upstream fix before using this as a custody product. Run the live audit again when preparing a deployment. An offline install or lockfile update that says “0 vulnerabilities” is not a substitute.

## Verification findings

The contract uses a bounded promise-result read. Only an actual failed FT receipt restores usage; an oversized successful result remains charged. The regression test covers this distinction, along with the original-day rule across midnight.

The official 1Click SDK's signature does not cover its `confidentiality` flag in version 0.1.26. Neslos requires the signed confidential recipient type and checks the full expected route over the fixed HTTPS endpoint. This does not independently attest provider-side processing. See [privacy analysis](docs/PRIVACY.md) and [test evidence](docs/PROOF.md).
