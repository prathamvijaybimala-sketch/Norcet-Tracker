import { useMemo, useState } from 'react';
import { useAppStore } from '../store/appStore';
import {
  MONTH_NAMES,
  WEEKDAY_SHORT,
  addDays,
  dateRange,
  diffDays,
  formatDate,
  isISODate,
  monthKey,
  parseISODate,
  todayISO,
  toISODate,
} from '../lib/dates';

/**
 * Leave manager (section 3.6): tap dates on a calendar, or expand a range
 * ("Oct 10-14") into individual dates internally. Every change recomputes the
 * schedule, so the timeline visibly shifts forward after the leave block.
 */
export function LeaveManager() {
  const leaveDates = useAppStore((s) => s.planConfig.leaveDates);
  const studyDays = useAppStore((s) => s.planConfig.studyDays);
  const toggleLeave = useAppStore((s) => s.toggleLeave);
  const addLeaveDates = useAppStore((s) => s.addLeaveDates);
  const removeLeaveDate = useAppStore((s) => s.removeLeaveDate);
  const updatePlan = useAppStore((s) => s.updatePlan);
  const notify = useAppStore((s) => s.notify);

  const today = todayISO();
  const [month, setMonth] = useState(() => monthKey(today));
  const [rangeStart, setRangeStart] = useState(today);
  const [rangeEnd, setRangeEnd] = useState(addDays(today, 4));

  const leaveSet = useMemo(() => new Set(leaveDates), [leaveDates]);

  const weeks = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const daysInMonth = new Date(y, m, 0).getDate();
    const cells: (string | null)[] = [];
    for (let i = 0; i < first.getDay(); i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(toISODate(new Date(y, m - 1, d)));
    while (cells.length % 7 !== 0) cells.push(null);
    const out: (string | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [month]);

  const monthLabel = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    return `${MONTH_NAMES[m - 1]} ${y}`;
  }, [month]);

  const shiftMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const addRange = () => {
    // A cleared date input delivers "" - without this check the range loop
    // would run to its safety cap and inject thousands of NaN-dates.
    if (!isISODate(rangeStart) || !isISODate(rangeEnd)) {
      notify('Pick a valid From and To date first.');
      return;
    }
    if (diffDays(rangeStart, rangeEnd) < 0) {
      notify('The range end is before the start.');
      return;
    }
    const dates = dateRange(rangeStart, rangeEnd);
    addLeaveDates(dates);
    notify(`Added ${dates.length} leave day${dates.length === 1 ? '' : 's'}.`);
  };

  const upcoming = leaveDates.filter((d) => d >= today).sort();

  return (
    <div>
      <div className="card">
        <div className="card-title">
          <span>{monthLabel}</span>
          <span className="spacer" />
          <button className="btn sm ghost" onClick={() => shiftMonth(-1)} aria-label="Previous month">
            ‹
          </button>
          <button className="btn sm ghost" onClick={() => setMonth(monthKey(today))}>
            Today
          </button>
          <button className="btn sm ghost" onClick={() => shiftMonth(1)} aria-label="Next month">
            ›
          </button>
        </div>

        <div className="month-head">
          {WEEKDAY_SHORT.map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
        <div className="month-grid">
          {weeks.flat().map((date, i) => {
            if (!date) return <div className="day-cell blank" key={i} />;
            const isLeave = leaveSet.has(date);
            const isStudyDay = studyDays.includes(parseISODate(date).getDay());
            return (
              <button
                key={date}
                className={`day-cell ${isLeave ? 'leave' : ''} ${date === today ? 'today' : ''}`}
                onClick={() => toggleLeave(date)}
                aria-pressed={isLeave}
                title={isLeave ? 'Leave day - tap to remove' : isStudyDay ? 'Tap to mark as leave' : 'Not a study day'}
              >
                <span>{parseISODate(date).getDate()}</span>
                {isLeave ? (
                  <span className="cell-count">off</span>
                ) : isStudyDay ? (
                  <span className="cell-count" style={{ opacity: 0.35 }}>
                    ·
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="tiny faint" style={{ marginTop: 8 }}>
          Tap any date to toggle a leave day. Dotted dates are normal study days.
        </div>
      </div>

      <div className="card">
        <div className="card-title">Add a block of leave</div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="leave-start">From</label>
            <input
              id="leave-start"
              type="date"
              value={rangeStart}
              onChange={(e) => setRangeStart(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="leave-end">To</label>
            <input
              id="leave-end"
              type="date"
              value={rangeEnd}
              onChange={(e) => setRangeEnd(e.target.value)}
            />
          </div>
        </div>
        <button className="btn primary" style={{ marginTop: 10 }} onClick={addRange}>
          Add range as leave
        </button>
      </div>

      <div className="card">
        <div className="card-title">
          <span>Leave days ({leaveDates.length})</span>
          <span className="spacer" />
          {leaveDates.length ? (
            <button
              className="btn sm ghost"
              // One update, not N: each removeLeaveDate would re-derive the
              // schedule and schedule its own save.
              onClick={() => updatePlan({ leaveDates: [] })}
            >
              Clear all
            </button>
          ) : null}
        </div>
        {upcoming.length === 0 ? (
          <div className="small muted">No upcoming leave days.</div>
        ) : (
          <div className="row wrap" style={{ gap: 6 }}>
            {upcoming.map((date) => (
              <span className="badge" key={date}>
                {formatDate(date)}
                <button
                  className="btn sm ghost"
                  style={{ padding: '0 4px', minHeight: 20, border: 0, background: 'transparent' }}
                  onClick={() => removeLeaveDate(date)}
                  aria-label={`Remove leave on ${date}`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        {leaveDates.length !== upcoming.length ? (
          <div className="tiny faint" style={{ marginTop: 8 }}>
            {leaveDates.length - upcoming.length} past leave day(s) hidden.
          </div>
        ) : null}
      </div>
    </div>
  );
}
