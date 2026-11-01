import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity, ArrowDownUp, ArrowRight, ArrowUpRight, Check, CheckCircle2, ChevronRight,
  CircleDot, Clock3, Download, ExternalLink, FileLock2, Fingerprint, FlaskConical,
  Layers3, LayoutDashboard, LoaderCircle, LockKeyhole, Pause, Play, Plus,
  RefreshCw, ScanSearch, Search, Settings2, ShieldAlert, ShieldCheck, Sparkles, Wallet, X, XCircle,
} from 'lucide-react';
import type { AuditExport, MissionRequest, MissionRun, Policy, RankedMarket } from '../core/types.js';
import { formatUsdc, parseUsdc, units } from '../core/amounts.js';
import { launchMission, request, savePolicy, type AppState, type MarketResponse } from './api.js';
import { verifyInBrowser } from './verify.js';

type Page = 'overview' | 'research' | 'policy' | 'audit';
type Notice = { text: string; error?: boolean } | null;
const pages: { id: Page; label: string; icon: typeof Activity }[] = [
  { id: 'overview', label: 'Control room', icon: LayoutDashboard }, { id: 'research', label: 'Yield research', icon: ScanSearch },
  { id: 'policy', label: 'Policy vault', icon: ShieldCheck }, { id: 'audit', label: 'Audit trail', icon: Fingerprint },
];
const stepLabels = ['Set policy', 'Research', 'Propose', 'Guardian', 'Execute', 'Settle & audit'];
const stepIcons = [Settings2, ScanSearch, Sparkles, ShieldCheck, LockKeyhole, Fingerprint];
const activeStatuses = ['researching', 'proposed', 'checking', 'executing', 'settling'];
const short = (value: string, size = 8) => value.slice(0, size) + '…' + value.slice(-4);
const money = (value: string) => '$' + formatUsdc(value);
const compact = (value: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1, style: 'currency', currency: 'USD' }).format(value);
const time = (date: string) => new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const label = (value: string) => value.replaceAll('-', ' ').replaceAll('_', ' ');

function Brand({ small = false }: { small?: boolean }) {
  return <div className={'brand ' + (small ? 'small' : '')}><svg viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="11" fill="currentColor" /><path d="M11 29V11h5l13 18h-5L16 18v11zm14-18h5v18l-5-7z" fill="#151912" /></svg>{!small && <span>neslos<span className="brand-period">.</span></span>}</div>;
}
function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'green' | 'amber' | 'red' | 'neutral' }) {
  return <span className={'badge ' + tone}>{children}</span>;
}
function RunBadge({ run }: { run?: MissionRun }) {
  if (!run) return <Badge><CircleDot size={11} /> Ready</Badge>;
  return <Badge tone={run.status === 'blocked' ? 'amber' : run.status === 'failed' ? 'red' : 'green'}>{activeStatuses.includes(run.status) && <LoaderCircle size={11} className="spin" />}{run.status === 'settled' ? 'Rehearsal settled' : label(run.status)}</Badge>;
}
function Dialog({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const el = ref.current; if (el?.showModal) el.showModal(); else if (el) el.open = true; }, []);
  return <dialog ref={ref} className="dialog" aria-label={title} onCancel={close} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div className="dialog-head"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" onClick={close}><X size={19} /></button></div>
    <div className="dialog-body">{children}</div>
  </dialog>;
}
function download(data: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

export function App() {
  const initial = location.hash.slice(1);
  const [page, setPage] = useState<Page>(pages.some(p => p.id === initial) ? initial as Page : 'overview');
  const [state, setState] = useState<AppState | null>(null);
  const [markets, setMarkets] = useState<MarketResponse | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [fatal, setFatal] = useState('');
  const [selectedRun, setSelectedRun] = useState<string>();
  const [dialog, setDialog] = useState<{ title: string; content: ReactNode } | null>(null);
  const [launching, setLaunching] = useState(false);
  const [reference, setReference] = useState(false);
  const [prompt, setPrompt] = useState('Research NEAR stablecoin yields and prepare a reserve for the best eligible opportunity.');
  const [amount, setAmount] = useState('150');
  const [kind, setKind] = useState<'allocation-reserve' | 'private-payment'>('allocation-reserve');
  const [counterparty, setCounterparty] = useState('treasury-reserve');
  const missionRef = useRef<HTMLTextAreaElement>(null);
  const marketRequest = useRef(0);
  const busy = state?.runs.some(r => activeStatuses.includes(r.status)) ?? false;
  const run = state?.runs.find(r => r.id === selectedRun) ?? state?.runs[0];

  const notify = useCallback((text: string, error = false) => setNotice({ text, error }), []);
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(null), 6500); return () => clearTimeout(id); }, [notice]);
  const refresh = useCallback(async () => { const next = await request<AppState>('/state'); setState(next); return next; }, []);
  const discover = useCallback(async (refreshData = false, refOnly = false) => {
    const requestId = ++marketRequest.current;
    setMarketLoading(true);
    try {
      const result = await request<MarketResponse>('/markets?refresh=' + refreshData + '&reference=' + refOnly);
      if (requestId === marketRequest.current) setMarkets(result);
    }
    catch (e) { if (requestId === marketRequest.current) notify(e instanceof Error ? e.message : 'Research is temporarily unavailable.', true); }
    finally { if (requestId === marketRequest.current) setMarketLoading(false); }
  }, [notify]);
  function changeReference(next: boolean) { setReference(next); void discover(false, next); }
  useEffect(() => { void refresh().then(() => discover()).catch(e => setFatal(e.message)); }, [refresh, discover]);
  useEffect(() => {
    if (!state) return;
    const timer = setInterval(() => void refresh().catch(e => notify(e.message, true)), busy ? 650 : 15_000);
    return () => clearInterval(timer);
  }, [!!state, busy, refresh, notify]);
  const navigate = (next: Page) => { location.hash = next; setPage(next); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  useEffect(() => { const fn = () => { const next = location.hash.slice(1); if (pages.some(p => p.id === next)) setPage(next as Page); }; addEventListener('hashchange', fn); return () => removeEventListener('hashchange', fn); }, []);

  async function launch(attack?: MissionRequest['attack'] | 'parallel') {
    if (!state) return;
    setLaunching(true);
    try {
      const parsedAmount = parseUsdc(amount);
      if (units(parsedAmount) === 0n) throw new Error('Enter an amount greater than zero.');
      const input = { prompt, amount: parsedAmount, kind, counterparty, referenceOnly: reference };
      if (attack === 'parallel') {
        const results = await Promise.allSettled(Array.from({ length: 3 }, () => launchMission({ ...input, requestId: crypto.randomUUID() }, state.csrf)));
        const started = results.filter((r): r is PromiseFulfilledResult<{ run: MissionRun }> => r.status === 'fulfilled');
        for (const result of results) if (result.status === 'rejected') notify(result.reason.message, true);
        if (started[0]) setSelectedRun(started[0].value.run.id);
        notify(started.length + ' agents submitted proposals against one shared allowance.');
      } else {
        const { run } = await launchMission({ ...input, requestId: crypto.randomUUID(), ...(attack ? { attack } : {}) }, state.csrf);
        setSelectedRun(run.id);
      }
      await refresh();
    } catch (e) { notify(e instanceof Error ? e.message : 'Mission could not start.', true); }
    finally { setLaunching(false); }
  }
  async function updatePolicy(policy: Policy) {
    if (!state) return;
    const next = await savePolicy(policy, state.policy.version, state.csrf); setState(next);
    notify('Policy v' + next.policy.version + ' saved. Today’s usage is preserved.');
    void discover(false, reference);
  }
  async function openReceipt(id: string) {
    try {
      const data = await request<{ value: unknown; disclosure: string }>('/audit/' + encodeURIComponent(id) + '/open');
      setDialog({ title: 'Receipt details', content: <><p className="muted">{data.disclosure}</p><pre className="json">{JSON.stringify(data.value, null, 2)}</pre></> });
    } catch (e) { notify((e as Error).message, true); }
  }
  async function previewQuote() {
    if (!state) return;
    try {
      const result = await request('/quote-preview', 'POST', {}, state.csrf);
      setDialog({ title: 'Signed confidential dry quote', content: <pre className="json">{JSON.stringify(result, null, 2)}</pre> });
    } catch (e) { notify((e as Error).message, true); }
  }
  function readiness() {
    if (!state) return;
    setDialog({ title: 'Execution readiness', content: <div className="readiness">
      <p>The rehearsal exercises the complete control flow. These are the deployment requirements for funded execution.</p>
      {[
        ['NEAR policy vault', state.integrations.contractBuilt ? 'WASM built locally' : 'Contract source available'],
        ['Owner’s on-chain policy', 'Deployment and owner transaction required'],
        ['Intel TDX executor', 'Provisioning and independent measurement pinning required'],
        ['NEAR AI private researchers', 'Model access and approved deployment measurements required'],
        ['Confidential 1Click quotes', state.integrations.confidentialQuotes === 'configured' ? 'API token configured; verification required per quote' : 'API token required'],
        ['Funded settlement', 'Owner-authorized mainnet transaction required'],
      ].map(([name, value]) => <div className="readiness-row" key={name}><span>{name}</span><span>{value}</span></div>)}
      <p className="fine-print">Public deposits, withdrawal timing, and public DeFi positions remain observable. Native gas, storage, and inference fees have separate budgets. A funded reserve does not open a lending position.</p>
    </div> });
  }
  if (!state) return <div className="boot"><Brand /><h1>Opening your control room</h1>{fatal ? <><p className="error-text">{fatal}</p><button className="button primary" onClick={() => location.reload()}>Try again</button></> : <p><LoaderCircle size={17} className="spin" /> Establishing an isolated rehearsal session</p>}</div>;
  const completed = state.runs.filter(r => r.status === 'settled').length;
  const blocked = state.runs.filter(r => r.status === 'blocked').length;
  const usedPercent = Math.min(100, Number(units(state.budget.spent) * 10_000n / units(state.policy.dailyLimit)) / 100);
  const chosenMarket = markets?.ranking.find(m => m.eligible);
  const currentTitle = pages.find(p => p.id === page)!.label;

  return <div className="app-shell">
    <aside className="sidebar">
      <a href="#overview" className="brand-link" aria-label="Neslos control room" onClick={() => navigate('overview')}><Brand /></a>
      <div className="workspace-select"><span className="workspace-avatar">N</span><div><strong>Neslos treasury</strong><span>Personal workspace</span></div><span className="workspace-chevron">⌄</span></div>
      <p className="nav-label">WORKSPACE</p>
      <nav aria-label="Main navigation">{pages.map(p => <a href={'#' + p.id} key={p.id} className={'nav-item ' + (page === p.id ? 'active' : '')} onClick={() => navigate(p.id)}><p.icon size={18} strokeWidth={1.7} /><span>{p.label}</span>{p.id === 'audit' && <span className="nav-count">{state.audit.entries.length}</span>}</a>)}</nav>
      <div className="sidebar-bottom">
        <div className="private-note"><div className="private-note-icon"><LockKeyhole size={19} /></div><strong>Private by design.<br />Bounded by you.</strong><p>Every action starts with your policy.</p><button className="text-link" onClick={readiness}>Execution readiness <ArrowUpRight size={14} /></button></div>
        <a className="docs-link" href="https://nearhackathon.com/HACKATHON.md" target="_blank" rel="noreferrer"><Layers3 size={16} /> Built for NEAR HACKATHON <ArrowUpRight size={13} /></a>
        <div className="sidebar-profile"><span className="profile-dot">N</span><div><strong>Rehearsal workspace</strong><span>Session {state.sessionId.slice(0, 8)}</span></div><FlaskConical size={15} /></div>
      </div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><ChevronRight size={13} /><strong>{currentTitle}</strong></div><div className="topbar-right"><span className="network-mark">И</span><span>NEAR</span><span className="top-divider" /><button className="mode-button" onClick={readiness}><FlaskConical size={13} /> Rehearsal <ChevronRight size={12} /></button></div></header>
      <div className="page">
        <div className="page-heading"><div><div className="eyebrow">{page === 'overview' ? 'AUTONOMOUS FINANCE, UNDER CONTROL' : page === 'research' ? 'EVIDENCE BEFORE EXECUTION' : page === 'policy' ? 'YOUR CAPITAL. YOUR CONDITIONS.' : 'PRIVATE DETAILS. VERIFIABLE INTEGRITY.'}</div><h1>{page === 'overview' ? 'Your agents. Your rules' : currentTitle}<span className="heading-dot">.</span></h1><p>{page === 'overview' ? 'Discover opportunities. Set boundaries. Let your agents do the work.' : page === 'research' ? 'A clear view of NEAR yields, liquidity, and the risks behind the rate.' : page === 'policy' ? 'Define what your agents can spend, where they can go, and who they can pay.' : 'Every decision leaves a signed, encrypted trail you can independently verify.'}</p></div>
          {page === 'overview' ? <button className="button primary" onClick={() => { missionRef.current?.focus(); missionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}><Plus size={16} /> New mission</button> : page === 'research' ? <button className="button secondary" disabled={marketLoading} onClick={() => void discover(true, reference)}><RefreshCw size={15} className={marketLoading ? 'spin' : ''} /> Refresh research</button> : <Badge tone={state.policy.paused ? 'amber' : 'green'}><CircleDot size={11} />{state.policy.paused ? 'Policy paused' : 'Policy active'}</Badge>}
        </div>
        <div className="mode-strip"><FlaskConical size={14} /><span><strong>Rehearsal environment</strong><span className="mode-detail"> · Simulated funds. Real market sources and cryptographic receipts.</span></span><button onClick={readiness}>View readiness <ArrowUpRight size={13} /></button></div>

        {page === 'overview' && <>
          <div className="metrics">
            <div className="metric main-metric"><div className="metric-label">Daily allowance remaining <Wallet size={16} /></div><div className="metric-value">{money(state.budget.remaining)}<span>USDC</span></div><div className="budget-track" role="progressbar" aria-label="Daily allowance used" aria-valuenow={usedPercent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: usedPercent + '%' }} /></div><div className="metric-foot">{money(state.budget.spent)} of {money(state.policy.dailyLimit)} committed <span>Resets at 00:00 UTC</span></div></div>
            <div className="metric"><div className="metric-label">Policy boundaries <ShieldCheck size={16} /></div><div className="metric-value">{money(state.policy.perTransactionLimit)}<span>/ action</span></div><div className="metric-foot">{state.policy.maxSlippageBps} bps max slippage <span className="dot-separator">·</span> {state.policy.allowedVenues.length} venues</div><button className="metric-link" onClick={() => navigate('policy')}>Manage policy <ArrowUpRight size={13} /></button></div>
            <div className="metric"><div className="metric-label">Missions completed <CheckCircle2 size={16} /></div><div className="metric-value">{String(completed).padStart(2, '0')}<span>rehearsals</span></div><div className="metric-foot"><span className="tiny-dot lime" /> {busy ? 'Agents working' : 'Ready for a mission'}</div><span className="metric-small">{state.runs.length} total missions</span></div>
            <div className="metric"><div className="metric-label">Guardrail interventions <ShieldAlert size={16} /></div><div className="metric-value">{String(blocked).padStart(2, '0')}<span>blocked</span></div><div className="metric-foot">Denied before execution</div><span className="metric-small">One shared spending authority</span></div>
          </div>
          <div className="workspace-grid">
            <div className="workspace-left">
              <section className="panel flow-panel">
                <div className="panel-heading"><div><h2>From intent to settlement</h2><p>Six stages. One enforceable policy.</p></div><RunBadge run={run} /></div>
                <div className="execution-flow">{stepLabels.map((step, i) => { const Icon = stepIcons[i]!; const status = run?.steps[i]?.status ?? (i === 0 ? 'complete' : 'waiting'); return <div key={step} className={'flow-stage ' + status}><span className="step-index">0{i + 1}</span><div className="flow-icon"><Icon size={20} strokeWidth={1.65} />{status === 'complete' && <span className="step-check"><Check size={8} /></span>}</div><strong>{step}</strong><span className="step-state">{status === 'active' ? 'Working' : status === 'complete' ? 'Complete' : status === 'blocked' ? 'Blocked' : status === 'failed' ? 'Failed' : i === 0 ? 'Configured' : 'Waiting'}</span></div>; })}</div>
                <div className={'flow-outcome ' + (run?.status === 'blocked' ? 'denied' : '')}>
                  <div className="outcome-icon">{run?.status === 'blocked' ? <ShieldAlert size={21} /> : run?.status === 'settled' ? <CheckCircle2 size={21} /> : <LockKeyhole size={21} />}</div>
                  <div><strong>{run?.status === 'blocked' ? 'Boundary held. Execution blocked.' : run?.status === 'settled' ? 'Mission settled. Receipt sealed.' : run ? label(run.status).replace(/^./, x => x.toUpperCase()) + ' in progress' : 'Permission to act starts here.'}</strong><p>{run?.status === 'blocked' ? run.steps[3]?.detail : run?.settlement?.message ?? run?.steps.find(s => s.status === 'active')?.detail ?? 'Agents propose an action. Your guardian decides whether it can proceed.'}</p></div>
                  {run?.decision && <button className="icon-button" aria-label="Inspect guardian decision" onClick={() => setDialog({ title: 'Guardian decision', content: <Guardian run={run} /> })}><ArrowUpRight size={17} /></button>}
                </div>
                <div className="flow-footer"><span><span className="tiny-dot lime" /> 7 specialized agent roles</span><span><LockKeyhole size={11} /> {state.policy.requireConfidential ? 'Confidential settlement required' : 'Public settlement permitted'}</span></div>
              </section>
              <section className="panel research-preview">
                <div className="panel-heading"><div><h2>Opportunities in focus <span className="count-label">{markets?.ranking.length ?? '—'}</span></h2><p>{marketLoading ? 'Researchers are retrieving NEAR market evidence…' : 'Ranked by base yield, liquidity, and your policy.'}</p></div><button className="text-link" onClick={() => navigate('research')}>All research <ArrowUpRight size={14} /></button></div>
                {markets ? <MarketTable markets={markets.ranking.slice(0, 4)} compactView onSelect={m => setDialog({ title: m.protocol + ' · ' + m.symbol, content: <MarketDetail market={m} /> })} /> : <div className="empty-state"><Search size={23} /><p>{marketLoading ? 'Discovering NEAR opportunities' : 'Market research is unavailable'}</p><button className="text-link" onClick={() => changeReference(true)}>Load reproducible reference <ArrowRight size={13} /></button></div>}
                <div className="source-foot"><span className={'tiny-dot ' + (markets?.sourceMode === 'live' ? 'lime' : 'amber')} /><span>{markets ? (markets.sourceMode === 'live' ? 'Rhea live feed · retrieved ' + time(markets.fetchedAt) : 'Reference snapshot · 1 Nov 2026') : 'Awaiting source data'}</span><span>APY is variable</span></div>
              </section>
            </div>
            <div className="workspace-right">
              <section className="panel mission-panel">
                <div className="panel-heading"><div><div className="eyebrow">GIVE YOUR AGENTS A MISSION</div><h2>What’s the objective?</h2></div><Sparkles size={18} className="lime-text" /></div>
                <form onSubmit={e => { e.preventDefault(); void launch(); }}>
                  <label className="sr-only" htmlFor="mission-prompt">Mission instructions</label><textarea ref={missionRef} id="mission-prompt" value={prompt} onChange={e => setPrompt(e.target.value)} minLength={5} maxLength={1600} rows={4} required />
                  <div className="form-row"><label>Use of funds<select aria-label="Use of funds" value={kind} onChange={e => { const next = e.target.value as typeof kind; setKind(next); setCounterparty(next === 'allocation-reserve' ? 'treasury-reserve' : 'research-agent'); }}><option value="allocation-reserve">Allocation reserve</option><option value="private-payment">Private payment</option></select></label><label>Amount<div className="amount-input"><span>$</span><input aria-label="Mission amount in USDC" value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" required /><span>USDC</span></div></label></div>
                  <label>Counterparty<select aria-label="Payment counterparty" value={counterparty} onChange={e => setCounterparty(e.target.value)}>{state.policy.allowedCounterparties.map(c => <option value={c} key={c}>{label(c)}</option>)}{!state.policy.allowedCounterparties.includes(counterparty) && <option value={counterparty}>{label(counterparty)} (outside policy)</option>}</select></label>
                  <div className="mission-route"><span className="route-logo">И</span><div><strong>NEAR Confidential Intents</strong><span>Rehearsal route · no funded transfer</span></div><LockKeyhole size={14} /></div>
                  <label className="check-label"><input type="checkbox" checked={reference} disabled={busy || launching} onChange={e => changeReference(e.target.checked)} /> Use the reproducible reference dataset</label>
                  <button className="button primary full" disabled={launching || busy}>{launching || busy ? <LoaderCircle size={15} className="spin" /> : <Play size={14} fill="currentColor" />}{launching ? 'Starting mission' : busy ? 'Agents are working' : 'Launch rehearsal'}<ArrowRight size={15} /></button>
                  <p className="mission-caption">{kind === 'allocation-reserve' ? 'Compare yields and prepare a reserve. A lending position is not opened.' : 'Rehearse a private payment to your approved research counterparty.'}</p>
                </form>
              </section>
              <section className="boundary-panel"><div className="boundary-heading"><ShieldAlert size={17} /><h3>Try to cross the line.</h3></div><p>The best way to trust a limit is to test it.</p><div className="attack-grid">
                <button disabled={busy || launching} onClick={() => void launch('overspend')}>Overspend <ArrowUpRight size={12} /></button>
                <button disabled={busy || launching} onClick={() => void launch('counterparty')}>Wrong recipient <ArrowUpRight size={12} /></button>
                <button disabled={busy || launching} onClick={() => void launch('privacy')}>Public payment <ArrowUpRight size={12} /></button>
                <button disabled={busy || launching} onClick={() => void launch('parallel')}>Race 3 agents <ArrowUpRight size={12} /></button>
              </div></section>
            </div>
          </div>
          {run?.reports.length ? <section className="agent-reports"><div className="section-heading"><h2>Agent intelligence</h2><span>{run.reports.length} reports · deterministic rehearsal</span></div><div className="report-grid">{run.reports.slice(0, 3).map(report => <button className="report-card" key={report.agent} onClick={() => setDialog({ title: report.title, content: <><Badge tone="green">{report.inference}</Badge><p>{report.summary}</p><ul className="findings">{report.findings.map(f => <li key={f}>{f}</li>)}</ul><div className="report-sources">{report.sourceUrls.map(url => <a key={url} href={url} target="_blank" rel="noreferrer">{new URL(url).hostname} <ExternalLink size={12} /></a>)}</div></> })}><span className="agent-avatar">{report.agent === 'lending' ? <ScanSearch size={17} /> : report.agent === 'liquidity' ? <Activity size={17} /> : <ShieldCheck size={17} />}</span><div><strong>{report.title}</strong><p>{report.summary}</p></div><ArrowUpRight size={14} /></button>)}</div></section> : null}
          <section className="panel activity-panel"><div className="panel-heading"><div><h2>Mission activity</h2><p>A record of what your agents attempted and what your policy allowed.</p></div><button className="text-link" onClick={() => navigate('audit')}>Audit trail <ArrowUpRight size={14} /></button></div>
            {state.runs.length ? <div className="table-scroll"><table><thead><tr><th>Mission</th><th>Requested</th><th>Status</th><th>Started</th><th /></tr></thead><tbody>{state.runs.slice(0, 6).map(r => <tr key={r.id}><td><button className="table-action mission-name" onClick={() => { setSelectedRun(r.id); document.querySelector('.flow-panel')?.scrollIntoView({ behavior: 'smooth' }); }}><span className="mission-mini"><Layers3 size={15} /></span><span><strong>{r.kind === 'allocation-reserve' ? 'Yield reserve' : 'Private payment'}</strong><small>{short(r.id, 8)}</small></span></button></td><td className="mono">{r.proposal ? money(r.proposal.amount) : 'Proposing…'}</td><td><RunBadge run={r} /></td><td className="muted mono">{time(r.createdAt)}</td><td><button className="icon-button" aria-label={'Inspect mission ' + r.id.slice(0, 8)} onClick={() => setDialog({ title: 'Mission evidence', content: <Guardian run={r} /> })}><ArrowUpRight size={16} /></button></td></tr>)}</tbody></table></div> : <div className="activity-empty"><span><Activity size={21} /></span><div><strong>Your first mission starts the story.</strong><p>Launch a rehearsal or challenge the guardian to see an action here.</p></div><ArrowRight size={17} /></div>}
          </section>
        </>}

        {page === 'research' && <ResearchPage data={markets} loading={marketLoading} chosen={chosenMarket} refresh={() => void discover(true, reference)} inspect={m => setDialog({ title: m.protocol + ' · ' + m.symbol, content: <MarketDetail market={m} /> })} previewQuote={() => void previewQuote()} />}
        {page === 'policy' && <PolicyPage policy={state.policy} spent={state.budget.spent} save={updatePolicy} notify={notify} />}
        {page === 'audit' && <AuditPage bundle={state.audit} sessionId={state.sessionId} openReceipt={openReceipt} notify={notify} />}
        <footer className="page-footer"><span><Brand small /> Agents propose. Your policy decides.</span><div><button onClick={readiness}>TEE deployment pending <ArrowUpRight size={12} /></button><span>Built on NEAR</span></div></footer>
      </div>
    </main>
    {notice && <div role={notice.error ? 'alert' : 'status'} className={'toast ' + (notice.error ? 'error' : '')}>{notice.error ? <ShieldAlert size={18} /> : <CheckCircle2 size={18} />}<span>{notice.text}</span><button aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={15} /></button></div>}
    {dialog && <Dialog title={dialog.title} close={() => setDialog(null)}>{dialog.content}</Dialog>}
  </div>;
}

function Guardian({ run }: { run: MissionRun }) {
  return <><div className="guardian-summary"><RunBadge run={run} /><span className="mono">{short(run.id)}</span></div><p>{run.proposal?.purpose ?? run.error ?? 'Researchers are preparing this proposal.'}</p>{run.proposal && <div className="receipt-facts"><div><span>Amount</span><strong>{money(run.proposal.amount)} USDC</strong></div><div><span>Counterparty</span><strong>{run.proposal.counterparty}</strong></div><div><span>Policy / nonce</span><strong>v{run.proposal.policyVersion} / {run.proposal.nonce}</strong></div></div>}
    <div className="guardian-checks">{run.decision?.checks.map(c => <div key={c.code} className={'guardian-check ' + (c.passed ? 'pass' : 'fail')}>{c.passed ? <CheckCircle2 size={17} /> : <XCircle size={17} />}<div><strong>{c.label}</strong><p>{c.detail}</p></div><span>{c.passed ? 'PASS' : 'BLOCK'}</span></div>)}</div><p className="fine-print">Rehearsal decision. No transaction hash or hardware attestation is claimed.</p></>;
}

function MarketTable({ markets, compactView = false, onSelect }: { markets: RankedMarket[]; compactView?: boolean; onSelect: (m: RankedMarket) => void }) {
  return <div className="table-scroll"><table className="markets-table"><thead><tr><th>Market</th>{!compactView && <th>Base / rewards</th>}<th>Reported APY</th><th>Exit liquidity</th><th>Policy fit</th>{!compactView && <th>Source</th>}</tr></thead><tbody>{markets.map(m => <tr key={m.id}><td><button className="table-action token-name" onClick={() => onSelect(m)}><span className={'token-icon ' + (m.symbol.includes('USDT') ? 'teal' : m.stablecoin ? 'blue' : 'gray')}>{m.stablecoin ? '$' : m.symbol.slice(0, 1)}</span><span><strong>{m.symbol}</strong><small>{m.protocol}</small></span></button></td>{!compactView && <td className="mono">{m.baseApy.toFixed(2)}% <span className="muted">/ {m.rewardApy.toFixed(2)}%</span></td>}<td className={'apy-cell mono ' + (m.eligible ? 'lime-text' : '')}>{m.totalApy.toFixed(2)}<span>%</span></td><td className="mono">{m.liquidityUsd > 0 ? compact(m.liquidityUsd) : <span className="muted">Unverified</span>}</td><td><Badge tone={m.eligible ? 'green' : 'neutral'}>{m.eligible ? <Check size={10} /> : null}{m.eligible ? 'Eligible' : 'Excluded'}</Badge></td>{!compactView && <td><Badge tone={m.sourceMode === 'live' ? 'green' : 'amber'}>{m.sourceMode === 'live' ? 'Live feed' : 'Reference'}</Badge></td>}</tr>)}</tbody></table></div>;
}
function MarketDetail({ market: m }: { market: RankedMarket }) {
  return <><div className="market-detail-head"><span className="token-icon blue large">$</span><div><h3>{m.symbol} on {m.protocol}</h3><Badge tone={m.eligible ? 'green' : 'amber'}>{m.eligible ? 'Matches research policy' : 'Excluded by research policy'}</Badge></div></div><div className="receipt-facts"><div><span>Reported APY</span><strong>{m.totalApy.toFixed(2)}%</strong></div><div><span>Base yield</span><strong>{m.baseApy.toFixed(2)}%</strong></div><div><span>Token incentives</span><strong>{m.rewardApy.toFixed(2)}%</strong></div><div><span>Exit liquidity</span><strong>{compact(m.liquidityUsd)}</strong></div><div><span>Total supplied</span><strong>{compact(m.tvlUsd)}</strong></div><div><span>Ranking score</span><strong>{m.score}</strong></div></div>{m.exclusions.length > 0 && <div className="exclusion-box"><strong>Why the guardian excludes this opportunity</strong><ul>{m.exclusions.map(e => <li key={e}>{e}</li>)}</ul></div>}<h3 className="subhead">Risk review</h3><ul className="findings">{m.risks.map(r => <li key={r}>{r}</li>)}</ul><div className="source-card"><span>Source evidence</span><a href={m.sourceUrl} target="_blank" rel="noreferrer">{new URL(m.sourceUrl).hostname}<ExternalLink size={13} /></a><p>{m.sourceMode === 'live' ? 'Retrieved ' : 'Reference captured '}{new Date(m.fetchedAt).toLocaleString()}. The provider does not supply an observation timestamp.</p></div><p className="fine-print">Score = base APY + 25% of incentive APY − bridge and high-utilization penalties. This is a transparent ranking rule, not a return forecast.</p></>;
}
function ResearchPage({ data, loading, chosen, refresh, inspect, previewQuote }: { data: MarketResponse | null; loading: boolean; chosen?: RankedMarket; refresh: () => void; inspect: (m: RankedMarket) => void; previewQuote: () => void }) {
  const [eligibleOnly, setEligibleOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('policy');
  const rows = [...(data?.ranking ?? [])].filter(m => (!eligibleOnly || m.eligible) && (m.symbol + ' ' + m.protocol).toLowerCase().includes(search.toLowerCase()));
  if (sort === 'apy') rows.sort((a, b) => b.totalApy - a.totalApy);
  if (sort === 'liquidity') rows.sort((a, b) => b.liquidityUsd - a.liquidityUsd);
  return <>
    <div className="research-highlights"><section className="panel top-opportunity"><div className="eyebrow">HIGHEST RANKED ELIGIBLE MARKET</div><div className="opportunity-main"><div><h2>{chosen ? chosen.symbol : '—'} <span>{chosen?.protocol ?? 'Awaiting research'}</span></h2><p>Prioritizes sustainable base yield within your constraints.</p></div><div className="headline-rate">{chosen?.totalApy.toFixed(2) ?? '—'}<span>%<small>reported APY</small></span></div></div><div className="opportunity-footer"><Badge tone="green">NEAR</Badge><span>{chosen ? compact(chosen.liquidityUsd) + ' available exit liquidity' : 'No eligible market yet'}</span>{chosen && <button className="text-link" onClick={() => inspect(chosen)}>Inspect <ArrowUpRight size={13} /></button>}</div></section><section className="panel research-method"><ScanSearch size={22} /><h3>Research with a reason.</h3><p>Separate researchers examine lending, liquidity, and risk. Every market keeps its source and every exclusion gets an explanation.</p><div><Badge>{data?.ranking.length ?? '—'} markets</Badge><Badge>{data?.ranking.filter(m => m.eligible).length ?? '—'} eligible</Badge></div></section></div>
    <section className="panel research-full"><div className="research-toolbar"><div className="search-input"><Search size={16} /><input aria-label="Search markets" value={search} placeholder="Search NEAR markets…" onChange={e => setSearch(e.target.value)} /></div><div><label className="check-label"><input type="checkbox" checked={eligibleOnly} onChange={e => setEligibleOnly(e.target.checked)} /> Eligible only</label><label className="sort-select"><ArrowDownUp size={14} /><select aria-label="Sort markets" value={sort} onChange={e => setSort(e.target.value)}><option value="policy">Policy fit</option><option value="apy">Highest APY</option><option value="liquidity">Exit liquidity</option></select></label></div></div>
      {rows.length ? <MarketTable markets={rows} onSelect={inspect} /> : <div className="empty-state"><Search size={24} /><p>{loading ? 'Loading market evidence…' : 'No markets match these filters.'}</p><button className="text-link" onClick={refresh}>Refresh research</button></div>}
      <div className="source-foot"><span className={'tiny-dot ' + (data?.sourceMode === 'live' ? 'lime' : 'amber')} /><span>{data ? (data.sourceMode === 'live' ? 'Provider feed retrieved ' + new Date(data.fetchedAt).toLocaleString() : 'Reproducible reference snapshot · 1 November 2026') : 'Awaiting source data'}</span><span>{rows.length} markets shown</span></div>
    </section>
    <div className="research-notes"><div><h3><FileLock2 size={17} /> Privacy follows the action.</h3><p>A confidential payment can fund a private allocation reserve. Depositing into a public lending pool exposes that position. A policy requiring confidentiality blocks a public lending proposal.</p><button className="text-link" onClick={previewQuote}>Request a signed confidential dry quote <ArrowUpRight size={14} /></button></div><div><h3><Clock3 size={17} /> Know the evidence window.</h3>{data?.notices.map(n => <p key={n}>{n}</p>)}<p>“Best” means highest ranked within the observed markets and your constraints.</p></div></div>
  </>;
}

function PolicyPage({ policy, spent, save, notify }: { policy: Policy; spent: string; save: (policy: Policy) => Promise<void>; notify: (text: string, error?: boolean) => void }) {
  const [draft, setDraft] = useState(policy);
  const [daily, setDaily] = useState(formatUsdc(policy.dailyLimit, 6).replaceAll(',', ''));
  const [perAction, setPerAction] = useState(formatUsdc(policy.perTransactionLimit, 6).replaceAll(',', ''));
  const [counterparties, setCounterparties] = useState(policy.allowedCounterparties.join(', '));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(policy); setDaily(formatUsdc(policy.dailyLimit, 6).replaceAll(',', '')); setPerAction(formatUsdc(policy.perTransactionLimit, 6).replaceAll(',', '')); setCounterparties(policy.allowedCounterparties.join(', ')); }, [policy.version]);
  async function submit(e: FormEvent) {
    e.preventDefault(); setSaving(true);
    try { await save({ ...draft, dailyLimit: parseUsdc(daily), perTransactionLimit: parseUsdc(perAction), allowedCounterparties: counterparties.split(',').map(s => s.trim()).filter(Boolean) }); }
    catch (e) { notify((e as Error).message, true); }
    finally { setSaving(false); }
  }
  const toggleVenue = (venue: string) => setDraft({ ...draft, allowedVenues: draft.allowedVenues.includes(venue) ? draft.allowedVenues.filter(v => v !== venue) : [...draft.allowedVenues, venue] });
  return <div className="policy-grid"><form className="panel policy-form" onSubmit={submit}><div className="panel-heading"><div><h2>Treasury spending policy</h2><p>Your deterministic guardian applies these rules to every proposal.</p></div><Badge>v{policy.version}</Badge></div>
    <div className="form-section"><div className="section-number">01</div><div><h3>Spending boundaries</h3><p>Exact USDC amounts. Shared by every agent.</p><div className="form-row"><label>Maximum daily spend (USDC)<input aria-label="Maximum daily spend" inputMode="decimal" value={daily} onChange={e => setDaily(e.target.value)} required /></label><label>Maximum per action (USDC)<input aria-label="Maximum per action" inputMode="decimal" value={perAction} onChange={e => setPerAction(e.target.value)} required /></label></div><div className="form-row"><label>Maximum slippage (bps)<input aria-label="Maximum slippage in basis points" type="number" min="0" max="1000" value={draft.maxSlippageBps} onChange={e => setDraft({ ...draft, maxSlippageBps: Number(e.target.value) })} required /></label><label>Quote freshness (seconds)<input aria-label="Maximum quote age" type="number" min="5" max="300" value={draft.maxQuoteAgeSeconds} onChange={e => setDraft({ ...draft, maxQuoteAgeSeconds: Number(e.target.value) })} required /></label></div></div></div>
    <div className="form-section"><div className="section-number">02</div><div><h3>Allowed destinations</h3><p>Only explicitly allowed venues and counterparties can pass.</p><div className="venue-options">{[['near-intents', 'NEAR Intents'], ['rhea-lending', 'Rhea lending'], ['rhea-dex', 'Rhea DEX'], ['meta-pool', 'Meta Pool'], ['linear', 'LiNEAR']].map(([id, name]) => <label className={'venue-option ' + (draft.allowedVenues.includes(id!) ? 'selected' : '')} key={id}><input type="checkbox" checked={draft.allowedVenues.includes(id!)} onChange={() => toggleVenue(id!)} /><span>{name}</span>{draft.allowedVenues.includes(id!) && <Check size={13} />}</label>)}</div><label>Allowed counterparties <span className="label-hint">Separate names with commas</span><textarea rows={2} aria-label="Allowed counterparties" value={counterparties} onChange={e => setCounterparties(e.target.value)} required /></label></div></div>
    <div className="form-section"><div className="section-number">03</div><div><h3>Privacy & research constraints</h3><p>Research filters narrow the opportunity set before a proposal is made.</p>{[
      { key: 'requireConfidential' as const, title: 'Require confidential settlement', detail: 'Block public payments and public lending actions.' },
      { key: 'stablecoinsOnly' as const, title: 'Research stablecoins only', detail: 'Exclude assets with direct token-price exposure.' },
      { key: 'allowBridgedAssets' as const, title: 'Allow bridged assets', detail: 'Include wrapped assets with additional bridge risk.' },
    ].map(option => <label className="toggle-row" key={option.key}><span><strong>{option.title}</strong><small>{option.detail}</small></span><input type="checkbox" role="switch" checked={draft[option.key]} onChange={e => setDraft({ ...draft, [option.key]: e.target.checked })} /><span className="switch" /></label>)}<label className="liquidity-input">Minimum reported exit liquidity (USD)<input type="number" min="0" max="1000000000000" value={draft.minimumLiquidityUsd} onChange={e => setDraft({ ...draft, minimumLiquidityUsd: Number(e.target.value) })} /></label></div></div>
    <div className="policy-actions"><span><LockKeyhole size={13} /> Changes preserve today’s usage and nonce.</span><button type="submit" className="button primary" disabled={saving}>{saving ? <LoaderCircle size={15} className="spin" /> : <ShieldCheck size={15} />} Save policy</button></div>
  </form><div className="policy-side"><section className="panel policy-summary"><span className="policy-shield"><ShieldCheck size={28} /></span><h2>One policy.<br />Every agent.</h2><p>Spending authority belongs to the policy vault. A persuasive proposal is never permission to move funds.</p><div className="summary-rule"><span>Already committed today</span><strong>{money(spent)} USDC</strong></div><div className="summary-rule"><span>Policy version</span><strong>v{policy.version}</strong></div><div className="summary-rule"><span>Budget window</span><strong>UTC calendar day</strong></div><div className="summary-rule"><span>Environment</span><Badge tone="amber">Rehearsal</Badge></div></section><section className="pause-panel"><h3><Pause size={17} /> Owner’s emergency control</h3><p>{policy.paused ? 'New proposals are currently blocked by the guardian.' : 'Pause new spending authorizations immediately.'}</p><button className={'button full ' + (policy.paused ? 'primary' : 'secondary')} disabled={saving} onClick={async () => { setSaving(true); try { await save({ ...policy, paused: !policy.paused }); } catch (e) { notify((e as Error).message, true); } finally { setSaving(false); } }}>{policy.paused ? <Play size={14} /> : <Pause size={14} />}{policy.paused ? 'Resume agents' : 'Pause agents'}</button></section><p className="fine-print">This editor changes your isolated rehearsal policy. Funded enforcement uses the Rust NEAR vault and an owner-signed policy transaction. Research filters are evaluated inside the executor; monetary limits, allowlist commitments, nonce, expiry, and output floors are checked on chain.</p></div></div>;
}

function AuditPage({ bundle, sessionId, openReceipt, notify }: { bundle: AuditExport; sessionId: string; openReceipt: (id: string) => Promise<void>; notify: (text: string, error?: boolean) => void }) {
  const [verification, setVerification] = useState<{ valid: boolean; reason: string; checked: number } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const pinName = 'neslos-audit-pin:' + sessionId;
  const checkpointName = pinName + ':checkpoint';
  const [pinnedKey] = useState(() => {
    try { const existing = localStorage.getItem(pinName); if (existing) return existing; localStorage.setItem(pinName, bundle.publicKey); } catch { /* browser storage can be unavailable */ }
    return bundle.publicKey;
  });
  async function verify(tamper = false, imported?: AuditExport) {
    setVerifying(true);
    const candidate = structuredClone(imported ?? bundle);
    if (tamper && candidate.entries[0]) candidate.entries[0].sealed.ciphertext += '00';
    let checkpoint: string | undefined;
    try { checkpoint = localStorage.getItem(checkpointName) ?? undefined; } catch { /* no persisted checkpoint */ }
    const result = await verifyInBrowser(candidate, pinnedKey, checkpoint); setVerification(result);
    if (result.valid && !tamper && !imported) { try { localStorage.setItem(checkpointName, bundle.checkpoint); } catch { /* storage unavailable */ } }
    if (tamper) notify(result.valid ? 'Unexpected result: altered receipt passed.' : 'Altered receipt rejected by your browser.', result.valid);
    setVerifying(false);
  }
  const fileRef = useRef<HTMLInputElement>(null);
  return <><div className="audit-hero panel"><div className="audit-hero-icon"><Fingerprint size={37} strokeWidth={1.1} /></div><div><div className="eyebrow">A TRAIL YOU CAN VERIFY</div><h2>Keep the details private.<br />Make the decisions accountable.</h2><p>AES-256-GCM encryption. Ed25519 signatures. A linked history of every decision.</p></div><div className="audit-hero-actions"><button className="button primary" disabled={verifying} onClick={() => void verify()}>{verifying ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />} Verify integrity</button><button className="button secondary" onClick={() => download(bundle, 'neslos-audit-' + sessionId + '.json')}><Download size={15} /> Export audit bundle</button></div></div>
    {verification && <div role="status" className={'verification-result ' + (verification.valid ? 'valid' : 'invalid')}>{verification.valid ? <CheckCircle2 size={21} /> : <XCircle size={21} />}<div><strong>{verification.valid ? verification.checked + ' receipts verified' : 'Integrity check rejected'}</strong><p>{verification.reason}</p></div></div>}
    <div className="audit-identities"><div><span>Session signing identity</span><strong className="mono">{short(pinnedKey, 20)}</strong><small>Pinned in this browser on first use · no hardware claim</small></div><div><span>Latest checkpoint</span><strong className="mono">{short(bundle.checkpoint, 20)}</strong><small>Retain this independently to detect an omitted history</small></div><div><span>Sealed events</span><strong>{bundle.entries.length}</strong><small>Rehearsal events in this session</small></div></div>
    <section className="panel"><div className="panel-heading"><div><h2>Encrypted event log</h2><p>Public metadata links the sequence. Sensitive payloads remain sealed.</p></div><Badge><LockKeyhole size={11} /> AES-256-GCM</Badge></div><div className="table-scroll"><table className="audit-table"><thead><tr><th>Sequence</th><th>Event</th><th>Time</th><th>Content commitment</th><th>Payload</th></tr></thead><tbody>{[...bundle.entries].reverse().map(e => <tr key={e.id}><td className="mono muted">{String(e.index + 1).padStart(3, '0')}</td><td><div className="audit-event"><span className={'event-dot ' + (e.type.includes('settlement') ? 'green' : '')} /><span>{e.type.replaceAll('.', ' / ')}</span></div></td><td className="mono muted">{time(e.createdAt)}</td><td className="mono hash-text">{short(e.hash, 12)}</td><td><button className="sealed-button" onClick={() => void openReceipt(e.id)} aria-label={'Open receipt ' + (e.index + 1)}><LockKeyhole size={12} /> Open receipt <ArrowUpRight size={12} /></button></td></tr>)}</tbody></table></div></section>
    <div className="audit-tools"><div><h3>Put the proof to the test.</h3><p>Alter a copy, or verify an exported bundle locally in your browser.</p></div><button className="button secondary" disabled={verifying} onClick={() => void verify(true)}><ShieldAlert size={15} /> Test a tampered copy</button><button className="button secondary" onClick={() => fileRef.current?.click()}><FileLock2 size={15} /> Verify a bundle</button><input ref={fileRef} className="sr-only" type="file" accept=".json,application/json" aria-label="Choose an audit bundle" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { if (file.size > 10_000_000) throw new Error('Audit file is too large.'); await verify(false, JSON.parse(await file.text())); } catch (error) { notify((error as Error).message, true); } e.target.value = ''; }} /></div>
    <p className="fine-print">Encryption hides payload contents, not event timing, event type, or the number of events. Integrity is checked against the pinned session key. A retained checkpoint is needed to detect truncation; a session key alone is not a hardware identity.</p>
  </>;
}
