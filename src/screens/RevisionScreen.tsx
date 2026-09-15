import { useMemo, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { dueRevisions, stageLabel, upcomingRevisions } from '../lib/revision';
import { EmptyState, StatCard } from '../components/ui';
import { formatDate, todayISO } from '../lib/dates';
import { formatDuration } from '../lib/duration';

/**
 * Revision tracker (section 6).
 *
 * Reads Progress (a lecture becomes eligible once lecture + notes + questions
 * are all ticked) and writes only to RevisionStore. It never touches the main
 * schedule and revision work does not consume daily hours.
 */
export function RevisionScreen() {
  const revision = useAppStore((s) => s.revision);
  const lectureIndex = useAppStore((s) => s.lectureIndex);
  const planConfig = useAppStore((s) => s.planConfig);
  const setRevisionIntervals = useAppStore((s) => s.setRevisionIntervals);
  const reviewLecture = useAppStore((s) => s.reviewLecture);
  const skipLectureReview = useAppStore((s) => s.skipLectureReview);
  const removeRevision = useAppStore((s) => s.removeRevision);
  const [showSettings, setShowSettings] = useState(false);

  const today = todayISO();
  const intervals = planConfig.revisionIntervals;
  const due = useMemo(() => dueRevisions(revision, today), [revision, today]);
  const upcoming = useMemo(() => upcomingRevisions(revision, today), [revision, today]);
  const graduated = useMemo(
    () => Object.values(revision).filter((i) => i.intervalStage >= intervals.length - 1).length,
    [revision, intervals.length],
  );

  return (
    <div className="screen">
      <div className="row between wrap" style={{ marginBottom: 10 }}>
        <div className="stat-grid" style={{ flex: 1 }}>
          <StatCard value={due.length} label="Due today" tone={due.length ? 'var(--warn)' : undefined} />
          <StatCard value={upcoming.length} label="Scheduled" />
          <StatCard value={graduated} label="On final interval" />
          <StatCard value={Object.keys(revision).length} label="In queue" />
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <span>Due for revision</span>
          <span className="spacer" />
          <button className="btn sm ghost" onClick={() => setShowSettings((v) => !v)}>
            {showSettings ? 'Hide settings' : 'Intervals'}
          </button>
        </div>

        {showSettings ? (
          <div className="card tight" style={{ marginBottom: 12, background: 'var(--bg-elev-2)' }}>
            <div className="field">
              <label>Revision intervals (days)</label>
              <div className="row" style={{ gap: 6 }}>
                {intervals.map((days, i) => (
                  <input
                    key={i}
                    type="number"
                    min={1}
                    max={365}
                    value={days}
                    onChange={(e) => {
                      const next = [...intervals];
                      next[i] = Math.max(1, Math.round(Number(e.target.value) || 1));
                      setRevisionIntervals(next);
                    }}
                    aria-label={`Interval ${i + 1} in days`}
                  />
                ))}
                <button
                  className="btn sm ghost"
                  onClick={() => setRevisionIntervals(intervals.slice(0, -1))}
                  disabled={intervals.length <= 1}
                  aria-label="Remove last interval"
                >
                  −
                </button>
                <button
                  className="btn sm ghost"
                  onClick={() => setRevisionIntervals([...intervals, intervals[intervals.length - 1] * 2])}
                  aria-label="Add interval"
                >
                  +
                </button>
              </div>
            </div>
            <div className="tiny faint" style={{ marginTop: 8 }}>
              A lecture enters the queue {intervals[0]} days after lecture + notes + questions are
              all ticked. After the last interval it loops on that interval forever, so nothing ever
              disappears from revision.
            </div>
          </div>
        ) : null}

        {due.length === 0 ? (
          <EmptyState icon="🎉" title="Nothing due">
            Lectures join this queue once you tick all three boxes (watched, notes, questions) on the
            Today or Timeline screen.
          </EmptyState>
        ) : (
          due.map((item) => {
            const ref = lectureIndex.get(item.lectureId);
            const overdueDays = Math.max(
              0,
              Math.round((Date.parse(today) - Date.parse(item.nextDueDate)) / 86_400_000),
            );
            return (
              <div className="lecture" key={item.lectureId}>
                <div className="lecture-head">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="lecture-name">{ref?.lecture.name ?? item.lectureId}</div>
                    <div className="lecture-sub">
                      <span>{ref?.subject.name ?? 'Unknown subject'}</span>
                      <span aria-hidden>·</span>
                      <span className="truncate">{ref?.topic.name ?? ''}</span>
                      {ref ? (
                        <>
                          <span aria-hidden>·</span>
                          <span className="mono">{formatDuration(ref.lecture.durationSec)}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <span className="badge accent">{stageLabel(item.intervalStage, intervals)}</span>
                </div>
                <div className="lecture-sub">
                  {overdueDays > 0 ? (
                    <span className="badge warn">{overdueDays}d overdue</span>
                  ) : (
                    <span className="badge">due today</span>
                  )}
                  <span className="tiny faint">
                    reviewed {item.history.filter((h) => h.result === 'done').length}×
                  </span>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn sm primary" onClick={() => reviewLecture(item.lectureId)}>
                    Reviewed
                  </button>
                  <button className="btn sm" onClick={() => skipLectureReview(item.lectureId)}>
                    Skip (push 1 day)
                  </button>
                  <button className="btn sm ghost" onClick={() => removeRevision(item.lectureId)}>
                    Drop
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {upcoming.length ? (
        <div className="card">
          <div className="card-title">Coming up</div>
          {upcoming.slice(0, 30).map((item) => {
            const ref = lectureIndex.get(item.lectureId);
            return (
              <div className="lecture-pick" key={item.lectureId}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="small truncate">{ref?.lecture.name ?? item.lectureId}</div>
                  <div className="tiny faint truncate">
                    {ref?.subject.name ?? 'Unknown subject'} ·{' '}
                    {stageLabel(item.intervalStage, intervals)}
                  </div>
                </div>
                <span className="badge">{formatDate(item.nextDueDate)}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
