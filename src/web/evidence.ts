export const repository = 'https://github.com/Agozie180/Neslos';
export const source = (path: string) => `${repository}/blob/main/${path}`;

// Only sanitized archive fields needed by the review surface. Private prompts,
// receipt openings and credentials must never be added to this browser module.
// Keep this self-contained because the source evidence directory is deliberately
// excluded from hosted deployment bundles.
export const evidence = {
  format: 'neslos-review-index-v1',
  scope: 'Archived, separate verification runs. This index is not a new verification or an integrated payment proof.',
  vault: {
    date: '2026-11-06T11:58:58.099Z', network: 'testnet', account: 'vault.neslos.testnet',
    transactions: [
      { step: 'allowed', transactionHash: 'AtQ8joUuaVkeZsukPj6HLTaE5qj7ApMBFyNTJ3mWLNgX', success: true, explorer: 'https://testnet.nearblocks.io/txns/AtQ8joUuaVkeZsukPj6HLTaE5qj7ApMBFyNTJ3mWLNgX' },
      { step: 'daily-limit', transactionHash: '2MYWSFeJPo5zs3oRGnKx1UM186Tu52gskNG74NwNsgnN', success: false, expectedFailure: 'DAILY_LIMIT', explorer: 'https://testnet.nearblocks.io/txns/2MYWSFeJPo5zs3oRGnKx1UM186Tu52gskNG74NwNsgnN' },
      { step: 'replay', transactionHash: 'HkWPdR8g1KRRKtFZxwqNCcFcYir9ZdHdSb9YXYruH3JK', success: false, expectedFailure: 'NONCE', explorer: 'https://testnet.nearblocks.io/txns/HkWPdR8g1KRRKtFZxwqNCcFcYir9ZdHdSb9YXYruH3JK' },
    ],
    report: source('docs/VAULT-COMMERCE-DEPLOYMENT-2026-11-06.md'),
    record: source('deploy/testnet-commerce-proof-20261106.json'),
  },
  research: {
    date: '2026-11-09T16:15:54.354Z', passed: true,
    researchers: [
      { agent: 'lending', inference: 'verified-near-ai', assessments: 2, findings: 6 },
      { agent: 'liquidity', inference: 'verified-near-ai', assessments: 2, findings: 6 },
      { agent: 'risk', inference: 'verified-near-ai', assessments: 2, findings: 6 },
    ],
    signedOpeningVerified: true, wrongOwnerRejected: true, replayUnchanged: true,
    resultSha256: 'bb101e8984df9316dd1cfeee68f042ce0705fd69776027354d21195adbc0c837',
    report: source('docs/NEAR-PRIVATE-RESEARCH-2026-11-09.md'),
    record: source('deploy/near-private-research-20261109/record.json'),
  },
  settlement: {
    date: '2026-11-09T18:27:31.409Z', proofPassed: false,
    principal: '0.001', principalRestored: true,
    returnTransaction: 'C4o7c1XW35uHmrSmffYGMHaEfxyJEFZ6qdAspqQmipJB',
    charged: '0.0071149895375', cap: '0.004',
    report: source('docs/CONFIDENTIAL-SETTLEMENT-2026-11-09.md'),
    record: source('deploy/confidential-settlement-20261109/record.json'),
  },
} as const;

export function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
