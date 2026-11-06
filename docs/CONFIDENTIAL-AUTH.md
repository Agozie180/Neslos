# Confidential Intents authentication

1Click has separate credentials for the integration and the account owner. A successful ownership proof and private-balance read do not establish access to confidential quotes or withdrawals.

| Endpoint | Credential and placement |
| --- | --- |
| `POST /v0/auth/authenticate` | Empty signed ownership intent in JSON `signedData`; no partner credential is required by its published OpenAPI. |
| `POST /v0/auth/refresh` | JSON `{ "refreshToken": "..." }`; no signature or authorization header in the published request. |
| `GET /v0/account/balances` | User-Session `accessToken` in `Authorization: Bearer ...`. |
| `GET /v0/account/history` | User-Session bearer token; history is separately invite-only. |
| `POST /v0/quote` | Partner JWT in `X-API-Key` (recommended), or legacy `Authorization: Bearer ...`. |
| `POST /v0/generate-intent` | Partner JWT in `X-API-Key`; the User-Session token is not used. |
| `POST /v0/submit-intent` | Partner JWT in `X-API-Key`, plus the user's signed spending intent in JSON. |
| `GET /v0/status` | Partner JWT in `X-API-Key` when authenticated; bind the returned signed quote to the original. |

The published quote specification does not define a separate `User-Session` or `X-User-Session` header. Its error text about required user authentication is not enough to establish such a header. General unauthenticated quoting carries an extra fee, but anonymous confidential quotes in this environment returned HTTP 401. A session token sent as the quote's bearer token returned `Invalid token`. A valid partner credential and any required provider permissions must be established with a no-spend quote before funding.

## Client credentials

`IntentsClient` accepts an explicitly typed integration credential:

```ts
new IntentsClient({ kind: 'partner-jwt', token: partnerJwt });
```

With no argument it uses `ONECLICK_JWT`, which must contain the **partner** JWT. Quotes and status requests send this as `X-API-Key`. Public token discovery sends no credentials. The constructor rejects a `user-session` credential and ambiguous raw strings; the token is held in a JavaScript private field so serializing the client does not expose it. The client does not load the owner's session file.

## Empty ownership proof

`src/owner/confidential-auth.ts` accepts the owner's existing Ed25519 signer and its expected implicit Intents identity. It checks the mainnet RPC network, reads `intents.near::current_salt` at finalized state, then validates the fixed audience, identity, deadline, timestamped versioned nonce and exactly empty `intents` array before signing. The salt must be read live: the documented `e110f317` constant differed from finalized mainnet state on 6 November 2026.

`raw_ed25519` signs the exact UTF-8 payload bytes, not their SHA-256 hash. A published SDK signature vector is independently checked in the tests. No account registration or spending action is included. The helper accepts HTTP 200 and 201 authentication success, saves tokens through the private file writer, and returns no token or signature. Optional error diagnostics contain only fixed local classifications.

The owner completed this empty-intent authentication and an authenticated private-balance read on 6 November 2026. That evidence establishes ownership authentication and a private account read; it is not a funded confidential settlement or an attested Neslos runtime proof. Account balances are not published.

## Session refresh and fund recovery

Refresh returns `{ accessToken, expiresIn }`. The refresh token does **not** rotate; retain its original expiration. Keep both tokens private and never send them to an arbitrary API host. The current helper has no refresh, deposit or spending method; a caller implementing refresh must preserve the account binding and private storage.

Withdrawing an embedded confidential balance requires a viable quote with `depositType: CONFIDENTIAL_INTENTS`, generation of a spending intent, owner validation/signing of that exact intent, and submission through the partner-authenticated API. There is no public NEAR RPC path for spending the private balance. A working User-Session does not replace that recovery path. Establish route availability, minimum amounts, fees, refund destination and any required NEP-141 storage registration before depositing.

## Official sources

- [API keys and end-user authentication](https://docs.near-intents.org/integration/distribution-channels/1click-api/authentication.md)
- [Authenticate with signed data](https://docs.near-intents.org/api-reference/user-auth/authenticate-user-with-signed-data.md)
- [Refresh access token](https://docs.near-intents.org/api-reference/user-auth/refresh-access-token.md)
- [Quote endpoint and its security schemes](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote.md)
- [Signed-intent execution and partner authentication](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/signed-intent-execution.md)
- [Provider-linked solver configuration](https://github.com/hairy-pointer/near-intents-amm-solver/blob/feat/confidential-amm-solver-mode/src/configs/one-click.config.ts): partner key in `X-API-Key`; user bearer token only for account balances.
- [SDK salt manager](https://github.com/defuse-protocol/sdk-monorepo/blob/main/packages/intents-sdk/src/intents/salt-manager.ts)
- [SDK raw signature vector](https://github.com/defuse-protocol/sdk-monorepo/blob/main/packages/intents-sdk/src/intents/intent-hash.test.ts)
- [Rust raw signature verifier](https://github.com/near/intents/blob/main/contracts/defuse/core/src/payload/raw.rs)
