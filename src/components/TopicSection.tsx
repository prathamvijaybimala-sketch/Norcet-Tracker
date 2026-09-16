import { useAppStore } from '../store/appStore';
import { LectureRow } from './LectureRow';

/**
 * Renders a list of lectures grouped under their topic names.
 *
 * One flat row per lecture: name on the left, a square checkbox on the
 * right, one checkbox per lecture. Tapping the row (or the box) ticks it.
 *
 * Questions (MCQs) are NOT tracked here anymore - the Revision tab has its
 * own per-topic Questions section. This component is pure lecture tracking.
 */
export function TopicSection({
  lectureIds,
  showContext = true,
  showScheduledDate = false,
  hideSubject = false,
}: {
  lectureIds: string[];
  /** Show the per-row context line (subject · topic · duration). */
  showContext?: boolean;
  /** Show a "due <date>" badge on each row (day-detail views). */
  showScheduledDate?: boolean;
  /** Hide the per-row subject when the whole list belongs to one subject. */
  hideSubject?: boolean;
}) {
  const lectureIndex = useAppStore((s) => s.lectureIndex);

  const groups: { topicId: string; topicName: string; ids: string[] }[] = [];
  const groupByTopic = new Map<string, { topicId: string; topicName: string; ids: string[] }>();
  for (const id of lectureIds) {
    const ref = lectureIndex.get(id);
    if (!ref) continue;
    let group = groupByTopic.get(ref.topic.id);
    if (!group) {
      group = { topicId: ref.topic.id, topicName: ref.topic.name, ids: [] };
      groupByTopic.set(ref.topic.id, group);
      groups.push(group);
    }
    group.ids.push(id);
  }

  if (groups.length === 0) return null;

  return (
    <div>
      {groups.map((g) => (
        <div className="topic-block" key={g.topicId}>
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
            />
          ))}
        </div>
      ))}
    </div>
  );
}
