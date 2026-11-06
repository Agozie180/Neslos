import { z } from 'zod';
import { commitment } from '../core/crypto.js';
import { hashHex, nearAccount, type ChainPolicy } from '../core/wire.js';

const venue = z.enum(['near-intents', 'rhea-lending', 'rhea-dex', 'meta-pool', 'linear']);
export const ownerOpeningsSchema = z.object({
  venues: z.array(z.object({ name: venue, salt: hashHex }).strict()).min(1).max(16),
  counterparties: z.array(z.object({ name: z.string().min(1).max(60), recipient: nearAccount, salt: hashHex }).strict()).max(32),
}).strict().refine(v => [v.venues, v.counterparties].every(rows => new Set(rows.map(r => r.name)).size === rows.length), 'Local policy names must be unique.');
type Openings = z.infer<typeof ownerOpeningsSchema>;
const names = z.array(z.string().min(1).max(60)).min(1).max(32).refine(v => new Set(v).size === v.length, 'Selections must be unique.');
export const allowlistChangeSchema = z.object({ allowedVenues: names.optional(), allowedCounterparties: names.optional() }).strict();
export type AllowlistChange = z.infer<typeof allowlistChangeSchema>;

function rows(openings: Openings) {
  const parsed = ownerOpeningsSchema.parse(openings);
  return {
    venues: parsed.venues.map(v => ({ name: v.name, hash: commitment('venue', v.name, v.salt) })),
    counterparties: parsed.counterparties.map(c => ({ name: c.name, hash: commitment('counterparty', c.recipient, c.salt) })),
  };
}

/** Labels are local owner data. Salts never enter the browser response or chain plan. */
export function ownerAllowlists(policy: ChainPolicy, openings: Openings) {
  const r = rows(openings);
  return {
    venues: r.venues.map(v => ({ name: v.name, allowed: policy.venue_commitments.includes(v.hash) })),
    counterparties: r.counterparties.map(c => ({ name: c.name, allowed: policy.counterparty_commitments.includes(c.hash) })),
    venuesComplete: policy.venue_commitments.every(h => r.venues.some(v => v.hash === h)),
    counterpartiesComplete: policy.counterparty_commitments.every(h => r.counterparties.some(c => c.hash === h)),
  };
}
export type OwnerAllowlists = ReturnType<typeof ownerAllowlists>;

export function changeAllowlists(policy: ChainPolicy, openings: Openings, input: AllowlistChange): Pick<ChainPolicy, 'venue_commitments' | 'counterparty_commitments'> {
  const changes = allowlistChangeSchema.parse(input), r = rows(openings);
  const select = (selected: string[] | undefined, existing: string[], available: { name: string; hash: string }[]) => {
    if (selected === undefined) return [...existing];
    if (!existing.every(h => available.some(row => row.hash === h))) throw new Error('POLICY_OPENINGS_INCOMPLETE: restore the local details for every current member before editing this list.');
    const hashes = selected.map(name => {
      const row = available.find(row => row.name === name);
      if (!row) throw new Error('POLICY_UNKNOWN_MEMBER: only locally configured venues and recipients can be selected.');
      return row.hash;
    });
    if (new Set(hashes).size !== hashes.length) throw new Error('POLICY_DUPLICATE_COMMITMENT');
    return hashes;
  };
  return { venue_commitments: select(changes.allowedVenues, policy.venue_commitments, r.venues), counterparty_commitments: select(changes.allowedCounterparties, policy.counterparty_commitments, r.counterparties) };
}
