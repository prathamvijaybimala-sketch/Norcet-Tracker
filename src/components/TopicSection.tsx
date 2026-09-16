import { useCallback, useMemo } from 'react';
import { useAppStore } from '../store/appStore';
import { todayISO } from '../lib/dates';
import { topicActiveLectureIds, topicQuestionsUnlocked } from '../lib/topicQuestions';
import { useAccordion } from '../lib/useAccordion';
import { LectureRow } from './LectureRow';

type Group = {
  topicId: string;
  topicName: string;
  ids: string[];
};

/**
 * Renders a list of lectures grouped by topic (subtopic).
 *
 * Layout (quiet, top to bottom):
 *   topic name
 *     lecture rows (accordion - one focused at a time, one box each)
 *     Questions checkbox (ONE per topic, at the end)
 *
 * The "Questions" checkbox ticks the topic's ACTIVE lectures at once (all of
 * them, not just this render's slice) and shows ticked only when every active
 * lecture is done. A topic whose lectures span several days only becomes
 * actionable on the day that holds its LAST scheduled lecture (`contextDate`
 * is the day being rendered) - on earlier partial days there is nothing
 * meaningful to confirm yet, and the tick on the last day covers the whole
 * topic in one go. See lib/topicQuestions.ts.
 *
 * With `accordion` (default), at most one lecture row is expanded at a time:
 * the first not-fully-done one opens by itself, tapping a collapsed row
 * expands it for viewing, and finishing the open row advances focus to the
 * next one. `accordion={false}` keeps the flat rows ("Done today").
 * Accordion state is local UI state - never part of the Zustand store.
 */
export function TopicSection({
  lectureIds,
  showContext = true,
  showScheduledDate = false,
  accordion = true,
  contextDate,
}: {
  lectureIds: string[];
  showContext?: boolean;
  showScheduledDate?: boolean;
  /** False = flat rows instead of the accordion (used by "Done today"). */
  accordion?: boolean;
  /** The day being rendered (defaults to today) - decides whether a topic
   *  that spans several days has reached its last day yet. */
  contextDate?: string;
}) {
  const lectureIndex = useAppStore((s) => s.lectureIndex);
  const progress = useAppStore((s) => s.progress);
  const scheduleByLecture = useAppStore((s) => s.scheduleByLecture);
  const setTopicQuestions = useAppStore((s) => s.setTopicQuestions);
  const day = contextDate ?? todayISO();

  const groups = useMemo(() => {
    const out: Group[] = [];
    for (const id of lectureIds) {
      const ref = lectureIndex.get(id);
      if (!ref) continue;
      const last = out[out.length - 1];
      if (last && last.topicId === ref.topic.id) last.ids.push(id);
      else out.push({ topicId: ref.topic.id, topicName: ref.topic.name, ids: [id] });
    }
    return out;
  }, [lectureIds, lectureIndex]);

  // The per-row subject is redundant when the whole list belongs to one
  // subject (a study day always does) - the topic names carry the detail.
  const hideSubject = useMemo(() => {
    const subjects = new Set<string>();
    for (const id of lectureIds) {
      const ref = lectureIndex.get(id);
      if (ref) subjects.add(ref.subject.id);
    }
    return subjects.size <= 1;
  }, [lectureIds, lectureIndex]);

  const isDone = useCallback(
    (id: string) => {
      const p = progress[id];
      return Boolean(p && p.lectureWatched && p.notesDone);
    },
    [progress],
  );
  const acc = useAccordion(lectureIds, isDone);

  if (groups.length === 0) return null;

  return (
    <div>
      {groups.map((g, gi) => {
        const topic = lectureIndex.get(g.ids[0])!.topic;
        // Judged over the topic's ACTIVE lectures (scheduled or already
        // watched) - never just this render's slice, which for a topic
        // split across days would lie in both directions.
        const activeIds = topicActiveLectureIds(topic, scheduleByLecture, progress);
        const allQ = activeIds.length > 0 && activeIds.every((id) => progress[id]?.questionsDone);
        // Hidden on partial days: the tick appears on the day that holds the
        // topic's last scheduled lecture (or immediately, once the topic has
        // nothing left scheduled).
        const unlocked = topicQuestionsUnlocked(activeIds, scheduleByLecture, day);
        return (
          <div className="topic-block" key={`${g.topicId}--${gi}`}>
            <div className="topic-head">
              <span className="topic-name truncate" title={g.topicName}>
                {g.topicName}
              </span>
            </div>
            {g.ids.map((id) => (
              <LectureRow
                key={id}
                lectureId={id}
                showContext={showContext}
                showScheduledDate={showScheduledDate}
                hideSubject={hideSubject}
                {...(accordion ? { expanded: acc.isExpanded(id), onToggle: () => acc.onToggle(id) } : {})}
              />
            ))}
            {unlocked ? (
              <label className={`check topic-questions ${allQ ? 'on' : ''}`} title="Questions for the whole topic">
                <input
                  type="checkbox"
                  checked={allQ}
                  onChange={(e) => setTopicQuestions(g.topicId, e.target.checked)}
                  aria-label={`Questions done for ${g.topicName}`}
                />
                <span className="check-label">Questions for this topic</span>
              </label>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
