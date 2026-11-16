import { useMemo, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { nextOffDayOnOrAfter } from '../lib/schedule';
import { missedLectures } from '../lib/stats';
import { EmptyState, Modal, StatCard } from '../components/ui';
import { formatDate, todayISO } from '../lib/dates';
import { formatDuration } from '../lib/duration';

/** sessionStorage key for the dismissed backlog footnote (per session). */
const BACKLOG_NOTE_KEY = 'norcet.backlogNoteDismissed';

/**
 * Backlog (its own tab now, split from Revision).
 *
 * Missed lectures (scheduled on a past day, still unwatched - or dropped off
 * the plan entirely) with two remedies per lecture:
 *   1. "To <off day>"  - park it on the next off day (usually Sunday), which
 *      then shows up in the calendar as a study day; the rest of the plan
 *      does not move.
 *   2. "Shift schedule" - re-spread the whole plan from today; the first
 *      off day after today (usually Sunday) opens as an extra day that
 *      absorbs the week's overflow lecture.
 */
export function BacklogScreen() {
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
  const missed = useMemo(
    () => missedLectures(schedule, lectureIndex, planConfig.subjectOrder, progress, today),
    [schedule, lectureIndex, planConfig.subjectOrder, progress, today],
  );

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
    <div className="screen">
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
