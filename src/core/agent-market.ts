import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { units } from './amounts.js';
import { canonical, sha256 } from './crypto.js';
import { NATIVE_USDC } from './research.js';
import { nearAccount } from './wire.js';

const positive = z.string().refine(value => { try { return units(value) > 0n; } catch { return false; } });
export const agentHandle = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
export const requirementSchema = z.object({
  scheme: z.literal('exact'), network: z.literal('near:mainnet'), asset: z.literal(NATIVE_USDC),
  amount: positive, payTo: nearAccount, maxTimeoutSeconds: z.number().int().min(60).max(4200),
}).passthrough();
export type AgentPaymentRequirement = z.infer<typeof requirementSchema>;
export const agentRequestSchema = z.object({ handle: agentHandle, messageId: z.string().uuid(), brief: z.string().min(10).max(12000) }).strict();
export type AgentRequest = z.infer<typeof agentRequestSchema>;
export const agentQuoteSchema = z.object({
  format: z.literal('neslos-agent-quote-v1'), request: agentRequestSchema, requirement: requirementSchema,
  quotedAt: z.iso.datetime(), maximumAmount: positive,
}).strict();
export type AgentQuote = z.infer<typeof agentQuoteSchema>;
export const agentQuoteHash = (quote: AgentQuote) => sha256(canonical(agentQuoteSchema.parse(quote)));
export const agentEndpoint = (handle: string) => `https://${agentHandle.parse(handle)}.market.near.ai/a2a/v1`;

const taskState = z.enum(['TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING', 'TASK_STATE_INPUT_REQUIRED', 'TASK_STATE_AUTH_REQUIRED', 'TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_REJECTED', 'TASK_STATE_UNKNOWN']);
const taskSchema = z.object({
  id: z.string().min(1).max(300), status: z.object({ state: taskState }).passthrough(),
  artifacts: z.array(z.object({ parts: z.array(z.object({ text: z.string().max(500000).optional() }).passthrough()).max(100) }).passthrough()).max(100).optional(),
}).passthrough();
export type AgentTask = z.infer<typeof taskSchema>;
const taskResult = z.object({ result: z.union([z.object({ task: taskSchema }).transform(v => v.task), taskSchema]) });

function message(request: AgentRequest) {
  const r = agentRequestSchema.parse(request);
  return { jsonrpc: '2.0', id: r.messageId, method: 'SendMessage', params: { message: { messageId: r.messageId, role: 'ROLE_USER', parts: [{ text: r.brief }] } } };
}
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('AGENT_EMPTY_RESPONSE');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) { await reader.cancel(); throw new Error('AGENT_RESPONSE_TOO_LARGE'); }
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('AGENT_INVALID_JSON'); }
  } finally { reader.releaseLock(); }
}

export class AgentMarketClient {
  constructor(private fetchImpl: typeof fetch = fetch) {}
  private async request(handle: string, body: unknown, payment?: string) {
    let response: Response;
    try {
      response = await this.fetchImpl(agentEndpoint(handle), {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(65000),
        headers: { accept: 'application/json', 'content-type': 'application/json', ...(payment ? { 'X-PAYMENT': payment } : {}) },
        body: JSON.stringify(body),
      });
    } catch { throw new Error(payment ? 'AGENT_PAYMENT_OUTCOME_UNKNOWN' : 'AGENT_CONNECTION_UNAVAILABLE'); }
    const value = await boundedJson(response);
    return { status: response.status, value, paymentResponse: response.headers.get('payment-response') ?? response.headers.get('x-payment-response') };
  }
  /** An unpaid 402 request only obtains terms. No signature or payment is sent. */
  async quote(request: AgentRequest, maximumAmount: string): Promise<AgentQuote> {
    positive.parse(maximumAmount);
    const result = await this.request(request.handle, message(request));
    if (result.status !== 402) throw new Error('AGENT_EXPECTED_PAYMENT_CHALLENGE');
    const challenge = z.object({ x402Version: z.literal(2), accepts: z.array(z.unknown()).min(1).max(20) }).parse(result.value);
    const rows = challenge.accepts.flatMap(row => { const parsed = requirementSchema.safeParse(row); return parsed.success ? [parsed.data] : []; });
    if (rows.length !== 1) throw new Error('AGENT_PAYMENT_RAIL_AMBIGUOUS');
    if (units(rows[0]!.amount) > units(maximumAmount)) throw new Error('AGENT_PRICE_EXCEEDS_LIMIT');
    return agentQuoteSchema.parse({ format: 'neslos-agent-quote-v1', request, requirement: rows[0], quotedAt: new Date().toISOString(), maximumAmount });
  }
  /** Caller MUST durably save the signature/reservation before invoking this once. */
  async dispatch(quote: AgentQuote, xPayment: string) {
    agentQuoteSchema.parse(quote);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(xPayment) || xPayment.length > 20000) throw new Error('AGENT_PAYMENT_ENCODING');
    const result = await this.request(quote.request.handle, message(quote.request), xPayment);
    if (result.status !== 200) throw new Error('AGENT_PAYMENT_OUTCOME_UNKNOWN');
    const body = taskResult.safeParse(result.value);
    if (!body.success) throw new Error('AGENT_PAYMENT_OUTCOME_UNKNOWN');
    return { task: body.data.result, paymentResponse: result.paymentResponse };
  }
  async task(handle: string, taskId: string) {
    z.string().min(1).max(300).parse(taskId);
    const result = await this.request(handle, { jsonrpc: '2.0', id: randomUUID(), method: 'GetTask', params: { id: taskId } });
    if (result.status !== 200) throw new Error('AGENT_TASK_UNAVAILABLE');
    const task = taskResult.parse(result.value).result;
    if (task.id !== taskId) throw new Error('AGENT_TASK_SUBSTITUTION');
    return { task, paymentResponse: result.paymentResponse };
  }
}

export function agentTaskSummary(task: AgentTask) {
  taskSchema.parse(task);
  const terminal = ['TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_REJECTED'].includes(task.status.state);
  const text = task.artifacts?.flatMap(a => a.parts.flatMap(p => p.text ? [p.text] : [])).join('\n') ?? '';
  return { state: task.status.state, terminal, delivered: task.status.state === 'TASK_STATE_COMPLETED' && text.trim().length > 0,
    resultHash: text ? sha256(text) : null, text,
    // A task state or provider header alone is not proof of an on-chain payment.
    settlementVerified: false as const };
}
