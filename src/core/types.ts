export type ExecutionMode = 'rehearsal' | 'attested';
export type Privacy = 'confidential' | 'public';
export type IntentKind = 'private-payment' | 'allocation-reserve' | 'public-lending';
export type RunStatus = 'researching' | 'proposed' | 'checking' | 'blocked' | 'executing' | 'settling' | 'settled' | 'failed' | 'unknown';
export type AgentId = 'lending' | 'liquidity' | 'risk' | 'strategist' | 'guardian' | 'executor' | 'settlement';

export interface Policy {
  id: string;
  version: number;
  name: string;
  dailyLimit: string;
  perTransactionLimit: string;
  maxSlippageBps: number;
  allowedVenues: string[];
  allowedCounterparties: string[];
  requireConfidential: boolean;
  stablecoinsOnly: boolean;
  allowBridgedAssets: boolean;
  minimumLiquidityUsd: number;
  maxQuoteAgeSeconds: number;
  paused: boolean;
}

export interface Market {
  id: string;
  protocol: string;
  venue: string;
  symbol: string;
  tokenId: string;
  chain: 'NEAR';
  totalApy: number;
  baseApy: number;
  rewardApy: number;
  tvlUsd: number;
  liquidityUsd: number;
  utilization: number;
  stablecoin: boolean;
  bridged: boolean;
  sourceUrl: string;
  sourceMode: 'live' | 'reference';
  fetchedAt: string;
  upstreamObservedAt: string | null;
  risks: string[];
}

export interface ResearchResult {
  markets: Market[];
  sourceMode: 'live' | 'reference';
  sourceUrl: string;
  fetchedAt: string;
  upstreamObservedAt: null;
  notices: string[];
}

export interface RankedMarket extends Market {
  eligible: boolean;
  exclusions: string[];
  score: number;
}

export interface AgentReport {
  agent: AgentId;
  title: string;
  summary: string;
  findings: string[];
  marketIds: string[];
  sourceUrls: string[];
  completedAt: string;
  inference: 'deterministic' | 'verified-near-ai';
  assessments?: import('./strategy.js').MarketAssessment[];
}

export interface Proposal {
  id: string;
  policyId: string;
  policyVersion: number;
  nonce: string;
  kind: IntentKind;
  amount: string;
  asset: 'USDC';
  venue: string;
  strategyVenue?: string;
  counterparty: string;
  privacy: Privacy;
  slippageBps: number;
  quotedOutput: string;
  minimumOutput: string;
  quotedAt: number;
  expiresAt: number;
  opportunityId?: string;
  purpose: string;
  mode: ExecutionMode;
}

export interface PolicyCheck {
  code: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface GuardianDecision {
  allowed: boolean;
  checks: PolicyCheck[];
  checkedAt: string;
  policyVersion: number;
}

export interface BudgetSnapshot {
  day: string;
  spent: string;
  reserved: string;
  remaining: string;
  balance: string;
  nextNonce: string;
  reservations: number;
}

export interface MissionRequest {
  requestId: string;
  prompt: string;
  amount: string;
  kind: IntentKind;
  counterparty: string;
  attack?: 'overspend' | 'counterparty' | 'slippage' | 'privacy' | 'stale-quote';
  referenceOnly?: boolean;
}

export interface RunStep {
  id: string;
  label: string;
  status: 'waiting' | 'active' | 'complete' | 'blocked' | 'failed';
  detail: string;
  timestamp?: string;
}

export interface MissionRun {
  id: string;
  requestId: string;
  prompt: string;
  kind: IntentKind;
  status: RunStatus;
  mode: ExecutionMode;
  createdAt: string;
  updatedAt: string;
  steps: RunStep[];
  reports: AgentReport[];
  research?: ResearchResult;
  ranking?: RankedMarket[];
  strategy?: import('./strategy.js').StrategyDecision;
  proposal?: Proposal;
  decision?: GuardianDecision;
  receiptId?: string;
  settlement?: { status: 'REHEARSAL_SUCCESS' | 'UNKNOWN' | 'FAILED'; transactionHash: null; message: string };
  error?: string;
}

export interface SealedData { algorithm: 'AES-256-GCM'; iv: string; ciphertext: string; tag: string }
export interface AuditEntry {
  index: number;
  id: string;
  runId: string;
  type: string;
  createdAt: string;
  mode: ExecutionMode;
  previousHash: string;
  sealed: SealedData;
  hash: string;
  signature: string;
}
export interface AuditExport {
  format: 'neslos-audit-v1';
  publicKey: string;
  entries: AuditEntry[];
  checkpoint: string;
  scope: 'session-rehearsal' | 'attested-executor';
}
