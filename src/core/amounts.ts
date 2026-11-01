export const USDC_DECIMALS = 6;
export const U128_MAX = (1n << 128n) - 1n;

export function units(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('Amount must be an unsigned canonical integer string.');
  const result = BigInt(value);
  if (result > U128_MAX) throw new Error('Amount exceeds u128.');
  return result;
}

export function parseUsdc(value: string): string {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value)) throw new Error('Enter a positive amount with at most 6 decimal places.');
  const [whole = '0', fraction = ''] = value.split('.');
  const amount = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  if (amount > U128_MAX) throw new Error('Amount exceeds u128.');
  return amount.toString();
}

export function formatUsdc(value: string, decimals = 2): string {
  const amount = units(value);
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, '0');
  return whole.toLocaleString('en-US') + (decimals ? '.' + fraction.slice(0, Math.min(6, decimals)) : '');
}

export function minimumOutput(quoted: string, slippageBps: number): string {
  if (!Number.isSafeInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) throw new Error('Invalid slippage.');
  // Round up: even one base unit below the rational floor would exceed a hard limit.
  return ((units(quoted) * BigInt(10_000 - slippageBps) + 9_999n) / 10_000n).toString();
}

export function utcDay(now: number): string { return new Date(now).toISOString().slice(0, 10); }
