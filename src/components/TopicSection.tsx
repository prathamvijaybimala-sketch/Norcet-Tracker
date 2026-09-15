import { useCallback, useMemo } from 'react';
import { useAppStore } from '../store/appStore';
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
 * The "Questions" checkbox lives ONCE per topic header instead of on every
 * lecture row: MCQ practice is done for the whole topic, so the checkbox
 * ticks every lecture of that topic at once and shows ticked only when all of
 * them are done.
 *
 * With `accordion` (default), at most one lecture row is expanded at a time:
 * the first not-fully-done one opens by itself, tapping a collapsed row
 * expands it for viewing, and finishing the open row advances focus to the
 * next one. `accordion={false}` keeps the classic flat rows ("Done today").
 * Accordion state is local UI state - never part of the Zustand store.
 */
export function TopicSection({
  lectureIds,
  showContext = true,
  showScheduledDate = false,
  accordion = true,
}: {
  lectureIds: string[];
  showContext?: boolean;
  showScheduledDate?: boolean;
  /** False = classic flat rows instead of the accordion (used by "Done today"). */
  accordion?: boolean;
}) {
  const lectureIndex = useAppStore((s) => s.lectureIndex);
  const progress = useAppStore((s) => s.progress);
  const setTopicQuestions = useAppStore((s) => s.setTopicQuestions);

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
        const qDone = g.ids.filter((id) => progress[id]?.questionsDone).length;
        const allQ = g.ids.length > 0 && qDone === g.ids.length;
        return (
          <div className="topic-block" key={`${g.topicId}--${gi}`}>
            <div className="topic-head">
              <span className="topic-name truncate" title={g.topicName}>
                {g.topicName}
              </span>
              <span className="tiny faint mono">
                {qDone}/{g.ids.length}
              </span>
              <label className={`check ${allQ ? 'on' : ''}`} title="Questions for the whole topic">
                <input
                  type="checkbox"
                  checked={allQ}
                  onChange={(e) => setTopicQuestions(g.topicId, e.target.checked)}
                  aria-label={`Questions done for ${g.topicName}`}
                />
                <span className="check-label">Questions</span>
              </label>
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
          </div>
        );
      })}
    </div>
  );
}
