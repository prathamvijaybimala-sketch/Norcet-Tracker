import { Fragment, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { subjectProgress } from '../lib/stats';
import { orderedTopics } from '../lib/schedule';
import { formatDuration } from '../lib/duration';
import { Modal, ProgressBar } from '../components/ui';
import type { Topic } from '../types';

/**
 * Mark done (bottom tab): the place to record work completed BEFORE using
 * the app.
 *
 * Only the subjects the plan includes are listed, each with a progress bar
 * showing how much of it is done. Tapping a subject opens its topics;
 * ticking a topic marks it as already done and the schedule recalculates
 * without those lectures.
 *
 * A topic (chapter) row has three ways to interact:
 *  - the checkbox marks the WHOLE chapter as already done,
 *  - tapping the row opens the chapter's individual lectures, each with its
 *    own checkbox (mark one lecture, keep the rest in the plan),
 *  - holding the ≡ handle and dragging reorders the chapters of that
 *    subject, and the plan re-packs in the new order.
 *
 * Unticking anything puts the lectures straight back. Watching lectures day
 * by day happens on the Today screen - those keep their fixed schedule days
 * and are not part of this recalculation.
 */

/** How long a press must hold (without drifting) before it becomes a drag. */
const HOLD_MS = 350;
/** Pointer drift that cancels a pending hold - the user is scrolling, not dragging. */
const MOVE_TOLERANCE = 10;

type Drag = { subjectId: string; topicId: string; order: string[] };

export function MarkDoneScreen() {
  const curriculum = useAppStore((s) => s.curriculum);
  const planConfig = useAppStore((s) => s.planConfig);
  const progress = useAppStore((s) => s.progress);
  const markPreDone = useAppStore((s) => s.markPreDone);
  const setTopicOrder = useAppStore((s) => s.setTopicOrder);

  const [openSubject, setOpenSubject] = useState<string | null>(null);
  const [openTopics, setOpenTopics] = useState<ReadonlySet<string>>(new Set());
  const [confirm, setConfirm] = useState<{
    name: string;
    value: boolean;
    count: number;
    ids: string[];
  } | null>(null);
  // Live drag state: the preview order of the subject being reordered.
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const press = useRef<{ y: number; timer: number; active: boolean } | null>(null);
  // The click that follows a drag must not toggle the row's expansion.
  const justDragged = useRef(false);

  const toggleTopic = (id: string) =>
    setOpenTopics((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // --- chapter drag-reorder (pointer events: mouse + touch) ---------------

  const beginPress = (
    e: React.PointerEvent,
    subjectId: string,
    topicId: string,
    order: string[],
  ) => {
    if (press.current || dragRef.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    justDragged.current = false;
    const el = e.currentTarget as HTMLElement;
    const p = { y: e.clientY, timer: 0, active: false };
    press.current = p;
    p.timer = window.setTimeout(() => {
      if (!press.current || press.current.active) return;
      press.current.active = true;
      el.setPointerCapture?.(e.pointerId);
      const next: Drag = { subjectId, topicId, order: [...order] };
      dragRef.current = next;
      setDrag(next);
    }, HOLD_MS);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p) return;
    const d = dragRef.current;
    if (!d) {
      // Still holding, not yet dragging: too much drift = scrolling, stand down.
      if (Math.abs(e.clientY - p.y) > MOVE_TOLERANCE) {
        window.clearTimeout(p.timer);
        press.current = null;
      }
      return;
    }
    // Which slot is the pointer over? (midpoint rule, rows of this subject)
    const container = (e.currentTarget as HTMLElement).closest('.md-topics');
    const rows = Array.from(
      container?.querySelectorAll<HTMLElement>('.md-topic[data-topic]') ?? [],
    );
    let target = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (e.clientY > r.top + r.height / 2) target = i + 1;
    }
    const cur = d.order.indexOf(d.topicId);
    if (cur === -1) return;
    const insertAt = target > cur ? target - 1 : target;
    if (insertAt === cur) return; // still over its own slot
    const order = d.order.filter((id) => id !== d.topicId);
    order.splice(insertAt, 0, d.topicId);
    const next: Drag = { ...d, order };
    dragRef.current = next;
    setDrag(next);
  };

  const endPress = (cancelled: boolean) => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    setDrag(null);
    justDragged.current = true;
    if (!cancelled) setTopicOrder(d.subjectId, d.order); // re-packs the plan
  };

  // --- the list ------------------------------------------------------------

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
          back. Tap a chapter to see its lectures; hold ≡ and drag to move a
          chapter to a new spot.
        </div>

        {subjects.map((subject) => {
          const stats = subjectProgress(subject, progress, planConfig.playbackSpeed);
          const open = openSubject === subject.id;
          const allIds = subject.topics.flatMap((t) => t.lectures.map((l) => l.id));
          const preDoneIds = allIds.filter((id) => progress[id]?.preDone === true);
          const restIds = allIds.filter((id) => progress[id]?.preDone !== true);
          const allDone = preDoneIds.length === allIds.length && allIds.length > 0;

          // Chapters in study order: the drag preview while dragging, the
          // stored order when it exists, otherwise the curriculum order.
          const topicById = new Map(subject.topics.map((t) => [t.id, t]));
          const topics: Topic[] =
            drag && drag.subjectId === subject.id
              ? drag.order
                  .map((id) => topicById.get(id))
                  .filter((t): t is Topic => Boolean(t))
              : orderedTopics(subject, planConfig.topicOrder);
          const displayedIds = topics.map((t) => t.id);

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
                  {topics.map((topic) => {
                    const watched = topic.lectures.filter(
                      (l) => progress[l.id]?.lectureWatched,
                    ).length;
                    const topicDone =
                      topic.lectures.length > 0 &&
                      topic.lectures.every((l) => progress[l.id]?.preDone === true);
                    const isOpen = openTopics.has(topic.id);
                    const isDragging =
                      drag?.subjectId === subject.id && drag.topicId === topic.id;
                    return (
                      <Fragment key={topic.id}>
                        <div
                          className={`md-topic${topicDone ? ' on' : ''}${isOpen ? ' open' : ''}${isDragging ? ' dragging' : ''}`}
                          data-topic={topic.id}
                          onClick={() => {
                            if (justDragged.current) return;
                            toggleTopic(topic.id);
                          }}
                          onPointerDown={(e) => {
                            // Let the checkbox and the grip handle their own presses.
                            if ((e.target as HTMLElement).closest('input,button')) return;
                            beginPress(e, subject.id, topic.id, displayedIds);
                          }}
                          onPointerMove={onPointerMove}
                          onPointerUp={() => endPress(false)}
                          onPointerCancel={() => endPress(true)}
                        >
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
                          <span className="md-topic-chev" aria-hidden>
                            {isOpen ? '▾' : '▸'}
                          </span>
                          <button
                            type="button"
                            className="md-grip"
                            aria-label={`Drag to reorder topic "${topic.name}"`}
                            onClick={(e) => e.stopPropagation()}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              beginPress(e, subject.id, topic.id, displayedIds);
                            }}
                            onPointerMove={onPointerMove}
                            onPointerUp={() => endPress(false)}
                            onPointerCancel={() => endPress(true)}
                          >
                            ≡
                          </button>
                        </div>
                        {isOpen ? (
                          <div className="md-lectures">
                            {topic.lectures.map((lec) => {
                              const done = progress[lec.id]?.preDone === true;
                              return (
                                <label className="md-lecture" key={lec.id}>
                                  <input
                                    type="checkbox"
                                    checked={done}
                                    onChange={() => markPreDone([lec.id], !done)}
                                    aria-label={
                                      done
                                        ? `Put lecture "${lec.name}" back into the plan`
                                        : `Mark lecture "${lec.name}" as already done`
                                    }
                                  />
                                  <span className="md-lecture-name truncate" title={lec.name}>
                                    {lec.name}
                                  </span>
                                  <span className="tiny faint mono">
                                    {formatDuration(lec.durationSec)}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        ) : null}
                      </Fragment>
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
