import { memo, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { formatClock, formatDuration } from '../lib/duration';
import { subjectColor } from '../lib/colors';

/**
 * One lecture with ONE checkbox: ticking it sets BOTH `lectureWatched` and
 * `notesDone` in the same update, unticking clears both. The two fields stay
 * separate in the data model (the revision-queue gate still reads them
 * individually) - this is a UI simplification, not a schema change.
 *
 * MCQ practice is still tracked per TOPIC, not per lecture - see
 * `TopicSection`, which renders the single "Questions" checkbox per topic.
 *
 * Subscribes only to its own progress record, so ticking the box re-renders
 * this row and the schedule - never the whole list (and never with a page
 * reload or a scroll jump).
 *
 * Three shapes:
 *  - CLASSIC (no `onToggle`): flat row with name, context and the checkbox.
 *    Used by flat lists ("Done today").
 *  - ACCORDION COLLAPSED: a compact one-line button (tick-if-done + name +
 *    duration, no checkbox).
 *  - ACCORDION EXPANDED (the focused row): one large finger-friendly
 *    checkbox + a larger name + duration. The parent owns "which row is
 *    open" - see `useAccordion`. Hierarchy comes from type size/weight, not
 *    from a boxed background.
 */
export const LectureRow = memo(function LectureRow({
  lectureId,
  showContext = true,
  showScheduledDate = false,
  expanded = false,
  onToggle,
  hideSubject = false,
}: {
  lectureId: string;
  showContext?: boolean;
  showScheduledDate?: boolean;
  /** Accordion mode only: this row is the expanded (focused) one. */
  expanded?: boolean;
  /** Present = accordion row (collapsed button / expanded row). Absent = classic flat row. */
  onToggle?: () => void;
  /** Hide the per-row subject when the whole list belongs to one subject. */
  hideSubject?: boolean;
}) {
  const ref = useAppStore((s) => s.lectureIndex.get(lectureId));
  const progress = useAppStore((s) => s.progress[lectureId]);
  const speed = useAppStore((s) => s.planConfig.playbackSpeed);
  const scheduledDate = useAppStore((s) => s.scheduleByLecture.get(lectureId));
  const setFlags = useAppStore((s) => s.setFlags);
  const theme = useAppStore((s) => s.theme);

  /** One box = watched + notes, always set together. */
  const onToggleBoth = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.checked;
      setFlags(lectureId, { lectureWatched: value, notesDone: value });
    },
    [setFlags, lectureId],
  );

  if (!ref) return null;

  const effSec = ref.lecture.durationSec / (speed > 0 ? speed : 1);
  const color = subjectColor(ref.subject.id, theme);
  const done = Boolean(progress?.lectureWatched);
  const fullyDone = done && Boolean(progress?.notesDone);
  const checked = fullyDone;

  const speedBadge =
    speed !== 1 ? (
      <span className="badge accent">{formatDuration(effSec)} at {speed}×</span>
    ) : null;
  const dueBadge =
    showScheduledDate && scheduledDate ? (
      <span className="badge">due {scheduledDate.slice(5)}</span>
    ) : null;

  const context = showContext ? (
    <div className="lecture-sub">
      {!hideSubject ? (
        <>
          <span>{ref.subject.name}</span>
          <span aria-hidden>·</span>
        </>
      ) : null}
      <span className="truncate">{ref.topic.name}</span>
      <span aria-hidden>·</span>
      {speedBadge}
      {dueBadge}
    </div>
  ) : null;

  const bigCheck = (
    <label className="check check-big" title="Lecture + notes, in one box">
      <input type="checkbox" checked={checked} onChange={onToggleBoth} />
      <span className="check-label">Done</span>
    </label>
  );

  // ------- classic flat row ("Done today") -------
  if (!onToggle) {
    return (
      <div className="lecture flat">
        <div className="lecture-head">
          {showContext ? <span className="dot" style={{ background: color.base }} /> : null}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="lecture-name" style={done ? { color: 'var(--text-dim)' } : undefined}>
              {ref.lecture.name}
            </div>
            <div className="lecture-sub">
              {showContext ? (
                <>
                  <span>{ref.subject.name}</span>
                  <span aria-hidden>·</span>
                  <span className="truncate">{ref.topic.name}</span>
                  <span aria-hidden>·</span>
                </>
              ) : null}
              <span className="mono">{formatClock(ref.lecture.durationSec)}</span>
            </div>
          </div>
          {bigCheck}
        </div>
      </div>
    );
  }

  // ------- accordion row: collapsed -------
  if (!expanded) {
    return (
      <button
        type="button"
        className={`lecture acc ${done ? 'done' : ''}`}
        onClick={onToggle}
        aria-expanded={false}
      >
        <span className={`acc-tick ${fullyDone ? 'on' : ''}`} aria-hidden>
          {fullyDone ? '✓' : ''}
        </span>
        <span className="acc-name truncate">{ref.lecture.name}</span>
        <span className="acc-dur mono">{formatClock(ref.lecture.durationSec)}</span>
      </button>
    );
  }

  // ------- accordion row: expanded (the focused lecture) -------
  return (
    <div className={`lecture acc open ${done ? 'done' : ''}`}>
      <button type="button" className="acc-head" onClick={onToggle} aria-expanded={true}>
        <span className="acc-name truncate">{ref.lecture.name}</span>
        <span className="acc-dur mono">{formatClock(ref.lecture.durationSec)}</span>
      </button>
      <div className="acc-body">
        {context}
        {bigCheck}
      </div>
    </div>
  );
});
