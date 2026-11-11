import { useRef, useState } from 'react';
import { ArrowRight, Check, CheckCircle2, Download, Fingerprint, LoaderCircle, RotateCcw, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { AuditExport, MissionRequest } from '../core/types.js';
import { formatUsdc } from '../core/amounts.js';
import { launchMission, request, type AppState } from './api.js';
import { downloadJson } from './evidence.js';
import { verifyInBrowser } from './verify.js';

type Challenge = {
  sessionId: string; key: string; checkpoint: string;
  blockRequest: MissionRequest; allowRequest: MissionRequest;
  blockedId?: string; allowedId?: string;
};
type Proof = { bundle: AuditExport; verified: number; tamperedCopyRejected: boolean; remaining: string };
const active = ['researching', 'proposed', 'checking', 'executing', 'settling'];

export function ChallengePage({ state, onState, useReference, viewEvidence, viewAudit }: {
  state: AppState; onState: (state: AppState) => void; useReference: () => void;
  viewEvidence: () => void; viewAudit: () => void;
}) {
  const [challenge, setChallenge] = useState<Challenge>();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [proof, setProof] = useState<Proof>();
  const lock = useRef(false);
  const blocked = state.runs.find(run => run.id === challenge?.blockedId || run.requestId === challenge?.blockRequest.requestId);
  const allowed = state.runs.find(run => run.id === challenge?.allowedId || run.requestId === challenge?.allowRequest.requestId);
  const busy = state.runs.some(run => active.includes(run.status));
  const sameSession = !challenge || challenge.sessionId === state.sessionId;
  const blockPassed = blocked?.status === 'blocked' && blocked.decision?.allowed === false
    && blocked.proposal?.amount === '501000000' && blocked.decision.checks.some(check => !check.passed)
    && (Boolean(allowed) || (state.budget.remaining === '500000000' && state.budget.spent === '0' && state.budget.reserved === '0'));
  const allowPassed = allowed?.status === 'settled' && allowed.decision?.allowed === true
    && allowed.proposal?.amount === '150000000' && state.budget.remaining === '350000000';
  const stage = proof ? 3 : allowPassed ? 2 : blockPassed ? 1 : 0;
  const failed = (blocked && !active.includes(blocked.status) && !blockPassed)
    || (allowed && !active.includes(allowed.status) && !allowPassed);

  async function submit(current: Challenge, phase: 'block' | 'allow', csrf: string) {
    // Retain the same request ID and payload after an uncertain response. Recovery
    // calls the API's idempotent start path rather than creating another mission.
    const { run } = await launchMission(phase === 'block' ? current.blockRequest : current.allowRequest, csrf);
    setChallenge(previous => previous && { ...previous, [phase === 'block' ? 'blockedId' : 'allowedId']: run.id });
    onState(await request<AppState>('/state'));
  }

  async function start() {
    if (lock.current || busy) return;
    lock.current = true; setWorking(true); setError(''); setProof(undefined);
    try {
      const fresh = await request<AppState>('/session/reset', 'POST', {}, state.csrf);
      onState(fresh); useReference();
      const base = { prompt: 'Research NEAR stablecoin yields and prepare a reserve for the best eligible opportunity.', amount: '150000000', kind: 'allocation-reserve' as const, counterparty: 'treasury-reserve', referenceOnly: true };
      const next: Challenge = { sessionId: fresh.sessionId, key: fresh.audit.publicKey, checkpoint: fresh.audit.checkpoint,
        blockRequest: { ...base, requestId: crypto.randomUUID(), attack: 'overspend' },
        allowRequest: { ...base, requestId: crypto.randomUUID() },
      };
      setChallenge(next);
      await submit(next, 'block', fresh.csrf);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The challenge could not start.'); }
    finally { lock.current = false; setWorking(false); }
  }

  async function advance() {
    if (!challenge || lock.current || busy || !sameSession) return;
    lock.current = true; setWorking(true); setError('');
    try {
      if (!blockPassed) await submit(challenge, 'block', state.csrf);
      else if (!allowPassed) {
        if (!allowed && state.budget.remaining !== '500000000') throw new Error('The allowance changed outside this challenge. Start a fresh challenge.');
        await submit(challenge, 'allow', state.csrf);
      } else {
        const bundle = structuredClone(state.audit);
        if (!bundle.entries.some(entry => entry.runId === blocked?.id && entry.type === 'guardian.checked')
          || !bundle.entries.some(entry => entry.runId === allowed?.id && entry.type === 'settlement.recorded')) throw new Error('The expected challenge receipts are missing.');
        const original = await verifyInBrowser(bundle, challenge.key, challenge.checkpoint);
        if (!original.valid) throw new Error(original.reason);
        const changed = structuredClone(bundle);
        if (!changed.entries[0]) throw new Error('No receipt is available for the tamper test.');
        changed.entries[0].sealed.ciphertext += '00';
        const tampered = await verifyInBrowser(changed, challenge.key, challenge.checkpoint);
        if (tampered.valid) throw new Error('The altered copy unexpectedly passed verification.');
        setProof({ bundle, verified: original.checked, tamperedCopyRejected: !tampered.valid, remaining: state.budget.remaining });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The check could not complete.'); }
    finally { lock.current = false; setWorking(false); }
  }

  const current = stage === 0 ? blocked : allowed;
  return <div className="challenge-page">
    <section className="challenge-heading"><div className="eyebrow">THE 60-SECOND BOUNDARY CHALLENGE</div><h2>Try to make it break its rules.</h2><p>Challenge the guardian. Complete an allowed mission. Check the evidence yourself.</p><span className="challenge-disclosure">Simulated USDC · reference data from 1 Nov 2026 · real cryptographic checks</span></section>
    <ol className="challenge-steps" aria-label="Challenge progress">{['Block an overspend', 'Allow a bounded action', 'Catch a changed receipt'].map((title, index) => <li key={title} className={stage > index ? 'done' : stage === index ? 'current' : ''} aria-current={stage === index ? 'step' : undefined}><span>{stage > index ? <Check size={17} /> : '0' + (index + 1)}</span><strong>{title}</strong>{stage > index && <small>Passed</small>}</li>)}</ol>
    <div className="challenge-layout"><section className={'challenge-arena ' + (proof ? 'challenge-passed' : '')} aria-label="Interactive challenge">
      {!challenge ? <><ShieldCheck className="arena-icon" size={38} strokeWidth={1.3} /><div className="eyebrow">ONE OWNER POLICY. THREE CHECKS.</div><h3>The agent asks for $501.<br />You gave it a $200 limit.</h3><p>With $500 available for the day, will the treasury let it through? Run the real rehearsal engine and inspect its decision.</p><button className="button primary" disabled={working || busy} onClick={() => void start()}>{working ? <LoaderCircle size={17} className="spin" /> : <ArrowRight size={17} />} Start the challenge</button><p className="challenge-reset-note">Starts a fresh demo session. Your current simulated missions, policy edits and audit history are reset. No wallet or real funds are involved.</p></> : proof ? <><div className="challenge-seal"><ShieldCheck size={40} strokeWidth={1.3} /></div><div className="eyebrow">THREE CHECKS. ALL PASSED.</div><h3>Ambition met its boundary.</h3><p>The overspend was denied. The $150 reserve completed. Your browser verified {proof.verified} signed receipts and rejected the altered copy.</p><div className="proof-results"><span><CheckCircle2 size={17} /> Overspend blocked</span><span><CheckCircle2 size={17} /> ${formatUsdc(proof.remaining)} remaining</span><span><CheckCircle2 size={17} /> Tampered copy rejected</span></div><div className="challenge-actions"><button className="button primary" onClick={viewEvidence}>Inspect the real-world evidence <ArrowRight size={16} /></button><button className="button secondary" onClick={() => downloadJson({ format: 'neslos-boundary-challenge-v1', scope: 'session-rehearsal', realFunds: false, pinnedSessionKey: challenge.key, retainedStartingCheckpoint: challenge.checkpoint, checks: { overspendBlocked: true, allowedReserve: '150000000', remaining: proof.remaining, verifiedReceipts: proof.verified, tamperedCopyRejected: proof.tamperedCopyRejected }, audit: proof.bundle }, 'neslos-boundary-challenge.json')}><Download size={15} /> Download this proof</button></div><p className="challenge-reset-note">This proves the browser rehearsal. The evidence room separately documents testnet enforcement and archived private research.</p></> : <>
        {stage === 0 ? <ShieldAlert className="arena-icon" size={36} /> : stage === 1 ? <ShieldCheck className="arena-icon" size={36} /> : <Fingerprint className="arena-icon" size={36} />}
        <div className="eyebrow">CHECK 0{stage + 1} / 03</div><h3>{stage === 0 ? 'The proposal meets the guardian.' : stage === 1 ? 'A smaller request. The same rules.' : 'Change one receipt. See what happens.'}</h3>
        <p>{stage === 0 ? 'Three researchers assess the reference markets. The strategist then attempts a $501 proposal against your $200 action limit and $500 daily budget.' : stage === 1 ? 'The $501 proposal was rejected before execution. Now give the same agents a $150 allocation-reserve mission.' : 'The allowed mission is complete. Verify every hash, link and signature against the session identity pinned at the start, then test a modified copy.'}</p>
        {stage > 0 && <div className="challenge-observation"><CheckCircle2 size={18} /><span><span>{stage === 1 ? 'Overspend rejected' : 'Allowed reserve completed'}</span><strong>{stage === 1 ? '$500.00 preserved after rejection' : '$350.00 of daily allowance remains'}</strong></span></div>}
        {blocked?.decision && <details className="challenge-checks"><summary>Inspect the guardian’s failed checks</summary>{blocked.decision.checks.filter(check => !check.passed).map(check => <div key={check.code}><ShieldAlert size={15} /><span><strong>{check.label}</strong><p>{check.detail}</p></span></div>)}</details>}
        {(working || busy) && <div className="challenge-working" role="status"><LoaderCircle size={17} className="spin" />{current?.steps.find(step => step.status === 'active')?.detail ?? 'Running the rehearsal checks…'}</div>}
        {!busy && !working && !failed && sameSession && <button className="button primary" onClick={() => void advance()}>{stage === 2 ? <Fingerprint size={16} /> : <ArrowRight size={16} />}{stage === 0 ? 'Recover the overspend request' : stage === 1 ? 'Run the $150 mission' : 'Verify & tamper-test receipts'}</button>}
      </>}
      {(error || failed || !sameSession) && <div className="challenge-error" role="alert"><ShieldAlert size={18} /><span>{!sameSession ? 'The demo session changed. Start a fresh challenge to pin its identity.' : error || 'A mission failed. No passing result is claimed. Start a fresh challenge to try again.'}</span></div>}
      {challenge && !working && !busy && <button className="text-link challenge-restart" onClick={() => void start()}><RotateCcw size={13} /> Start a fresh challenge (resets this demo)</button>}
    </section><aside className="challenge-context"><div className="eyebrow">THE RULES OF THIS CHALLENGE</div><div className="challenge-budget"><small>DAILY ALLOWANCE REMAINING</small><strong>${formatUsdc(state.budget.remaining)}</strong><span>Simulated USDC</span></div><dl><div><dt>Per action</dt><dd>${formatUsdc(state.policy.perTransactionLimit)}</dd></div><div><dt>Daily cap</dt><dd>${formatUsdc(state.policy.dailyLimit)}</dd></div><div><dt>Recipient</dt><dd>treasury-reserve</dd></div><div><dt>Market source</dt><dd>Reference snapshot</dd></div></dl><div className="challenge-lesson"><LockSymbol /><h3>Agents propose.<br />Your policy decides.</h3><p>Researchers inform the decision. They cannot raise a limit, add a recipient or sign with the owner’s key.</p></div>{challenge && <button className="text-link" onClick={viewAudit}>Open the session audit <ArrowRight size={14} /></button>}</aside></div>
  </div>;
}

function LockSymbol() { return <ShieldCheck size={23} strokeWidth={1.4} />; }
