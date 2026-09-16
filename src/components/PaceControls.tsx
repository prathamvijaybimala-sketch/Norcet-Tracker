import { useAppStore } from '../store/appStore';
import { computePlanStats } from '../lib/stats';
import { WEEKDAY_LABELS } from '../lib/dates';
import { formatDateLong, formatDate } from '../lib/dates';
import { formatDuration } from '../lib/duration';
import { StatCard } from './ui';

/** Global pacing controls with the always-live "you'll finish on…" preview. */
export function PaceControls() {
  const planConfig = useAppStore((s) => s.planConfig);
  const schedule = useAppStore((s) => s.schedule);
  const progress = useAppStore((s) => s.progress);
  const updatePlan = useAppStore((s) => s.updatePlan);
  // remainingLectures counts UNwatched lectures (the plan is a fixed calendar;
  // watched lectures stay on their days).
  const stats = computePlanStats(schedule, progress);

  const toggleDay = (day: number) => {
    const has = planConfig.studyDays.includes(day);
    const next = has
      ? planConfig.studyDays.filter((d) => d !== day)
      : [...planConfig.studyDays, day].sort();
    if (next.length === 0) return; // never allow a plan with zero study days
    updatePlan({ studyDays: next });
  };

  return (
    <div>
      <div className="section-title">Pacing</div>
      <div className="card">
        <div className="field-row">
          <div className="field">
            <label htmlFor="daily-hours">Daily hours</label>
            <input
              id="daily-hours"
              type="number"
              min={0.5}
              max={16}
              step={0.5}
              value={planConfig.dailyHours}
              onChange={(e) => updatePlan({ dailyHours: Math.max(0.5, Number(e.target.value) || 0.5) })}
            />
          </div>
          <div className="field">
            <label htmlFor="playback">Playback speed</label>
            <input
              id="playback"
              type="number"
              min={0.5}
              max={4}
              step={0.25}
              value={planConfig.playbackSpeed}
              onChange={(e) =>
                updatePlan({ playbackSpeed: Math.max(0.5, Number(e.target.value) || 1) })
              }
            />
          </div>
          <div className="field">
            <label htmlFor="start-date">Start date</label>
            <input
              id="start-date"
              type="date"
              value={planConfig.startDate}
              // A cleared field delivers "" - ignore it (the store also
              // rejects invalid dates); the previous date stays in force.
              onChange={(e) => e.target.value && updatePlan({ startDate: e.target.value })}
            />
          </div>
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label>Study days</label>
          <div className="row wrap" style={{ gap: 6 }}>
            {WEEKDAY_LABELS.map((label, day) => (
              <button
                key={label}
                className={`chip ${planConfig.studyDays.includes(day) ? 'on' : ''}`}
                onClick={() => toggleDay(day)}
                aria-pressed={planConfig.studyDays.includes(day)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Live preview</div>
        {stats.finishDate ? (
          <>
            <div className="small" style={{ fontSize: 15 }}>
              At these settings you'll finish{' '}
              <b>{formatDateLong(stats.finishDate)}</b>, across{' '}
              <b>{Math.round(stats.totalDays / 7)} weeks</b> ({stats.totalDays} calendar days).
            </div>
            <div className="tiny faint" style={{ marginTop: 4 }}>
              Plan ends {stats.planEndDate ? formatDate(stats.planEndDate) : '—'} including the final
              subject's buffer. Recomputed on every change.
            </div>
            <div className="stat-grid" style={{ marginTop: 12 }}>
              <StatCard value={stats.studyDays} label="Study days" />
              <StatCard value={stats.bufferDays} label="Buffer days" />
              <StatCard value={stats.remainingLectures} label="Lectures left" />
              <StatCard value={formatDuration(stats.remainingSec)} label="Watch time left" />
            </div>
          </>
        ) : (
          <div className="small muted">
            Nothing scheduled yet: include at least one subject that still has unwatched lectures.
          </div>
        )}
      </div>
    </div>
  );
}
