# Phala response and corrected request — 7 November 2026

> Historical snapshot. Later standard-image deployments succeeded, and [private NEAR AI research, audit and restart verification passed on 9 November](NEAR-PRIVATE-RESEARCH-2026-11-09.md). Those temporary CVMs are retired. Earlier deployment, publication, inference and submission statements below describe this stage; see [current status](STATUS.md) for remaining work.

**The size-corrected attestation-only request was rejected with the same HTTP 400 policy message. No Neslos CVM was committed.** The owner's earlier browser/device-code login succeeded; the deployment helper used its saved official profile. The account still authenticates, reports the owner's $5 hackathon testing credit and returns zero CVMs. This follow-up supersedes the earlier requirement to wait for provider pre-approval and the assumption that a new registry login is necessary.

**Later local repair:** the [startup integrity audit](TDX-STARTUP-AUDIT-2026-11-07.md) replaces the candidate with V3, which checks installed dependency bytes and rejects extra application paths before import. Its Compose is 150,387 bytes. The V2 submission evidence below remains historical; V3 has not been submitted.

The [subsequent rejection audit](PHALA-REJECTION-AUDIT-2026-11-07.md) confirms active billing, verified ownership/email, unused quotas and exact SDK body parity. These checks narrow the remaining uncertainty to undisclosed provider eligibility; they do not establish the exact triggering rule.

## Provider response

The owner supplied correspondence attributed to Phala's Leechael. It states that Phala does not disclose which check caused a rejection, account state may affect eligibility, tag-plus-digest image references are supported, and unsubmitted requests cannot receive pre-review or pre-approval. It invites users who believe their application complies with the [Terms](https://phala.com/terms) to submit through the console. No additional audit attachments are requested.

The reply is retained in `.local/tdx-console-20261107/provider-reply.txt`. It was supplied by the owner; this agent did not send the support message or independently retrieve the conversation. The reply is not an approval of Neslos or a guarantee that another request will succeed.

The fetched terms display “Last Updated: Jun 18, 2025.” Sections 3 and 7.4 restrict cryptocurrency mining, reward-producing compute, and specified proxy/VPN/tunneling workloads. The prepared first stage only serves health and hardware-attestation requests for this testnet development deployment. It performs no mining, reward-network work, paid inference, investment execution or settlement. The runtime mode and testnet target are literal measured values, with runtime secrets empty. The private research and payment stages remain disabled and require separate readiness review; this limited technical review does not establish Phala's undisclosed classification result.

## Confirmed local repair

The inline bundler now supports `--compact`, using Brotli and direct UTF-8 storage for text within the compressed archive. Binary files retain base64 encoding. All file bytes, including the complete original `package.json` and lockfile, remain identical to the checked build. No dependencies were removed, versions changed, source renamed, or safeguards disabled to produce the smaller bundle.

| Item | Checked value |
| --- | --- |
| Compose size | **146,642 bytes**, 58,158 below the 204,800-byte limit |
| Compressed archive | 103,641 bytes; 50 files |
| Compose SHA-256 | `5790bca5bbd949a7aaf02693b6aedf5e613ba7d9bbe52bd59c3fc8983a36b64b` |
| Archive SHA-256 | `8d3d10f2c894b57f8f128a0144dcfd8e6aae2ad694e9b82edf8291e2b4e2fa79` |
| Source-content digest | `1d3ebcc00e5e0c57253bbdec11a69daf1a936073130f2e6446b38e8340d2b849` |
| Image | Original official Node 24.22.2 tag and digest; no custom registry required |
| Target | `testnet`, `vault.neslos.testnet`, owner `neslos.testnet` |
| Mode | `attestation-only`; encrypted-environment updates cannot enable private mode in this bundle |

The table identifies the submitted V2 artifact. To build the current V3 format with the pinned Node and installed dependencies:

```sh
npm run verify
node scripts/tee-dependencies.mjs --out NEW_DEPENDENCY_MANIFEST.json
node scripts/tee-inline-bundle.mjs --compact \
  --dependencies NEW_DEPENDENCY_MANIFEST.json \
  --testnet-vault vault.neslos.testnet --attestation-only \
  --out NEW_PRIVATE_DIRECTORY
```

Both default gzip and compact Brotli modes now emit V3 with a required dependency receipt. Both enforce the combined Compose/prelaunch size limit before writing deployment files. The manifest records the archive format, compression, source, target, file hashes, dependency digest and fixed runtime mode. Text/binary reconstruction, corrupted payload rejection, tampered-file rejection, invalid testnet targets and secret exclusion are tested.

**579 application tests passed, four Windows platform tests skipped, and TypeScript/production builds passed.** Verification run: `a6604dda-2d67-4e64-8e08-a38501eddb0d`. The actual generated setup ran in Linux and installed 209 packages with lifecycle scripts disabled. Its reconstructed runtime then passed the read-only, capability-dropped, network-disabled container checks as UID 1000: the private endpoint returned 503 and fake hardware was rejected. Test volumes and network were removed after checking their project labels. These checks establish packaging behavior, not genuine hardware execution.

The submitted V2 deployment checked the application and lockfile but omitted installed dependency files. That reproduced startup gap is fixed in V3; the [separate audit](TDX-STARTUP-AUDIT-2026-11-07.md) records the threat boundary and current verification evidence. This change does not alter the rejected V2 artifact.

## Corrected submission result

After the provider reply and local verification, one corrected request was sent to the **same** `POST /api/v1/cvms/provision` endpoint, using the same account, application name `neslos-tdx-20261106`, `tdx.small`, 20 GB disk, stable `dstack-0.5.12` and `PHALA` KMS. The new measured bundle fixes the size defect and restricts the first stage. The official `@phala/cloud` full-request schema accepted it offline. No endpoint rotation, account change or retry loop was used.

The API returned HTTP **400** at HTTP Date `Sat, 07 Nov 2026 11:57:57 GMT`:

```json
{"detail":"You are not allowed to deploy the target applications since it violates our terms of use."}
```

The response's request ID is `aa623dcc09a5439de6de5010d470d336` (duplicated in the header). Exact submitted JSON body SHA-256: `fb8e93434c0f4cdeb3c11504377a9551efe133872fed4dea623d239e99cd6386`. The raw response and selected headers are preserved privately. The one-shot helper records an attempt before sending and refuses repeat execution.

This result proves that **correcting the size defect was insufficient**. It does not establish that the historical request and corrected request matched the same rule, explain the account's eligibility, or prove an account-wide ban. The full-image alternative has still not been submitted. No further automated variants were attempted.

## Current continuation boundary

Phala specifically suggested a console **deployment submission**. The earlier console/device-code **login succeeded**. A browser deployment submission is not established by the retained records, and the current background browser connection is unavailable. The directory name `.local/tdx-console-20261107/` does not imply a browser submission: its helper sent V2 programmatically using the saved login profile. The current candidate is `.local/tdx-startup-audit-20261107/bundle/compose.yaml`; retain the V2 files as historical evidence. Provider acceptance must be observed before claiming deployment. There is no additional support packet to send or pre-approval to wait for.

No hosting commitment, paid inference call or chain transaction was made. The existing vault remains the target; it does not need redeployment. The combined budget remains $3, including no more than $2.75 hosting and $0.25 inference. Any accepted launch needs bounded teardown before private work; Phala is post-paid. The upstream shared-key/model-routing issue and unapproved model history remain independent of hosting.
