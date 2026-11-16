import { useState } from 'react';
import { useAppStore } from '../store/appStore';

/**
 * Gate in front of the Plan screen while a password is set and the session is
 * not unlocked. The plan re-locks on every app launch, so a stray tap on the
 * Plan tab can never edit the plan "on a whim".
 */
export function PlanLockScreen() {
  const checkPlanPassword = useAppStore((s) => s.checkPlanPassword);
  const [pw, setPw] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!pw || busy) return;
    setBusy(true);
    const ok = await checkPlanPassword(pw);
    setBusy(false);
    if (!ok) {
      setPw('');
      setError(true);
    }
  };

  return (
    <div className="screen">
      <div className="card lock-card">
        <div className="lock-icon" aria-hidden>
          🔒
        </div>
        <h2>The plan is locked</h2>
        <p className="small muted">
          Enter the password to open the planning screen. This is only here to stop accidental
          changes - your progress and schedule are safe either way.
        </p>
        <input
          type="password"
          value={pw}
          onChange={(e) => {
            setPw(e.target.value);
            setError(false);
          }}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          placeholder="Password"
          aria-label="Plan password"
          autoFocus
        />
        {error ? <div className="err-box">Wrong password - try again.</div> : null}
        <button className="btn primary block" onClick={() => void submit()} disabled={busy || !pw}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </div>
    </div>
  );
}
