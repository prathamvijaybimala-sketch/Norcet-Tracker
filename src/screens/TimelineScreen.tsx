import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { TopicSection } from '../components/TopicSection';
import { Modal, EmptyState, ProgressBar } from '../components/ui';
import { dayCompletion, dayStatus } from '../lib/stats';
import { subjectColor } from '../lib/colors';
import {
  MONTH_NAMES,
  WEEKDAY_SHORT,
  formatDate,
  monthKey,
  parseISODate,
  todayISO,
} from '../lib/dates';
import { formatDuration } from '../lib/duration';
import type { ScheduleDay } from '../types';

export function TimelineScreen() {
  const schedule = useAppStore((s) => s.schedule);
  const scheduleByDate = useAppStore((s) => s.scheduleByDate);
  const progress = useAppStore((s) => s.progress);
  const lectureIndex = useAppStore((s) => s.lectureIndex);
  const theme = useAppStore((s) => s.theme);
  const [selected, setSelected] = useState<string | null>(null);
  const today = todayISO();
  const todayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = todayRef.current;
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'center' });
    }
    // Only on mount - re-scrolling on every tick would fight the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const months = useMemo(() => {
    const out: { key: string; label: string; cells: (ScheduleDay | null)[] }[] = [];
    for (const day of schedule) {
      const key = monthKey(day.date);
      let bucket = out[out.length - 1];
      if (!bucket || bucket.key !== key) {
        const [y, m] = key.split('-').map(Number);
        bucket = { key, label: `${MONTH_NAMES[m - 1]} ${y}`, cells: [] };
        out.push(bucket);
      }
      const dayOfMonth = parseISODate(day.date).getDate();
      while (bucket.cells.length < dayOfMonth - 1) bucket.cells.push(null);
      bucket.cells.push(day);
    }
    // Pad the first month's leading blanks.
    if (out.length) {
      const first = out[0];
      const firstDate = parseISODate(schedule[0].date);
      const leading = firstDate.getDay();
      first.cells = [...Array.from({ length: leading }, () => null), ...first.cells];
    }
    return out;
  }, [schedule]);

  const selectedDay = selected ? scheduleByDate.get(selected) : undefined;
  const completion = useMemo(
    () => dayCompletion(selectedDay, progress, lectureIndex),
    [selectedDay, progress, lectureIndex],
  );

  if (schedule.length === 0) {
    return (
      <div className="screen">
        <div className="card">
          <EmptyState icon="🗓️" title="No plan yet">
            Import a curriculum and include at least one subject with unwatched lectures.
          </EmptyState>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="card tight">
        <div className="row wrap" style={{ gap: 10 }}>
          <Legend color="var(--ok)" label="completed" />
          <Legend color="var(--accent)" label="partly done / today" />
          <Legend color="var(--warn)" label="missed" />
          <Legend color="transparent" label="rest day" buffer />
          <Legend color="transparent" label="leave" leave />
          <Legend color="transparent" label="off day" />
        </div>
        <div className="tiny faint" style={{ marginTop: 8 }}>
          <b>Off days</b> are only the weekdays you excluded (like Sunday) and leave days.{' '}
          <b>Rest days</b> are the buffer you planned after each subject - they count calendar
          days, so they may land on a weekday. That is the buffer working, not a broken off day.
        </div>
      </div>

      {months.map((month) => (
        <div className="card" key={month.key} ref={month.key === monthKey(today) ? todayRef : undefined}>
          <div className="card-title">
            <span>{month.label}</span>
            <span className="spacer" />
            <span className="tiny faint">
              {month.cells.filter((c) => c && c.type === 'study').length} study days
            </span>
          </div>
          <div className="month-head">
            {WEEKDAY_SHORT.map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>
          <div className="month-grid">
            {month.cells.map((day, i) => {
              if (!day) return <div className="day-cell blank" key={i} />;
              const status = dayStatus(day, progress, today);
              const color = day.subjectId ? subjectColor(day.subjectId, theme) : null;
              const isToday = day.date === today;
              const title =
                day.type === 'buffer'
                  ? `${formatDate(day.date)} · rest day (buffer)${
                      day.subjectName ? ` after ${day.subjectName}` : ''
                    }`
                  : day.type === 'off'
                    ? `${formatDate(day.date)} · off day${
                        day.isLeaveDay ? ' (leave)' : ' (not a study day)'
                      }`
                    : `${formatDate(day.date)} · study day${
                        day.subjectName ? ` · ${day.subjectName}` : ''
                      }`;
              return (
                <button
                  key={day.date}
                  className={`day-cell ${status} ${isToday ? 'today' : ''} ${
                    day.type === 'study' ? 'has-plan' : ''
                  }`}
                  style={
                    day.type === 'study' && color
                      ? { background: color.soft, color: color.text }
                      : undefined
                  }
                  onClick={() => day.type === 'study' && setSelected(day.date)}
                  title={title}
                >
                  <span>{parseISODate(day.date).getDate()}</span>
                  {day.type === 'study' ? (
                    <span className="cell-count">{day.lectureIds.length}</span>
                  ) : day.type === 'buffer' ? (
                    <span className="cell-count">rest</span>
                  ) : day.isLeaveDay ? (
                    <span className="cell-count">off</span>
                  ) : null}
                  <span className="cell-strip" />
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {selectedDay ? (
        <Modal
          title={`${formatDate(selectedDay.date)}${selectedDay.subjectName ? ` · ${selectedDay.subjectName}` : ''}`}
          onClose={() => setSelected(null)}
          footer={
            <button className="btn ghost" onClick={() => setSelected(null)}>
              Close
            </button>
          }
        >
          <div className="row between tiny faint" style={{ marginBottom: 6 }}>
            <span>
              {selectedDay.type === 'study'
                ? `${selectedDay.lectureIds.length} lectures · ${formatDuration(selectedDay.plannedSec)} planned`
                : selectedDay.type === 'buffer'
                  ? 'Rest day (buffer) - no new lectures'
                  : 'Off day'}
            </span>
            <span>
              watched {completion.watched}/{completion.total}
            </span>
          </div>
          {completion.total ? (
            <div style={{ marginBottom: 10 }}>
              <ProgressBar
                value={completion.watched}
                max={completion.total}
                tone={completion.allDone ? 'ok' : 'accent'}
              />
            </div>
          ) : null}
          <div className="tiny faint" style={{ marginBottom: 8 }}>
            Checkboxes work on any day, past or future - logging progress retroactively is normal.
          </div>
          <TopicSection lectureIds={selectedDay.lectureIds} />
        </Modal>
      ) : null}
    </div>
  );
}

function Legend({
  color,
  label,
  buffer,
  leave,
}: {
  color: string;
  label: string;
  buffer?: boolean;
  leave?: boolean;
}) {
  return (
    <span className="row tiny faint" style={{ gap: 5 }}>
      <span
        style={{
          width: 13,
          height: 13,
          borderRadius: 4,
          background: color,
          border: buffer
            ? '1px solid rgba(245,181,68,0.5)'
            : leave
              ? '1px solid rgba(255,107,107,0.5)'
              : '1px solid var(--border-strong)',
        }}
      />
      {label}
    </span>
  );
}
