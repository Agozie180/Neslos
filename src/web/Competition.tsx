import type { ReactNode } from 'react';
import { Activity, ArrowRight, ArrowUpRight, Check, CheckCircle2, Download, ExternalLink, Fingerprint, LockKeyhole, ScanSearch, ShieldAlert, ShieldCheck } from 'lucide-react';
import { evidence, downloadJson, source } from './evidence.js';
import './competition.css';

export function CompetitionIntro({ challenge, inspect }: { challenge: () => void; inspect: () => void }) {
  return <section className="competition-intro" aria-label="Explore Neslos">
    <div className="intro-copy">
      <div className="eyebrow"><span className="tiny-dot lime" /> PRIVATE RESEARCH. ENFORCEABLE LIMITS.</div>
      <h2>Give agents ambition.<br /><span>Keep the authority.</span></h2>
      <p>A treasury for owners who want agents to research and prepare payments, with a hard boundary on what they can spend.</p>
      <div className="intro-actions"><button className="button primary" onClick={challenge}><PlayMark /> Take the 60-second challenge <ArrowRight size={16} /></button><button className="text-link" onClick={inspect}>Inspect the evidence <ArrowUpRight size={15} /></button></div>
      <div className="intro-caption">No wallet. No funds. An interactive rehearsal you can verify.</div>
    </div>
    <div className="boundary-visual" aria-label="Architecture: three researchers propose; the owner policy governs spending">
      <div className="visual-caption"><span>THE SPENDING BOUNDARY</span><span>01 / POLICY FIRST</span></div>
      <div className="researcher-nodes"><span><ScanSearch size={16} /> Yield</span><span><Activity size={16} /> Liquidity</span><span><ShieldAlert size={16} /> Risk</span></div>
      <div className="boundary-connectors" aria-hidden="true"><i /><i /><i /></div>
      <div className="policy-gate"><span className="gate-emblem"><ShieldCheck size={30} strokeWidth={1.3} /></span><div><small>OWNER-DEFINED AUTHORITY</small><strong>Your policy decides.</strong><span>Budget · recipient · route · nonce</span></div><LockKeyhole size={18} /></div>
      <div className="gate-output"><span><Check size={13} /> Within policy</span><span><ShieldAlert size={13} /> Outside policy</span></div>
      <div className="visual-foot"><span>NEAR vault</span><span>Spending limits enforced in the contract <ArrowRight size={12} /></span></div>
    </div>
  </section>;
}

function PlayMark() { return <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true"><path d="M3 1.5 11 6.5 3 11.5Z" fill="currentColor" /></svg>; }
function EvidenceLink({ href, children }: { href: string; children: ReactNode }) { return <a href={href} target="_blank" rel="noreferrer">{children}<ExternalLink size={13} /></a>; }

export function EvidencePage({ challenge }: { challenge: () => void }) {
  const { vault, research, settlement } = evidence;
  return <div className="evidence-page">
    <div className="evidence-lead"><div><div className="eyebrow">REVIEW THE CLAIM. FOLLOW THE RECEIPT.</div><h2>Proof you can follow.</h2><p>Three separate environments, with explicit boundaries. The interactive demo is a rehearsal; the records below preserve real testnet and private-research results.</p></div><button className="button secondary" onClick={() => downloadJson(evidence, 'neslos-evidence-index.json')}><Download size={15} /> Download evidence index</button></div>
    <div className="evidence-grid">
      <article className="evidence-card primary-proof"><div className="evidence-card-top"><ShieldCheck size={22} /><span className="evidence-tag">SECURITY · TESTNET</span><span>06 NOV 2026</span></div><h3>The contract says no.</h3><p>One allowed transfer. One rejected overspend. One rejected replay. Real NEAR receipts, under the same spending authority.</p>
        <div className="chain-receipts">{vault.transactions.map(tx => <EvidenceLink key={tx.step} href={tx.explorer}><span className={'receipt-status ' + (tx.success ? 'allowed' : 'blocked')}>{tx.success ? <CheckCircle2 size={16} /> : <ShieldAlert size={16} />}{tx.step === 'allowed' ? 'Transfer executed' : tx.step === 'daily-limit' ? 'Daily limit enforced' : 'Replay rejected'}</span><code>{tx.transactionHash.slice(0, 9)}…</code></EvidenceLink>)}</div>
        <p className="evidence-scope">Fixture tokens on testnet. The vault was restored and paused after verification. These receipts are independent of your browser session.</p><div className="evidence-links"><EvidenceLink href={vault.report}>Read enforcement proof</EvidenceLink><EvidenceLink href={vault.record}>Source record</EvidenceLink></div>
      </article>
      <article className="evidence-card"><div className="evidence-card-top"><LockKeyhole size={22} /><span className="evidence-tag">PRIVACY · ARCHIVED TDX</span><span>09 NOV 2026</span></div><h3>Private research. Signed findings.</h3><p>Three specialist researchers completed against live Rhea markets inside independently verified Intel TDX.</p>
        <div className="research-proof-rows">{research.researchers.map(agent => <div key={agent.agent}><CheckCircle2 size={16} /><strong>{agent.agent}</strong><span>{agent.assessments} markets assessed</span><span>Signed</span></div>)}</div>
        <p className="evidence-scope">NEAR AI provider administration is explicitly trusted; loaded model weights are not independently proved. The temporary TDX server is retired.</p><div className="evidence-links"><EvidenceLink href={research.report}>Read private research proof</EvidenceLink><EvidenceLink href={research.record}>Checksum index</EvidenceLink></div>
      </article>
      <article className="evidence-card"><div className="evidence-card-top"><Fingerprint size={22} /><span className="evidence-tag">TRY IT · IN YOUR BROWSER</span></div><h3>Trust has a test button.</h3><p>Attempt a $501 spend. Complete a $150 reserve. Verify the original encrypted history, then alter one copy and watch verification fail.</p><div className="proof-equation"><span>$500<small>initial allowance</small></span><ArrowRight size={20} /><span>$350<small>after allowed reserve</small></span></div><p className="evidence-scope">Simulated funds and deterministic researchers. Real SHA-256 and Ed25519 checks against a session key pinned when the challenge starts.</p><button className="button primary" onClick={challenge}>Take the challenge <ArrowRight size={15} /></button></article>
      <article className="evidence-card caveat-proof"><div className="evidence-card-top"><ShieldAlert size={22} /><span className="evidence-tag">MAINNET · FEE CAP FAILED</span><span>09 NOV 2026</span></div><h3>Full principal back. A failed cost cap.</h3><p>The separate owner-wallet Confidential Intents round trip returned all {settlement.principal} NEAR. Native charges exceeded the approved cap.</p><dl className="cost-proof"><div><dt>Actual native charges</dt><dd>{settlement.charged} NEAR</dd></div><div><dt>Stated cap</dt><dd>{settlement.cap} NEAR</dd></div></dl><p className="evidence-scope">The estimate missed account-creation charges. This was an owner-wallet experiment, with no Neslos vault or TDX execution. The archived result remains failed.</p><div className="evidence-links"><EvidenceLink href={settlement.report}>Read the full result</EvidenceLink><EvidenceLink href={'https://nearblocks.io/txns/' + settlement.returnTransaction}>Return receipt</EvidenceLink></div></article>
    </div>
    <section className="track-fit"><div className="eyebrow">ONE PRODUCT. FOUR CONNECTED TRACKS.</div><h2>Spending authority is the common thread.</h2><div>{[
      ['Security', 'A spending boundary enforced on NEAR, including shared budgets and replay rejection.'],
      ['Privacy', 'Encrypted research and verifiable execution identity under a disclosed trust model.'],
      ['DeFi', 'Rhea yield, liquidity and risk analysis that produces policy-constrained proposals.'],
      ['Swarms', 'Three researchers and a strategist share one policy; models cannot enlarge their authority.'],
    ].map(([track, detail]) => <article key={track}><strong>{track}</strong><p>{detail}</p></article>)}</div></section>
    <section className="proof-boundaries"><h2>What remains to prove</h2><p>A complete funded TDX-to-mainnet-vault payment, a funded lending cycle and a live owner-browser session. Native-fee preflight and independent security review remain open. The public rehearsal opens no lending position.</p><EvidenceLink href={source('roadmap.md')}>Inspect the roadmap</EvidenceLink></section>
  </div>;
}
