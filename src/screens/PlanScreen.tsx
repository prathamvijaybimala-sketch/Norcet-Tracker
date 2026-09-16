import { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { SubjectOrderList } from '../components/SubjectOrderList';
import { PaceControls } from '../components/PaceControls';
import { LeaveManager } from '../components/LeaveManager';
import { MIN_LOCK_LENGTH } from '../lib/lock';

type Tab = 'order' | 'leave';

const TABS: { id: Tab; label: string }[] = [
  { id: 'order', label: 'Order & pace' },
  { id: 'leave', label: 'Leave days' },
];

export function PlanScreen() {
  const [tab, setTab] = useState<Tab>('order');

  return (
    <div className="screen">
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'order' ? (
        <>
          <PaceControls />
          <SubjectOrderList />
          <LockCard />
        </>
      ) : null}
      {tab === 'leave' ? <LeaveManager /> : null}
    </div>
  );
}

/**
 * Password lock for the planning screen (so the plan is not changed on a
 * whim). First visit: set a password (with confirmation). Afterwards the
 * screen itself asks for it on every app launch; here you can change it or
 * re-lock immediately.
 */
function LockCard() {
  const planLockHash = useAppStore((s) => s.planLockHash);
  const setPlanPassword = useAppStore((s) => s.setPlanPassword);
  const lockPlan = useAppStore((s) => s.lockPlan);
  const notify = useAppStore((s) => s.notify);
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const locked = Boolean(planLockHash);
  const valid = pw.length >= MIN_LOCK_LENGTH && pw === confirm;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    const ok = await setPlanPassword(pw);
    setBusy(false);
    if (ok) {
      setPw('');
      setConfirm('');
      notify(locked ? 'Plan password changed.' : 'Plan locked. The Plan tab now asks for your password.');
    }
  };

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="card-title">
        <span>🔒 Plan lock</span>
        <span className="spacer" />
        {locked ? (
          <button className="btn sm" onClick={lockPlan} title="Re-lock right now">
            Lock now
          </button>
        ) : null}
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>
        {locked
          ? 'The Plan tab asks for this password on every app launch. Change it below, or remove the lock entirely from Data → Danger zone.'
          : 'Set a password so the planning screen cannot be changed on a whim. It is asked on every app launch before the plan can be edited.'}
      </p>
      <div className="field-row">
        <div className="field">
          <label htmlFor="lock-pw">{locked ? 'New password' : 'Password'}</label>
          <input
            id="lock-pw"
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder={`At least ${MIN_LOCK_LENGTH} characters`}
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor="lock-confirm">Repeat it</label>
          <input
            id="lock-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            placeholder="Same again"
            autoComplete="off"
          />
        </div>
      </div>
      {pw.length >= MIN_LOCK_LENGTH && pw !== confirm ? (
        <div className="err-box" style={{ marginTop: 10 }}>
          The passwords do not match yet.
        </div>
      ) : null}
      <button className="btn primary" style={{ marginTop: 12 }} disabled={!valid || busy} onClick={() => void submit()}>
        {busy ? 'Saving…' : locked ? 'Change password' : 'Set lock'}
      </button>
    </div>
  );
}
