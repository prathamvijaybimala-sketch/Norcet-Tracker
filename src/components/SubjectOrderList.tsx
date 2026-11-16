import { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { subjectStats } from '../lib/parseCurriculum';
import { formatHours } from '../lib/duration';
import { subjectColor } from '../lib/colors';
import { suggestBufferForSubject } from '../lib/buffer';

/**
 * Drag-and-drop study order (section 3.2).
 *
 * HTML5 drag events on desktop plus explicit up/down buttons, which is what
 * actually works on a phone. Excluded subjects are simply removed from
 * `planConfig.subjectOrder` - their progress is untouched, they just never
 * appear in the generated schedule.
 */
export function SubjectOrderList() {
  const curriculum = useAppStore((s) => s.curriculum);
  const planConfig = useAppStore((s) => s.planConfig);
  const moveSubject = useAppStore((s) => s.moveSubject);
  const setSubjectIncluded = useAppStore((s) => s.setSubjectIncluded);
  const setBuffer = useAppStore((s) => s.setBuffer);
  const updatePlan = useAppStore((s) => s.updatePlan);
  const theme = useAppStore((s) => s.theme);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const byId = new Map(curriculum.map((s) => [s.id, s]));
  const included = planConfig.subjectOrder.filter((id) => byId.has(id));
  const excluded = curriculum.filter((s) => !planConfig.subjectOrder.includes(s.id));

  return (
    <div>
      <div className="section-title">Study order ({included.length} included)</div>
      {included.length === 0 ? (
        <div className="empty small">No subjects included yet - add one below.</div>
      ) : null}

      {included.map((id, index) => {
        const subject = byId.get(id)!;
        const stats = subjectStats(subject);
        const color = subjectColor(id, theme);
        const buffer = planConfig.bufferDaysBySubject[id] ?? 0;
        const suggested = suggestBufferForSubject(stats.totalSec, planConfig.playbackSpeed);
        return (
          <div
            key={id}
            className={`subject-row ${dragIndex === index ? 'dragging' : ''} ${
              overIndex === index && dragIndex !== index ? 'drag-over' : ''
            }`}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragEnd={() => {
              setDragIndex(null);
              setOverIndex(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setOverIndex(index);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null && dragIndex !== index) moveSubject(dragIndex, index);
              setDragIndex(null);
              setOverIndex(null);
            }}
          >
            <span className="drag-handle" title="Drag to reorder" aria-hidden>
              ⠿
            </span>
            <span className="dot" style={{ background: color.base, marginTop: 0 }} />
            <div className="subject-main">
              <div className="subject-name truncate">{subject.name}</div>
              <div className="tiny faint">
                {formatHours(stats.totalSec)} raw hrs · {stats.lectureCount} lectures ·{' '}
                {formatHours(stats.totalSec / (planConfig.playbackSpeed || 1))} eff. hrs
                {subject.instructor ? ` · ${subject.instructor}` : ''}
              </div>
              <div className="row" style={{ marginTop: 6, gap: 6 }}>
                <span className="tiny faint">Buffer</span>
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={buffer}
                  onChange={(e) => setBuffer(id, Number(e.target.value))}
                  style={{ width: 72, minHeight: 30, padding: '4px 8px' }}
                  aria-label={`Buffer days after ${subject.name}`}
                />
                <span className="tiny faint">days</span>
                {buffer !== suggested ? (
                  <button
                    className="btn sm ghost"
                    onClick={() => setBuffer(id, suggested)}
                    title="Auto-suggested buffer for this subject's effective length"
                  >
                    use {suggested}
                  </button>
                ) : (
                  <span className="tiny faint">(suggested)</span>
                )}
              </div>
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <button
                className="btn sm ghost"
                onClick={() => moveSubject(index, index - 1)}
                disabled={index === 0}
                aria-label={`Move ${subject.name} up`}
              >
                ↑
              </button>
              <button
                className="btn sm ghost"
                onClick={() => moveSubject(index, index + 1)}
                disabled={index === included.length - 1}
                aria-label={`Move ${subject.name} down`}
              >
                ↓
              </button>
              <button
                className="btn sm ghost"
                onClick={() => setSubjectIncluded(id, false)}
                aria-label={`Exclude ${subject.name}`}
                title="Exclude from plan (progress is kept)"
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}

      {excluded.length ? (
        <>
          <div className="section-title">Excluded ({excluded.length})</div>
          {excluded.map((subject) => {
            const stats = subjectStats(subject);
            return (
              <div className="subject-row" key={subject.id} style={{ opacity: 0.75 }}>
                <div className="subject-main">
                  <div className="subject-name truncate">{subject.name}</div>
                  <div className="tiny faint">
                    {formatHours(stats.totalSec)} hrs · {stats.lectureCount} lectures · not in the
                    plan
                  </div>
                </div>
                <button className="btn sm" onClick={() => setSubjectIncluded(subject.id, true)}>
                  Include
                </button>
              </div>
            );
          })}
        </>
      ) : null}

      <div className="card tight" style={{ marginTop: 12 }}>
        <label className="check">
          <input
            type="checkbox"
            checked={planConfig.bufferCountsOffDays}
            onChange={(e) => updatePlan({ bufferCountsOffDays: e.target.checked })}
          />
          <span className="check-label">
            Buffer days count through weekends &amp; leave days
          </span>
        </label>
        <div className="tiny faint" style={{ marginTop: 6 }}>
          On (default): a buffer of 3 means three calendar days of rest, whatever weekdays they
          land on. Off: buffer days only consume days that would otherwise be valid study days, so a
          buffer spanning a weekend stretches over more calendar time.
        </div>
      </div>
    </div>
  );
}
