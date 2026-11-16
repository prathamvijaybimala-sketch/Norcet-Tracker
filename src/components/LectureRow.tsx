import { memo, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { formatClock, formatDuration } from '../lib/duration';

/**
 * One lecture, ONE flat row: the lecture name on the left, a square
 * checkbox on the right. Tapping anywhere on the row ticks the box.
 *
 * Ticking sets BOTH `lectureWatched` and `notesDone` in the same update,
 * unticking clears both. The two fields stay separate in the data model
 * (the revision-queue gate still reads them individually) - this is a UI
 * simplification, not a schema change.
 *
 * The row carries a small faint line with subject · topic · duration
 * (or just duration, when the list is already grouped by topic).
 *
 * Subscribes only to its own progress record, so ticking the box re-renders
 * this row and the schedule - never the whole list (no page reload, no
 * scroll jump).
 */
export const LectureRow = memo(function LectureRow({
  lectureId,
  showContext = true,
  showScheduledDate = false,
  hideSubject = false,
}: {
  lectureId: string;
  /** Show the faint context line (subject · topic · duration). */
  showContext?: boolean;
  /** Show a "due <date>" badge on the context line (day-detail views). */
  showScheduledDate?: boolean;
  /** Hide the per-row subject when the whole list belongs to one subject. */
  hideSubject?: boolean;
}) {
  const ref = useAppStore((s) => s.lectureIndex.get(lectureId));
  const progress = useAppStore((s) => s.progress[lectureId]);
  const speed = useAppStore((s) => s.planConfig.playbackSpeed);
  const scheduledDate = useAppStore((s) => s.scheduleByLecture.get(lectureId));
  const setFlags = useAppStore((s) => s.setFlags);

  if (!ref) return null;

  // One box = watched + notes, always set together.
  const onToggleBoth = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.checked;
      setFlags(lectureId, { lectureWatched: value, notesDone: value });
    },
    [setFlags, lectureId],
  );

  const effSec = ref.lecture.durationSec / (speed > 0 ? speed : 1);
  const done = Boolean(progress?.lectureWatched);

  const speedBadge =
    speed !== 1 ? (
      <span className="tiny faint">{formatDuration(effSec)} at {speed}×</span>
    ) : null;
  const dueBadge =
    showScheduledDate && scheduledDate ? (
      <span className="tiny faint">due {scheduledDate.slice(5)}</span>
    ) : null;

  return (
    <label className={`lecture lec-row${done ? ' done' : ''}`}>
      <span className="lec-row-main">
        <span className="lec-row-name truncate" title={ref.lecture.name}>
          {ref.lecture.name}
        </span>
        {showContext ? (
          <span className="lec-row-sub">
            {!hideSubject ? (
              <>
                <span>{ref.subject.name}</span>
                <span aria-hidden>·</span>
              </>
            ) : null}
            <span className="truncate">{ref.topic.name}</span>
            <span aria-hidden>·</span>
            <span className="mono">{formatClock(ref.lecture.durationSec)}</span>
            {speedBadge}
            {dueBadge}
          </span>
        ) : (
          <span className="lec-row-sub">
            <span className="mono">{formatClock(ref.lecture.durationSec)}</span>
          </span>
        )}
      </span>
      <input
        type="checkbox"
        className="lec-row-check"
        checked={done}
        onChange={onToggleBoth}
        aria-label={`${done ? 'Unmark' : 'Mark'} watched: ${ref.lecture.name}`}
      />
    </label>
  );
});
