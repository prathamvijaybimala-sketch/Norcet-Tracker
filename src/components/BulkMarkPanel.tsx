import { useMemo, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { subjectProgress } from '../lib/stats';
import { formatDuration } from '../lib/duration';
import { Modal, ProgressBar } from './ui';
import { subjectColor } from '../lib/colors';

const PAGE = 60;

/**
 * Bulk mark-done (section 3.5): per subject, per topic and per lecture.
 *
 * Marking 50 lectures done one at a time is unacceptable, so this panel works at
 * whichever granularity the student thinks in: "I already know most of Obs-Gyn",
 * "this whole topic is done", or tick individual lectures.
 */
export function BulkMarkPanel() {
  const curriculum = useAppStore((s) => s.curriculum);
  const progress = useAppStore((s) => s.progress);
  const planConfig = useAppStore((s) => s.planConfig);
  const bulkMark = useAppStore((s) => s.bulkMark);
  const setFlag = useAppStore((s) => s.setFlag);
  const theme = useAppStore((s) => s.theme);

  const [subjectId, setSubjectId] = useState<string>('');
  const [openTopic, setOpenTopic] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [query, setQuery] = useState('');
  const [firstN, setFirstN] = useState(20);
  const [alsoExtras, setAlsoExtras] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; ids: string[] } | null>(null);

  const activeId = subjectId || planConfig.subjectOrder[0] || curriculum[0]?.id || '';
  const subject = curriculum.find((s) => s.id === activeId);
  const stats = useMemo(
    () => (subject ? subjectProgress(subject, progress, planConfig.playbackSpeed) : null),
    [subject, progress, planConfig.playbackSpeed],
  );

  const apply = (ids: string[]) => {
    bulkMark(ids, { lectureWatched: true, notesDone: alsoExtras, questionsDone: alsoExtras });
    setConfirm(null);
  };

  const ask = (title: string, ids: string[]) => {
    if (!ids.length) return;
    setConfirm({ title, ids });
  };

  if (!subject || !stats) {
    return <div className="empty small">Import a curriculum first.</div>;
  }

  const color = subjectColor(subject.id, theme);
  const needle = query.trim().toLowerCase();

  return (
    <div>
      <div className="card">
        <div className="field">
          <label htmlFor="bulk-subject">Subject</label>
          <select id="bulk-subject" value={activeId} onChange={(e) => {
            setSubjectId(e.target.value);
            setOpenTopic(null);
            setLimit(PAGE);
            setQuery('');
          }}>
            {curriculum.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="row" style={{ marginTop: 10, gap: 8 }}>
          <span className="dot" style={{ background: color.base, marginTop: 0 }} />
          <div style={{ flex: 1 }}>
            <div className="row between">
              <b className="small">
                {stats.watched}/{stats.totalLectures} watched
              </b>
              <span className="tiny faint">
                {formatDuration(stats.effectiveRemainingSec)} left at {planConfig.playbackSpeed}×
              </span>
            </div>
            <div style={{ marginTop: 6 }}>
              <ProgressBar
                value={stats.watched}
                max={stats.totalLectures}
                tone={stats.watched === stats.totalLectures ? 'ok' : 'accent'}
              />
            </div>
            <div className="tiny faint" style={{ marginTop: 5 }}>
              notes {stats.notesDone} · questions {stats.questionsDone} · fully done{' '}
              {stats.fullyDone}
            </div>
          </div>
        </div>

        <div className="row wrap" style={{ marginTop: 12, gap: 8 }}>
          <button
            className="btn"
            onClick={() => ask(`Mark all of ${subject.name} as watched?`, subject.topics.flatMap((t) => t.lectures.map((l) => l.id)))}
          >
            Mark entire subject done
          </button>
          <div className="row" style={{ gap: 6 }}>
            <input
              type="number"
              min={1}
              max={stats.totalLectures}
              value={firstN}
              onChange={(e) => setFirstN(Math.max(1, Number(e.target.value) || 1))}
              style={{ width: 84 }}
              aria-label="Number of lectures"
            />
            <button
              className="btn"
              onClick={() =>
                ask(
                  `Mark the first ${firstN} lectures of ${subject.name} as watched?`,
                  subject.topics
                    .flatMap((t) => t.lectures.map((l) => l.id))
                    .slice(0, firstN),
                )
              }
            >
              Mark first N done
            </button>
          </div>
        </div>

        <label className="check" style={{ marginTop: 10 }}>
          <input
            type="checkbox"
            checked={alsoExtras}
            onChange={(e) => setAlsoExtras(e.target.checked)}
          />
          <span className="check-label">Also mark notes &amp; questions done</span>
        </label>
        <div className="tiny faint" style={{ marginTop: 4 }}>
          Default off: the three checkboxes are independent, so bulk-marking should not quietly
          claim work you have not done.
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <span>Topics &amp; lectures</span>
          <span className="spacer" />
          <input
            type="text"
            value={query}
            placeholder="Search lectures…"
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
            style={{ maxWidth: 190, minHeight: 30, padding: '4px 9px' }}
            aria-label="Search lectures"
          />
        </div>

        {subject.topics.map((topic) => {
          const watched = topic.lectures.filter((l) => progress[l.id]?.lectureWatched).length;
          const matches = needle
            ? topic.lectures.filter((l) => l.name.toLowerCase().includes(needle))
            : topic.lectures;
          const isOpen = openTopic === topic.id || (needle !== '' && matches.length > 0);
          return (
            <div className="tree-topic" key={topic.id}>
              <button
                onClick={() => setOpenTopic(isOpen && openTopic === topic.id ? null : topic.id)}
                aria-expanded={isOpen}
              >
                <span style={{ color: 'var(--text-faint)' }}>{isOpen ? '▾' : '▸'}</span>
                <span style={{ flex: 1, textAlign: 'left' }} className="truncate">
                  {topic.name}
                </span>
                <span className={`badge ${watched === topic.lectures.length && watched ? 'ok' : ''}`}>
                  {watched}/{topic.lectures.length}
                </span>
              </button>
              {isOpen ? (
                <div className="tree-body">
                  <div className="row between" style={{ padding: '6px 0' }}>
                    <span className="tiny faint">
                      {matches.length === topic.lectures.length
                        ? `${topic.lectures.length} lectures`
                        : `${matches.length} of ${topic.lectures.length} match`}
                    </span>
                    <button
                      className="btn sm"
                      onClick={() =>
                        ask(
                          `Mark "${topic.name}" as watched?`,
                          (needle ? matches : topic.lectures).map((l) => l.id),
                        )
                      }
                    >
                      Mark topic done
                    </button>
                  </div>
                  {matches.slice(0, limit).map((lecture) => {
                    const p = progress[lecture.id];
                    return (
                      <div className="lecture-pick" key={lecture.id}>
                        <label className="check" style={{ flex: 1, minWidth: 0 }}>
                          <input
                            type="checkbox"
                            checked={Boolean(p?.lectureWatched)}
                            onChange={(e) => setFlag(lecture.id, 'lectureWatched', e.target.checked)}
                          />
                          <span className="check-label truncate">{lecture.name}</span>
                        </label>
                        <span className="hours-pill">{formatDuration(lecture.durationSec)}</span>
                      </div>
                    );
                  })}
                  {matches.length > limit ? (
                    <button className="btn sm ghost" onClick={() => setLimit(limit + PAGE)}>
                      Show {Math.min(PAGE, matches.length - limit)} more
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {confirm ? (
        <Modal
          title={confirm.title}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button className="btn primary" onClick={() => apply(confirm.ids)}>
                Mark {confirm.ids.length} done
              </button>
            </>
          }
        >
          <p className="small">
            {confirm.ids.length} lecture{confirm.ids.length === 1 ? '' : 's'} will be marked as
            watched{alsoExtras ? ', with notes and questions done' : ''}, dated today. The schedule
            recomputes immediately, so the timeline will shrink.
          </p>
          <p className="small muted">
            This only touches the <b>watched</b> flag{alsoExtras ? ' plus notes/questions' : ''} -
            nothing else is changed and you can untick anything later.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
