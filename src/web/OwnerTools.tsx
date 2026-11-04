import { useState } from 'react';
import type { OwnerState } from '../owner/workspace.js';
import { parseUsdc } from '../core/amounts.js';

export function FundingPanel({ disabled, onPlan }: { disabled: boolean; onPlan: (operation: unknown) => void }) {
  const [amount, setAmount] = useState('1');
  const [error, setError] = useState('');
  return <section className="panel owner-section">
    <h2>Fund your vault</h2>
    <p className="muted">Register token storage, then transfer from your owner account. Each action opens its own transaction review.</p>
    <div className="owner-actions">
      <button className="button secondary" disabled={disabled} onClick={() => onPlan({ kind: 'register-token', account: 'vault' })}>Review vault storage</button>
      <button className="button secondary" disabled={disabled} onClick={() => onPlan({ kind: 'register-token', account: 'owner' })}>Review owner storage</button>
    </div>
    <form className="owner-form" onSubmit={event => {
      event.preventDefault(); setError('');
      try { onPlan({ kind: 'fund', amount: parseUsdc(amount) }); } catch { setError('Enter a positive amount with up to six decimal places.'); }
    }}>
      <label>Funding amount (vault token)<input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" required /></label>
      {error && <p role="alert">{error}</p>}
      <button className="button primary" disabled={disabled}>Review funding transfer</button>
    </form>
  </section>;
}

export function SchedulePanel({ state, disabled, onResearch, onControl, onObserve, selectedJob }: {
  state: OwnerState; disabled: boolean; selectedJob?: string;
  onResearch: (intervalSeconds: number, maxRuns: number) => void;
  onObserve: (jobId: string, intervalSeconds: number, maxRuns: number) => void;
  onControl: (id: string, state: 'active' | 'paused') => void;
}) {
  const [interval, setInterval] = useState(3600), [runs, setRuns] = useState(3);
  return <section className="panel owner-section">
    <h2>Bounded schedules</h2>
    <p className="muted">Repeat the current research objective or watch a prepared settlement while the owner server is running. Research uses the same shared inference allowance.</p>
    <div className="owner-form">
      <div className="form-row">
        <label>Interval<select value={interval} onChange={e => setInterval(Number(e.target.value))}><option value={300}>5 minutes</option><option value={3600}>1 hour</option><option value={86400}>1 day</option></select></label>
        <label>Maximum attempts<input type="number" min={1} max={12} value={runs} onChange={e => setRuns(Number(e.target.value))} /></label>
      </div>
      <div className="owner-actions">
        <button className="button secondary" disabled={disabled || runs < 1 || runs > 12} onClick={() => onResearch(interval, runs)}>Schedule research</button>
        {selectedJob && <button className="button secondary" disabled={disabled || runs < 1 || runs > 12} onClick={() => onObserve(selectedJob, interval, runs)}>Watch selected settlement</button>}
      </div>
      <p className="fine-print">The first attempt starts after one interval. Missed intervals are skipped. Errors pause the schedule for review; resuming recovers the saved request. Schedules never submit transactions.</p>
    </div>
    {(state.schedules ?? []).map(s => <div className="owner-list-row" key={s.id}>
      <span><strong>{s.type} · {s.state}</strong><small>{s.runs}/{s.maxRuns} attempts · {new Date(s.nextRunAt).toLocaleString()}</small>{s.errorCode && <small className="error-text">{s.errorCode}</small>}</span>
      {s.state !== 'complete' && <button className="button secondary" disabled={disabled} onClick={() => onControl(s.id, s.state === 'active' ? 'paused' : 'active')}>{s.state === 'active' ? 'Pause schedule' : 'Resume saved request'}</button>}
    </div>)}
  </section>;
}
