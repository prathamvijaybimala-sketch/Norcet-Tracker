import { useMemo } from 'react';
import { useAppStore } from '../store/appStore';
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
 */
export function TopicSection({
  lectureIds,
  showContext = true,
  showScheduledDate = false,
}: {
  lectureIds: string[];
  showContext?: boolean;
  showScheduledDate?: boolean;
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
              <LectureRow key={id} lectureId={id} showContext={showContext} showScheduledDate={showScheduledDate} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
