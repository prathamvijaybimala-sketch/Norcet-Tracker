import { useMemo, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { subjectProgress } from '../lib/stats';
import { Modal, ProgressBar } from '../components/ui';

/**
 * Mark done (bottom tab): the place to record work completed BEFORE using
 * the app.
 *
 * Only the subjects the plan includes are listed, each with a progress bar
 * showing how much of it is done. Tapping a subject opens its topics;
 * ticking a topic marks it as already done and the schedule recalculates
 * without those lectures. Unticking puts them straight back.
 *
 * Watching lectures day by day happens on the Today screen - those keep
 * their fixed schedule days and are not part of this recalculation.
 */
export function MarkDoneScreen() {
  const curriculum = useAppStore((s) => s.curriculum);
  const planConfig = useAppStore((s) => s.planConfig);
  const progress = useAppStore((s) => s.progress);
  const markPreDone = useAppStore((s) => s.markPreDone);

  const [openSubject, setOpenSubject] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    name: string;
    value: boolean;
    count: number;
    ids: string[];
  } | null>(null);

  // Only the subjects the plan includes, in the plan's order.
  const subjects = useMemo(() => {
    const byId = new Map(curriculum.map((s) => [s.id, s]));
    return planConfig.subjectOrder
      .map((id) => byId.get(id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s));
  }, [curriculum, planConfig.subjectOrder]);

  if (subjects.length === 0) {
    return (
      <div className="screen">
        <div className="card">
          <div className="empty small">No subjects in the current plan.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="card">
        <div className="card-title">Mark done</div>
        <div className="tiny faint" style={{ margin: '4px 0 12px' }}>
          For chapters you finished <b>before</b> using the app. Each mark
          recalculates the plan without those lectures; unticking puts them
          back.
        </div>

        {subjects.map((subject) => {
          const stats = subjectProgress(subject, progress, planConfig.playbackSpeed);
          const open = openSubject === subject.id;
          const allIds = subject.topics.flatMap((t) => t.lectures.map((l) => l.id));
          const preDoneIds = allIds.filter((id) => progress[id]?.preDone === true);
          const restIds = allIds.filter((id) => progress[id]?.preDone !== true);
          const allDone = preDoneIds.length === allIds.length && allIds.length > 0;

          return (
            <div className="md-subject" key={subject.id}>
              <button
                type="button"
                className="md-subject-head"
                onClick={() => setOpenSubject(open ? null : subject.id)}
                aria-expanded={open}
              >
                <span className="md-chev" aria-hidden>
                  {open ? '▾' : '▸'}
                </span>
                <span className="md-subject-name truncate">{subject.name}</span>
                <span className="tiny mono faint">
                  {stats.watched}/{stats.totalLectures}
                </span>
              </button>
              <ProgressBar
                value={stats.watched}
                max={Math.max(1, stats.totalLectures)}
                tone={stats.watched === stats.totalLectures && stats.totalLectures > 0 ? 'ok' : 'accent'}
              />

              {open ? (
                <div className="md-topics">
                  {subject.topics.map((topic) => {
                    const watched = topic.lectures.filter(
                      (l) => progress[l.id]?.lectureWatched,
                    ).length;
                    const topicDone =
                      topic.lectures.length > 0 &&
                      topic.lectures.every((l) => progress[l.id]?.preDone === true);
                    return (
                      <label className={`md-topic${topicDone ? ' on' : ''}`} key={topic.id}>
                        <input
                          type="checkbox"
                          checked={topicDone}
                          onChange={() =>
                            markPreDone(topic.lectures.map((l) => l.id), !topicDone)
                          }
                          aria-label={
                            topicDone
                              ? `Put topic "${topic.name}" back into the plan`
                              : `Mark topic "${topic.name}" as already done`
                          }
                        />
                        <span className="md-topic-name truncate" title={topic.name}>
                          {topic.name}
                        </span>
                        <span className="tiny faint mono">
                          {watched}/{topic.lectures.length}
                        </span>
                      </label>
                    );
                  })}

                  <div className="row" style={{ gap: 8, padding: '10px 0 2px' }}>
                    {restIds.length > 0 ? (
                      <button
                        className="btn sm"
                        onClick={() =>
                          setConfirm({
                            name: subject.name,
                            value: true,
                            count: restIds.length,
                            ids: restIds,
                          })
                        }
                      >
                        Mark whole subject done
                      </button>
                    ) : null}
                    {preDoneIds.length > 0 ? (
                      <button
                        className="btn sm ghost"
                        onClick={() =>
                          setConfirm({
                            name: subject.name,
                            value: false,
                            count: preDoneIds.length,
                            ids: preDoneIds,
                          })
                        }
                      >
                        Put {preDoneIds.length} back
                      </button>
                    ) : null}
                    {allDone && allIds.length > 0 ? (
                      <span className="badge ok">fully done</span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {confirm ? (
        <Modal
          title={confirm.value ? `Mark ${confirm.name} done?` : `Put ${confirm.name} back?`}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  markPreDone(confirm.ids, confirm.value);
                  setConfirm(null);
                }}
              >
                {confirm.value
                  ? `Mark ${confirm.count} done`
                  : `Put ${confirm.count} back`}
              </button>
            </>
          }
        >
          <p className="small">
            {confirm.value
              ? `${confirm.count} lecture${confirm.count === 1 ? '' : 's'} will be marked as already done (completed before using the app). The plan recalculates without them, so the finish date can move earlier.`
              : `${confirm.count} lecture${confirm.count === 1 ? '' : 's'} go back into the plan, and the schedule recalculates to include them again.`}
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
