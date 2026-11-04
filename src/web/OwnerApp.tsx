import { useEffect, useState, type FormEvent } from 'react';
import { Activity, ArrowRight, CheckCircle2, Download, Fingerprint, LoaderCircle, LockKeyhole, RefreshCw, ShieldCheck, Wallet } from 'lucide-react';
import type { OwnerPlan, OwnerState } from '../owner/workspace.js';
import type { PrivateJob } from '../owner/private.js';
import type { AgentReport, AuditExport } from '../core/types.js';
import type { StrategyDecision } from '../core/strategy.js';
import { formatUsdc, parseUsdc } from '../core/amounts.js';
import { verifyInBrowser } from './verify.js';
import { FundingPanel, SchedulePanel } from './OwnerTools.js';

type State = OwnerState & { csrf: string };
async function call<T>(path: string, csrf?: string, body?: unknown): Promise<T> {
  const response = await fetch('/api/owner' + path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(csrf ? { 'x-neslos-csrf': csrf } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(150000) });
  const result = await response.json();
  if (!response.ok) throw new Error([result.error, result.detail].filter(Boolean).join(': '));
  return result;
}
function exportJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}
const short = (text: string) => text.slice(0, 10) + '…' + text.slice(-6);
const nanoMoney = (value: string) => '$' + (Number(BigInt(value)) / 1e9).toFixed(4);

export function OwnerApp() {
  const [state, setState] = useState<State>();
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'research' | 'policy' | 'audit'>('research');
  const [prompt, setPrompt] = useState('Compare eligible NEAR stablecoin markets and challenge their exit-liquidity risks.');
  const [mode, setMode] = useState<'research' | 'prepare'>('research'), [kind, setKind] = useState<'allocation-reserve' | 'private-payment'>('allocation-reserve');
  const [amount, setAmount] = useState('1'), [counterparty, setCounterparty] = useState('');
  const [job, setJob] = useState<PrivateJob>(), [plan, setPlan] = useState<OwnerPlan>(), [allowMainnet, setAllowMainnet] = useState(false);
  const [attested, setAttested] = useState(false);
  const [runtime, setRuntime] = useState<{ ready: boolean; inference: { totalNanoUsd: string; dayNanoUsd: string; calls: number; limits: { totalLimitNanoUsd: string; maxCalls: number } } }>();
  const [audit, setAudit] = useState<AuditExport>(), [opening, setOpening] = useState<unknown>(), [auditStatus, setAuditStatus] = useState('');
  const [daily, setDaily] = useState(''), [perAction, setPerAction] = useState(''), [slippage, setSlippage] = useState(50), [outputAssets, setOutputAssets] = useState(''), [confidential, setConfidential] = useState(true);
  const [withdraw, setWithdraw] = useState('1');
  async function refresh() {
    const next = await call<State>('/state'); setState(next);
    if (next.chain) { const p = next.chain.config.policy; setDaily(formatUsdc(p.daily_limit, 6).replaceAll(',', '')); setPerAction(formatUsdc(p.per_action_limit, 6).replaceAll(',', '')); setSlippage(p.max_slippage_bps); setOutputAssets(p.output_assets.join('\n')); setConfidential(p.require_confidential); }
    setCounterparty(value => value || next.counterparties[0]?.name || '');
  }
  useEffect(() => { void (async () => {
    const token = new URLSearchParams(location.hash.slice(1)).get('token');
    if (token) { history.replaceState(null, '', '/owner'); await call('/session', undefined, { token }); }
    await refresh();
  })().catch(e => setError(e.message)); }, []);
  async function act(work: () => Promise<void>) { setBusy(true); setError(''); setNotice(''); try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function makePlan(path: string, body: unknown) { setPlan(await call<OwnerPlan>(path, state!.csrf, body)); setAllowMainnet(false); await refresh(); }
  async function launch(event: FormEvent) {
    event.preventDefault(); await act(async () => {
      const id = crypto.randomUUID();
      try { setJob(await call<PrivateJob>('/jobs', state!.csrf, { id, type: mode, prompt, kind, ...(mode === 'prepare' ? { amount: parseUsdc(amount), counterparty } : {}), research: { stablecoinsOnly: true, allowBridgedAssets: false, minimumLiquidityUsd: 100000 } })); }
      finally { await refresh(); }
    });
  }
  async function loadAudit() {
    const bundle = await call<AuditExport>('/audit', state!.csrf, {});
    const checkpointKey = 'neslos-owner-checkpoint:' + state!.executorPublicKey;
    const retained = localStorage.getItem(checkpointKey) ?? undefined;
    const verified = await verifyInBrowser(bundle, state!.executorPublicKey!, retained);
    if (!verified.valid) throw new Error(verified.reason);
    localStorage.setItem(checkpointKey, bundle.checkpoint); setAudit(bundle); setAuditStatus(`${verified.checked} receipts verified against the configured executor and retained checkpoint.`);
  }
  const result = job?.result as { reports?: AgentReport[]; strategy?: StrategyDecision; transaction?: unknown; signed?: unknown; disclosure?: string } | undefined;
  return <main className="owner-shell">
    <header className="owner-header"><a href="/owner" className="owner-brand">neslos<span>.</span></a><div><span className="badge green"><LockKeyhole size={12} /> Local owner workspace</span><span className="badge">{state?.network ?? 'Connecting'}</span></div></header>
    <div className="page-heading"><div><div className="eyebrow">PRIVATE RESEARCH. REVIEWED ACTIONS.</div><h1>Your treasury, connected<span className="heading-dot">.</span></h1><p>Inspect the real vault, verify the executor, and approve exact transactions.</p></div><button className="button secondary" disabled={busy || !state} onClick={() => void act(refresh)}><RefreshCw size={15} /> Refresh state</button></div>
    {error && <div role="alert" className="verification-result invalid"><strong>{error}</strong></div>}
    {notice && <div role="status" className="verification-result valid"><CheckCircle2 size={18} />{notice}</div>}
    {!state ? <section className="panel owner-section"><LoaderCircle className="spin" /><p>{error ? 'Start the local owner server and open the private link it prints.' : 'Reading your local owner configuration…'}</p></section> : <>
      <div className="mode-strip"><ShieldCheck size={16} /><span><strong>{state.vault}</strong> · {state.chain ? `Finalized block ${state.chain.blockHeight}` : 'Chain state unavailable'}</span><span className="badge">{state.chain?.config.policy.paused ? 'Spending paused' : 'Check policy'}</span></div>
      {state.chainError && <p role="alert" className="error-text">{state.chainError}</p>}
      <div className="metrics owner-metrics">
        <div className="metric"><div className="metric-label">Vault balance <Wallet size={16} /></div><div className="metric-value">{state.chain ? formatUsdc(state.chain.balance) : '—'}</div><div className="metric-foot">{state.network === 'mainnet' ? 'USDC' : 'test tokens'}</div></div>
        <div className="metric"><div className="metric-label">Daily allowance remaining</div><div className="metric-value">{state.chain ? formatUsdc(state.chain.budget.remaining) : '—'}</div><div className="metric-foot">Policy v{state.chain?.config.policy_version ?? '—'} · nonce {state.chain?.budget.next_nonce ?? '—'}</div></div>
        <div className="metric"><div className="metric-label">Inference budget reserved</div><div className="metric-value">{runtime ? nanoMoney(runtime.inference.totalNanoUsd) : '—'}</div><div className="metric-foot">{runtime ? `of ${nanoMoney(runtime.inference.limits.totalLimitNanoUsd)} · ${runtime.inference.calls} calls` : 'Check the private runtime to inspect its limit'}</div></div>
      </div>
      <section className="panel owner-section"><div className="panel-heading"><div><h2>Private runtime</h2><p>{state.configured ? state.endpoint : 'Connect an independently verified runtime to enable private commands.'}</p></div><span className={'badge ' + (attested ? 'green' : 'amber')}>{attested ? 'Identity verified this session' : 'Verification needed'}</span></div><div className="owner-actions">
        <button className="button secondary" disabled={busy || !state.configured} onClick={() => void act(async () => { setAttested(false); await call('/attest', state.csrf, {}); setAttested(true); setNotice('Fresh hardware evidence matches your approved executor.'); })}><ShieldCheck size={15} /> Verify executor</button>
        <button className="button secondary" disabled={busy || !state.configured} onClick={() => void act(async () => { setRuntime(await call('/runtime-status', state.csrf, {})); })}><Activity size={15} /> Check credit limits</button>
        {!state.configured && <p className="fine-print">Use the private setup workflow to save the approved runtime, owner token, and recipient openings. Your account keys stay on this computer.</p>}
      </div></section>
      <nav className="owner-tabs" aria-label="Owner workspace navigation">{(['research', 'policy', 'audit'] as const).map(t => <button className={'button ' + (tab === t ? 'primary' : 'secondary')} key={t} onClick={() => setTab(t)}>{t === 'research' ? 'Research & activity' : t === 'policy' ? 'Vault controls' : 'Private audit'}</button>)}</nav>
      {tab === 'research' && <div className="owner-columns"><div>
        <section className="panel owner-section"><h2>Give your researchers an objective</h2><p className="muted">Research reads evidence without moving funds. A payment preparation produces a separate reviewable plan.</p><form className="owner-form" onSubmit={launch}>
          <label>Objective<textarea value={prompt} onChange={e => setPrompt(e.target.value)} minLength={5} maxLength={1600} rows={4} required /></label>
          <label>Action<select aria-label="Private action" value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="research">Private research only</option><option value="prepare">Prepare a payment or reserve</option></select></label>
          {mode === 'prepare' && <><div className="form-row"><label>Purpose<select value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="allocation-reserve">Allocation reserve</option><option value="private-payment">Private payment</option></select></label><label>Amount (USDC)<input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" required /></label></div><label>Approved recipient<select value={counterparty} onChange={e => setCounterparty(e.target.value)} required><option value="">Choose recipient</option>{state.counterparties.map(c => <option key={c.name} value={c.name}>{c.name} · {c.recipient}</option>)}</select></label></>}
          <button className="button primary" disabled={busy || !state.configured || (mode === 'prepare' && state.network !== 'mainnet')}>{busy ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />}{mode === 'research' ? 'Run private research' : 'Prepare for review'}</button>
          <p className="fine-print">Stablecoins only, no bridged assets, and at least $100,000 reported exit liquidity. Model requests stop at the configured credit cap. Confidential Intents preparation requires mainnet.</p>
        </form></section>
        {job && <section className="panel owner-section"><h2>{job.command.type === 'research' ? 'Research result' : 'Private job'}</h2><p className="mono muted">{short(job.command.id)} · {job.state}</p>{result?.disclosure && <p>{result.disclosure}</p>}
          {result?.strategy && <div className="source-card"><strong>{result.strategy.selectedMarketId ? 'Selected: ' + result.strategy.selectedMarketId : 'No allocation approved'}</strong><p>{result.strategy.changedByResearch ? 'The research reviews changed or rejected the baseline selection.' : 'All required reviews support the deterministic selection.'}</p></div>}
          {result?.reports?.map(report => <div className="owner-report" key={report.agent}><h3>{report.title}</h3><p>{report.summary}</p><ul>{report.findings.map(f => <li key={f}>{f}</li>)}</ul>{report.assessments?.map(a => <p className="fine-print" key={a.marketId}><strong>{a.decision} · {a.marketId}</strong> — {a.reason}</p>)}</div>)}
          <div className="owner-actions">{job.state === 'prepared' && <button className="button secondary" disabled={busy} onClick={() => void act(async () => { setJob(await call('/jobs/' + job.command.id + '/retry', state.csrf, {})); await refresh(); })}>Recover saved request</button>}{!!result?.transaction && <button className="button primary" disabled={busy} onClick={() => void act(() => makePlan('/jobs/' + job.command.id + '/plan', {}))}>Review transaction</button>}{!!result?.signed && <button className="button secondary" disabled={busy} onClick={() => void act(async () => { setJob(await call('/jobs/' + job.command.id + '/observe', state.csrf, {})); await refresh(); })}>Observe settlement</button>}<button className="button secondary" onClick={() => exportJson(job, 'neslos-private-job.json')}><Download size={14} /> Export job</button></div>
        </section>}
      </div><section className="panel owner-section"><h2>Saved activity</h2><p className="muted">Recover the same request after interruption. A new settlement poll gets its own saved ID.</p>{state.jobs.length ? [...state.jobs].reverse().map(j => <button className="owner-list-row" key={j.id} disabled={busy} onClick={() => void act(async () => { setJob(await call('/jobs/' + j.id)); })}><span><strong>{j.type}</strong><small>{short(j.id)}</small></span><span className="badge">{j.state}</span></button>) : <p>No private jobs yet.</p>}
        <h3 className="subhead">Transaction plans</h3>{state.plans.map(p => <button className="owner-list-row" key={p.hash} disabled={busy} onClick={() => void act(async () => { setPlan(await call('/plans/' + p.hash)); setAllowMainnet(false); })}><span><strong>{p.kind}</strong><small>{short(p.hash)}</small></span><span>{p.network}</span></button>)}
      </section></div>}
      {tab === 'policy' && <div className="owner-columns"><section className="panel owner-section"><h2>On-chain spending boundaries</h2><form className="owner-form" onSubmit={e => { e.preventDefault(); void act(() => makePlan('/policy-plan', { dailyLimit: parseUsdc(daily), perActionLimit: parseUsdc(perAction), maxSlippageBps: slippage, requireConfidential: confidential, outputAssets: outputAssets.split('\n').map(v => v.trim()).filter(Boolean) })); }}><div className="form-row"><label>Daily limit<input value={daily} onChange={e => setDaily(e.target.value)} inputMode="decimal" required /></label><label>Per-action limit<input value={perAction} onChange={e => setPerAction(e.target.value)} inputMode="decimal" required /></label></div><label>Maximum slippage (basis points)<input type="number" min={0} max={1000} value={slippage} onChange={e => setSlippage(Number(e.target.value))} /></label><label>Allowed output assets<textarea rows={3} value={outputAssets} onChange={e => setOutputAssets(e.target.value)} required /></label><label className="check-label"><input type="checkbox" checked={confidential} onChange={e => setConfidential(e.target.checked)} /> Require confidential settlement</label><button className="button primary" disabled={busy || !state.configured || !state.chain}>Review policy change</button><p className="fine-print">Saving creates a plan for review. Today's consumed allowance and the transaction nonce are preserved by the vault.</p></form></section><section className="panel owner-section"><h2>Owner controls</h2><div className="owner-controls"><button className="button secondary" disabled={busy || !state.configured} onClick={() => void act(() => makePlan('/plans', { kind: 'pin-executor' }))}>Review executor pin</button><button className="button secondary" disabled={busy || !state.configured} onClick={() => void act(() => makePlan('/plans', { kind: 'pause', paused: !state.chain?.config.policy.paused }))}>Review {state.chain?.config.policy.paused ? 'resume' : 'pause'}</button><label>Recover to the owner<input value={withdraw} onChange={e => setWithdraw(e.target.value)} inputMode="decimal" /></label><button className="button secondary" disabled={busy || !state.configured} onClick={() => void act(() => makePlan('/plans', { kind: 'withdraw', amount: parseUsdc(withdraw) }))}>Review withdrawal</button></div><p className="fine-print">The private key stays with the local signer. Recovery sends only to the vault owner.</p></section></div>}
      {tab === 'audit' && <section className="panel owner-section"><div className="panel-heading"><div><h2>Private receipts, independently checked</h2><p>Verify signatures in this browser against the configured executor and your retained checkpoint.</p></div><button className="button primary" disabled={busy || !state.configured} onClick={() => void act(loadAudit)}><Fingerprint size={16} /> Fetch & verify audit</button></div>{auditStatus && <p role="status" className="lime-text">{auditStatus}</p>}{audit && <><button className="button secondary" onClick={() => exportJson(audit, 'neslos-private-audit.json')}><Download size={14} /> Export verified audit</button><div className="table-scroll"><table><thead><tr><th>Event</th><th>Commitment</th><th>Receipt</th></tr></thead><tbody>{audit.entries.map(e => <tr key={e.id}><td>{e.type}</td><td className="mono">{short(e.hash)}</td><td><button className="sealed-button" disabled={busy} onClick={() => void act(async () => { setOpening(await call('/audit/' + e.id + '/open', state.csrf, {})); })}>Open privately</button></td></tr>)}</tbody></table></div></>}{opening !== undefined && <details open><summary>Verified receipt opening</summary><pre className="json">{JSON.stringify(opening, null, 2)}</pre></details>}</section>}
      {tab === 'policy' && <FundingPanel disabled={busy || !state.configured || !state.chain} onPlan={operation => void act(() => makePlan('/plans', operation))} />}
      {tab === 'research' && <SchedulePanel state={state} disabled={busy || !state.configured} selectedJob={result?.signed ? job?.command.id : undefined}
        onResearch={(intervalSeconds, maxRuns) => void act(async () => {
          await call('/schedules', state.csrf, { intervalSeconds, maxRuns, mission: { id: crypto.randomUUID(), type: 'research', prompt, research: { stablecoinsOnly: true, allowBridgedAssets: false, minimumLiquidityUsd: 100000 } } });
          setNotice('Research schedule saved with a finite attempt limit.'); await refresh();
        })}
        onObserve={(jobId, intervalSeconds, maxRuns) => void act(async () => { await call('/schedules', state.csrf, { jobId, intervalSeconds, maxRuns }); setNotice('Settlement watch saved. It will not submit a transaction.'); await refresh(); })}
        onControl={(id, status) => void act(async () => { await call('/schedules/' + id, state.csrf, { state: status }); await refresh(); })} />}
      {plan && <section className="panel owner-section owner-plan" aria-label="Exact transaction review"><div className="panel-heading"><div><div className="eyebrow">REVIEW BEFORE SIGNING</div><h2>{plan.plan.operation.kind} · {plan.plan.config.network}</h2></div><button className="button secondary" onClick={() => setPlan(undefined)}>Close review</button></div><div className="receipt-facts"><div><span>Signer</span><strong>{plan.plan.owner}</strong></div><div><span>Receiver</span><strong>{plan.call.receiverId}</strong></div><div><span>Method</span><strong>{plan.call.actions[0]!.params.methodName}</strong></div><div><span>Policy version</span><strong>{plan.plan.policyVersion}</strong></div></div><pre className="json">{JSON.stringify(plan.call, null, 2)}</pre><p className="fine-print mono">Approval hash: {plan.hash}</p>{plan.plan.config.network === 'mainnet' && <label className="check-label"><input type="checkbox" checked={allowMainnet} onChange={e => setAllowMainnet(e.target.checked)} /> I reviewed this real mainnet transaction and its costs.</label>}<div className="owner-actions"><button className="button primary" disabled={busy || !state.signerConfigured || (plan.plan.config.network === 'mainnet' && !allowMainnet)} onClick={() => void act(async () => { const receipt = await call<{ hash: string; success: boolean; final: boolean }>('/plans/' + plan.hash + '/submit', state.csrf, { approvedHash: plan.hash, allowMainnet }); setNotice(`${receipt.final ? 'Finalized' : 'Pending'} transaction ${receipt.hash} · ${receipt.success ? 'success' : 'inspect outcome'}`); await refresh(); })}>Sign & submit this exact plan</button><button className="button secondary" onClick={() => exportJson(plan.plan, 'neslos-transaction-plan.json')}>Export plan</button></div>{!state.signerConfigured && <p className="fine-print">Configure the local owner signer to submit. You can still export and inspect this plan.</p>}</section>}
    </>}
    <footer className="page-footer"><span>Agents propose. Your policy decides.</span><span>Owner keys stay local · No automatic funded execution</span></footer>
  </main>;
}
