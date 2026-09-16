import { useMemo, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { dueRevisions, stageLabel, upcomingRevisions } from '../lib/revision';
import { nextOffDayOnOrAfter } from '../lib/schedule';
import { EmptyState, Modal, StatCard } from '../components/ui';
import { formatDate, todayISO } from '../lib/dates';
import { formatDuration } from '../lib/duration';

/** sessionStorage key for the dismissed backlog footnote (per session). */
const BACKLOG_NOTE_KEY = 'norcet.backlogNoteDismissed';

/**
 * Revision + Backlog (section 6 and the Backlog feature).
 *
 * - "Revision": the spaced-repetition queue (unchanged behaviour).
 * - "Backlog": missed lectures (scheduled on a past day, still unwatched)
 *   with two remedies per lecture:
 *     1. "To <off day>"  - park it on the next off day (usually Sunday), which
 *        then shows up in the calendar as a study day; the rest of the plan
 *        does not move.
 *     2. "Shift schedule" - re-spread the whole plan from today; the first
 *        off day after today (usually Sunday) opens as an extra day that
 *        absorbs the week's overflow lecture.
 */
export function RevisionScreen() {
  const [tab, setTab] = useState<'revision' | 'backlog'>('revision');

  return (
    <div className="screen">
      <div className="tabs">
        <button className={tab === 'revision' ? 'on' : ''} onClick={() => setTab('revision')}>
          Revision
        </button>
        <button className={tab === 'backlog' ? 'on' : ''} onClick={() => setTab('backlog')}>
          Backlog
        </button>
      </div>
      {tab === 'revision' ? <RevisionTab /> : <BacklogTab />}
    </div>
  );
}

function RevisionTab() {
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
    <div>
      <div className="row between wrap" style={{ marginBottom: 10 }}>
        <div className="stat-grid flat" style={{ flex: 1 }}>
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

function BacklogTab() {
  const schedule = useAppStore((s) => s.schedule);
  const progress = useAppStore((s) => s.progress);
  const planConfig = useAppStore((s) => s.planConfig);
  const lectureIndex = useAppStore((s) => s.lectureIndex);
  const moveLectureToOffDay = useAppStore((s) => s.moveLectureToOffDay);
  const returnLectureFromOffDay = useAppStore((s) => s.returnLectureFromOffDay);
  const shiftScheduleFromBacklog = useAppStore((s) => s.shiftScheduleFromBacklog);
  const [confirmShift, setConfirmShift] = useState(false);
  /** The "why does Sunday appear" footnote hides itself for the session once dismissed. */
  const [noteDismissed, setNoteDismissed] = useState(
    () => sessionStorage.getItem(BACKLOG_NOTE_KEY) === '1',
  );

  const today = todayISO();

  /**
   * Lectures scheduled on past days that are still unwatched, plus any
   * unwatched lecture the plan no longer schedules at all (the tail that
   * drops off when a day's hours are reduced on a plan with no off day -
   * `date` is empty for those).
   */
  const missed = useMemo(() => {
    const out: { id: string; date: string }[] = [];
    const scheduled = new Set<string>();
    for (const d of schedule) {
      if (d.type !== 'study') continue;
      for (const id of d.lectureIds) {
        scheduled.add(id);
        if (d.date < today) out.push({ id, date: d.date });
      }
    }
    const included = new Set(planConfig.subjectOrder);
    for (const [id, ref] of lectureIndex) {
      if (progress[id]?.lectureWatched) continue;
      if (!included.has(ref.subject.id)) continue;
      if (scheduled.has(id)) continue;
      out.push({ id, date: '' });
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }, [schedule, lectureIndex, planConfig.subjectOrder, progress, today]);

  /** Lectures parked on off days, soonest first. */
  const moved = useMemo(
    () =>
      Object.entries(planConfig.offDayLectures)
        .filter(([id]) => lectureIndex.has(id) && !progress[id]?.lectureWatched)
        .sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)),
    [planConfig.offDayLectures, lectureIndex, progress],
  );

  const offDay = nextOffDayOnOrAfter(today, planConfig);

  return (
    <div>
      <div className="stat-grid flat" style={{ marginBottom: 12 }}>
        <StatCard value={missed.length} label="Missed" tone={missed.length ? 'var(--warn)' : undefined} />
        <StatCard value={moved.length} label="On off day" />
      </div>

      <div className="card">
        <div className="card-title">
          <span>Missed lectures</span>
          <span className="spacer" />
          <span className="tiny faint">due on a past day, still unwatched</span>
        </div>

        {missed.length === 0 ? (
          <EmptyState icon="🎯" title="Nothing missed">
            You are all caught up. If you skip a lecture, it will show up here and you can park it
            on an off day or shift the week.
          </EmptyState>
        ) : (
          missed.map(({ id, date }) => {
            const ref = lectureIndex.get(id);
            if (!ref) return null;
            return (
              <div className="lecture" key={id}>
                <div className="lecture-head">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="lecture-name">{ref.lecture.name}</div>
                    <div className="lecture-sub">
                      <span>{ref.subject.name}</span>
                      <span aria-hidden>·</span>
                      <span className="truncate">{ref.topic.name}</span>
                      <span aria-hidden>·</span>
                      <span className="mono">{formatDuration(ref.lecture.durationSec)}</span>
                    </div>
                  </div>
                  <span className="badge warn">
                    {date ? `was due ${formatDate(date)}` : 'dropped from the plan'}
                  </span>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  {offDay ? (
                    <button className="btn sm primary" onClick={() => moveLectureToOffDay(id)}>
                      To {formatDate(offDay)} (off day)
                    </button>
                  ) : (
                    <span className="badge">plan has no off days</span>
                  )}
                  <button className="btn sm" onClick={() => setConfirmShift(true)}>
                    Shift schedule
                  </button>
                </div>
              </div>
            );
          })
        )}

        {missed.length > 0 && !noteDismissed ? (
          <div className="tiny faint backlog-note" style={{ marginTop: 8 }}>
            <span>
              {offDay
                ? `“To ${formatDate(offDay)}” parks just this lecture on your next off day - the rest of the plan stays put. “Shift schedule” re-spreads everything from today and opens the next off day for the extra lecture.`
                : '“Shift schedule” re-spreads everything from today so the missed lecture lands in the coming days. (Your plan currently has no off days to park lectures on.)'}
            </span>
            <button
              type="button"
              className="backlog-note-x"
              aria-label="Hide this note"
              onClick={() => {
                setNoteDismissed(true);
                try {
                  sessionStorage.setItem(BACKLOG_NOTE_KEY, '1');
                } catch {
                  // sessionStorage unavailable (private mode) - it just won't persist
                }
              }}
            >
              ×
            </button>
          </div>
        ) : null}
      </div>

      {moved.length ? (
        <div className="card">
          <div className="card-title">
            <span>Waiting on off days</span>
            <span className="spacer" />
            <span className="tiny faint">they will appear on the Today screen that day</span>
          </div>
          {moved.map(([id, date]) => {
            const ref = lectureIndex.get(id);
            if (!ref) return null;
            return (
              <div className="lecture-pick" key={id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="small truncate">{ref.lecture.name}</div>
                  <div className="tiny faint truncate">{ref.subject.name}</div>
                </div>
                <span className="badge accent">{formatDate(date)}</span>
                <button
                  className="btn sm ghost"
                  onClick={() => returnLectureFromOffDay(id)}
                  title="Return to the normal plan"
                >
                  Return to plan
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      {confirmShift ? (
        <Modal
          title="Shift the schedule?"
          onClose={() => setConfirmShift(false)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setConfirmShift(false)}>
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  shiftScheduleFromBacklog();
                  setConfirmShift(false);
                }}
              >
                Shift schedule
              </button>
            </>
          }
        >
          <p className="small">
            The whole plan re-spreads from the next study day, so every missed lecture lands in the
            coming days instead of staying in the past.{' '}
            {offDay
              ? `The first off day after today (usually the following ${formatDate(offDay)}) opens as an extra study day that absorbs the week's overflow lecture.`
              : 'Your plan studies every weekday, so there is no extra off day to open.'}
          </p>
          <p className="small muted">
            This only changes dates - no progress is touched, and you can re-plan any time.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
