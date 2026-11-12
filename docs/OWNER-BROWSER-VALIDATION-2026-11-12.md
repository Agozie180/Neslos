# Live owner-browser validation — 12 November 2026

The local owner browser completed a live session against a freshly provisioned and independently verified Intel TDX runtime. This was not a fixture-backed browser test. The runtime targeted NEAR testnet and `vault.neslos.testnet`; inference was disabled, so the validation made zero model calls and moved no funds.

The fresh quote reported Intel/DCAP `UpToDate`, debug mode off, nonce/key binding, matching independently calculated boot measurements and a complete replay of all 11 RTMR3 runtime events. The exact provider-prepared Compose hash was `27537f152eb9b128105feaf133d3301d085aa37f891a310a498f76dbec04bc6f`.

The browser then:

- loaded finalized `vault.neslos.testnet` state through the real local owner server;
- verified fresh executor evidence against the approved measurements and pinned executor key;
- read the runtime credit status and confirmed inference was disabled with zero calls;
- fetched and verified the signed private audit in browser code;
- privately opened a safe denial receipt for an unknown authorization;
- reloaded and re-established verification without losing the local owner session;
- recorded no browser page errors.

The denial request observed a nonexistent authorization hash. It signed no transaction, used no inference and moved no token or NEAR. The retained private browser result is `.local/owner-browser-20261112/browser-result.json`; private tokens, audit openings and operational evidence remain excluded from Git.

The temporary CVM was deleted immediately after validation. A read-only cloud check at `2026-11-12T13:46:15.592Z` returned zero active instances. The provider balance changed from `4.903805` to `4.892307` during the session; that `0.011498` difference is an observed account-balance change, not a reconciled invoice. The existing conservative budget retains a full one-hour hosting reservation.

This closes the live owner-browser-to-private-runtime validation gap. It does not establish a funded private payment or a funded lending position.
