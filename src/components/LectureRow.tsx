import { memo, useCallback } from 'react';
import { useAppStore, type ProgressFlag } from '../store/appStore';
import { formatClock, formatDuration } from '../lib/duration';
import { subjectColor } from '../lib/colors';

const FLAGS: { key: ProgressFlag; label: string }[] = [
  { key: 'lectureWatched', label: 'Lecture' },
  { key: 'notesDone', label: 'Notes' },
];

/**
 * One lecture with its two INDEPENDENT checkboxes: "Lecture" (watched) and
 * "Notes". MCQ practice is tracked per TOPIC, not per lecture - see
 * `TopicSection`, which renders the single "Questions" checkbox per topic.
 *
 * Subscribes only to its own progress record, so ticking a box re-renders this
 * row and the schedule - never the whole list (and never with a page reload or
 * a scroll jump).
 */
export const LectureRow = memo(function LectureRow({
  lectureId,
  showContext = true,
  showScheduledDate = false,
}: {
  lectureId: string;
  showContext?: boolean;
  showScheduledDate?: boolean;
}) {
  const ref = useAppStore((s) => s.lectureIndex.get(lectureId));
  const progress = useAppStore((s) => s.progress[lectureId]);
  const speed = useAppStore((s) => s.planConfig.playbackSpeed);
  const scheduledDate = useAppStore((s) => s.scheduleByLecture.get(lectureId));
  const setFlag = useAppStore((s) => s.setFlag);
  const theme = useAppStore((s) => s.theme);

  const onToggle = useCallback(
    (flag: ProgressFlag) => (e: React.ChangeEvent<HTMLInputElement>) => {
      // No preventDefault, no navigation, no remount: the DOM node stays put so
      // scroll position and focus are preserved.
      setFlag(lectureId, flag, e.target.checked);
    },
    [setFlag, lectureId],
  );

  if (!ref) return null;

  const effSec = ref.lecture.durationSec / (speed > 0 ? speed : 1);
  const color = subjectColor(ref.subject.id, theme);
  const done = Boolean(progress?.lectureWatched);

  return (
    <div className="lecture">
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
            {speed !== 1 ? (
              <span className="badge accent">{formatDuration(effSec)} at {speed}×</span>
            ) : null}
            {showScheduledDate && scheduledDate ? (
              <span className="badge">due {scheduledDate.slice(5)}</span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="lecture-flags">
        {FLAGS.map(({ key, label }) => (
          <label className={`check ${progress?.[key] ? 'on' : ''}`} key={key}>
            <input type="checkbox" checked={Boolean(progress?.[key])} onChange={onToggle(key)} />
            <span className="check-label">{label}</span>
          </label>
        ))}
      </div>
    </div>
  );
});
