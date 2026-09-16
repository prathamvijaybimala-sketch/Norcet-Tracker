import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useAppStore } from '../store/appStore';
import { TopicSection } from '../components/TopicSection';
import { Modal, ProgressBar, EmptyState } from '../components/ui';
import { completedOnDate, computeTodayStats, dayCompletion, missedLectures } from '../lib/stats';
import { dayOfYear, formatDate, todayISO } from '../lib/dates';
import { formatDuration } from '../lib/duration';
import { STUDY_QUOTES } from '../lib/quotes';
import { dueRevisions } from '../lib/revision';
import { nextOffDayOnOrAfter } from '../lib/schedule';

/**
 * Homepage. Deliberately quiet - one idea per block:
 *
 *   1. greeting (collapsed to a single line by default; tap reveals the quote)
 *   2. "Today: Xh" hours control (collapsed; soft per-day adjustment + Skip Day)
 *   3. "Today we're studying: <Subject>" (a plain sentence, not a stat header)
 *   4. topic -> lecture rows (accordion, one box per lecture) -> Questions
 *
 * One accent colour marks what needs action; everything else is neutral
 * surface with whitespace-based hierarchy. No numeric "0/5" counters -
 * the single progress bar and the checkbox states carry the information.
 */

const GREETINGS = ['Hiiii', 'Hey', 'Hello', 'Namaste', 'Hi'];
const GREETING_EMOJIS = ['👋', '😊', '🙃', '😄', '☺️', '🙂'];

/**
 * The daily greeting.
 *
 * COLLAPSED by default: just the greeting line (word + name + emoji) - the
 * date is deliberately NOT shown here, the app header already has it. Tapping
 * the line reveals the day's quote (one per day, seeded off the day-of-year
 * so it stays the same all day long) in the larger serif type; tapping again
 * collapses it. Tap-toggle only - no scroll-based behaviour.
 * Collapse state is local UI state only - never persisted.
 */
function GreetingBox({ paceBadge }: { paceBadge: ReactNode }) {
  const planConfig = useAppStore((s) => s.planConfig);
  const updatePlan = useAppStore((s) => s.updatePlan);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(false);

  const now = new Date();
  const day = dayOfYear(now);
  const greeting = GREETINGS[day % GREETINGS.length];
  const emoji = GREETING_EMOJIS[Math.floor(day / 2) % GREETING_EMOJIS.length];
  const name = planConfig.studentName.trim();
  const quote = STUDY_QUOTES[day % STUDY_QUOTES.length];

  const onCardClick = (e: React.MouseEvent) => {
    // Taps on the pencil (or any control) do not toggle the card.
    if (e.target instanceof Element && e.target.closest('button, a, input')) return;
    setExpanded((v) => !v);
  };

  return (
    <div className={`greeting ${expanded ? 'expanded' : ''}`} onClick={onCardClick}>
      <div className="greeting-top">
        <div className="greeting-line">
          {greeting}
          {name ? (
            <>
              {' '}
              {name}
              <button
                className="greeting-edit"
                aria-label="Edit your name"
                onClick={() => {
                  setDraft(name);
                  setEditing(true);
                }}
              >
                ✏️
              </button>
            </>
          ) : (
            <button
              className="greeting-edit"
              aria-label="Set your name"
              onClick={() => {
                setDraft('');
                setEditing(true);
              }}
            >
              ✏️
            </button>
          )}
          <span aria-hidden> {emoji}</span>
        </div>
        {paceBadge}
      </div>
      <div className="greeting-collapse">
        <div className="greeting-collapse-inner">
          <div className="greeting-quote">
            “{quote.text}”
            {quote.author && quote.author !== 'Unknown' ? ` — ${quote.author}` : ''}
          </div>
        </div>
      </div>

      {editing ? (
        <Modal
          title="Your name"
          onClose={() => setEditing(false)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  updatePlan({ studentName: draft.trim() });
                  setEditing(false);
                }}
              >
                Save
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="student-name">Shown in the daily greeting</label>
            <input
              id="student-name"
              type="text"
              value={draft}
              maxLength={30}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. Priya"
              autoFocus
            />
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

const fmtHours = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)}h`;

/**
 * "Today: Xh" - the per-day hours control.
 *
 * Two completely separate mechanisms, deliberately not merged:
 *  - the STOP SLIDER is a SOFT adjustment (planConfig.dayHours[date]): it
 *    rebalances only this week, which is re-packed around the new hours -
 *    a shortfall rides onto the week's off day (the same overflow day the
 *    Backlog feature uses; dropped to the Backlog tab when the plan has no
 *    off day), a surplus leaves the week's later days lighter. `dailyHours`
 *    itself never changes, and next week is never touched.
 *  - "Skip Day" is NOT soft: it adds today to planConfig.leaveDates through
 *    the exact same path as any other leave day, so the whole remaining plan
 *    shifts, as it would for any leave.
 *
 * The slider is centred on the plan's dailyHours, ±2h in 1-hour steps,
 * floored above 1h (reaching 0 is exclusively Skip Day's job).
 */
function TodayHoursControl() {
  const planConfig = useAppStore((s) => s.planConfig);
  const scheduleByDate = useAppStore((s) => s.scheduleByDate);
  const setDayHours = useAppStore((s) => s.setDayHours);
  const addLeaveDates = useAppStore((s) => s.addLeaveDates);
  const notify = useAppStore((s) => s.notify);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<number | null>(null);

  const today = todayISO();
  const day = scheduleByDate.get(today);
  // The control only makes sense on a real study day with lectures.
  if (!day || day.type !== 'study' || day.lectureIds.length === 0) return null;

  const plan = planConfig.dailyHours;
  const override = planConfig.dayHours[today];
  const current = override ?? plan;
  const draftValue = draft ?? current;

  // 1-hour stops around the plan hours, floored above 1h.
  const stops = [plan - 2, plan - 1, plan, plan + 1, plan + 2].filter((h) => h >= 1);

  const save = () => {
    if (draftValue !== plan) {
      setDayHours(today, draftValue);
      if (draftValue < plan) {
        notify(
          nextOffDayOnOrAfter(today, planConfig)
            ? `Today is ${fmtHours(draftValue)}. The week reflows and the extra lectures ride onto your off day.`
            : `Today is ${fmtHours(draftValue)}. The extra lectures drop off the plan - you'll find them in Backlog.`,
        );
      } else {
        notify(`Today is ${fmtHours(draftValue)}. The rest of the week gets lighter by the same amount.`);
      }
    } else {
      setDayHours(today, null); // back to plan = clear the override
    }
    setOpen(false);
    setDraft(null);
  };

  const skipDay = () => {
    // Same path as any other leave day - no special-casing.
    addLeaveDates([today]);
    notify('Today is off - added as a leave day. The rest of the plan carries over.');
    setOpen(false);
  };

  return (
    <div className={`hours ${open ? 'open' : ''}`}>
      <button type="button" className="hours-row" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>
          Today: <b>{fmtHours(current)}</b>
        </span>
        {override !== undefined ? (
          <span className="tiny faint">· plan {fmtHours(plan)}</span>
        ) : null}
        <span className="hours-chev" aria-hidden>
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open ? (
        <div className="hours-panel">
          <div className="hours-stops" role="group" aria-label="Study hours for today">
            {stops.map((h) => (
              <button
                key={h}
                type="button"
                className={`hours-stop ${draftValue === h ? 'on' : ''} ${h === plan ? 'plan' : ''}`}
                onClick={() => setDraft(h)}
                aria-pressed={draftValue === h}
              >
                {fmtHours(h)}
                {h === plan ? <span className="hours-plan-mark">plan</span> : null}
              </button>
            ))}
          </div>
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <button className="btn sm primary" onClick={save}>
              {draftValue === current ? 'Done' : 'Save'}
            </button>
            <button
              className="btn sm ghost"
              onClick={() => {
                setOpen(false);
                setDraft(null);
              }}
            >
              Cancel
            </button>
            <span className="spacer" />
            <button className="btn sm" onClick={skipDay}>
              Skip Day
            </button>
          </div>
          <div className="tiny faint" style={{ marginTop: 8 }}>
            The slider only rebalances this week - the week reflows around the new
            hours (shortfall → your off day, later days get lighter). Skip Day is a
            real leave day - the whole plan shifts.
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function TodayScreen() {
  const curriculum = useAppStore((s) => s.curriculum);
  const planConfig = useAppStore((s) => s.planConfig);
  const progress = useAppStore((s) => s.progress);
  const revision = useAppStore((s) => s.revision);
  const schedule = useAppStore((s) => s.schedule);
  const scheduleByDate = useAppStore((s) => s.scheduleByDate);
  const lectureIndex = useAppStore((s) => s.lectureIndex);
  const catchUp = useAppStore((s) => s.catchUp);
  const setRoute = useAppStore((s) => s.setRoute);
  /** "Done today" starts as a one-line summary; tapping it expands the list. */
  const [doneOpen, setDoneOpen] = useState(false);

  const today = todayISO();

  const stats = useMemo(
    () => computeTodayStats(curriculum, planConfig, progress, schedule, today),
    [curriculum, planConfig, progress, schedule, today],
  );
  const day = scheduleByDate.get(today);
  const completion = useMemo(
    () => dayCompletion(day, progress, lectureIndex),
    [day, progress, lectureIndex],
  );

  // What the plan ORIGINALLY assigned to today (PlanConfig.dayBasis). The
  // live list is a compacting queue - the moment a lecture is watched, the
  // next unwatched one replaces it - so "all of today is done" can never be
  // measured on the live list; the baseline is the measure. Refilled lectures
  // are "tomorrow's list, already generated". Falls back to the live list on
  // the single frame before a basis exists.
  const speed = planConfig.playbackSpeed > 0 ? planConfig.playbackSpeed : 1;
  const basisIds = planConfig.dayBasis?.[today] ?? day?.lectureIds ?? [];
  const basisWatched = basisIds.filter((id) => progress[id]?.lectureWatched);
  const basisSec = basisIds.reduce(
    (n, id) => n + (lectureIndex.get(id)?.lecture.durationSec ?? 0) / speed,
    0,
  );
  const basisDoneSec = basisWatched.reduce(
    (n, id) => n + (lectureIndex.get(id)?.lecture.durationSec ?? 0) / speed,
    0,
  );
  const dayDone = basisIds.length > 0 && basisWatched.length === basisIds.length;

  // The pop should fire once, at the moment the day becomes done in THIS
  // visit. A reopen starts already done -> the box renders statically.
  const wasDoneAtMount = useRef(dayDone);
  const revisionDue = useMemo(() => dueRevisions(revision, today).length, [revision, today]);

  // Lectures ticked today: they drop out of the schedule, so list them here
  // instead of letting them disappear.
  const doneToday = useMemo(() => completedOnDate(progress, today), [progress, today]);

  // ONE "missed" definition for the banner and the Backlog tab/badge: past
  // scheduled days plus lectures that dropped off the plan entirely.
  const missed = useMemo(
    () => missedLectures(schedule, lectureIndex, planConfig.subjectOrder, progress, today),
    [schedule, lectureIndex, planConfig.subjectOrder, progress, today],
  );
  const missedSec = useMemo(
    () =>
      missed.reduce(
        (n, { id }) => n + (lectureIndex.get(id)?.lecture.durationSec ?? 0) /
          (planConfig.playbackSpeed > 0 ? planConfig.playbackSpeed : 1),
        0,
      ),
    [missed, lectureIndex, planConfig.playbackSpeed],
  );

  const doneTodaySec = useMemo(
    () =>
      doneToday.reduce((n, id) => n + (lectureIndex.get(id)?.lecture.durationSec ?? 0), 0) /
      (planConfig.playbackSpeed > 0 ? planConfig.playbackSpeed : 1),
    [doneToday, lectureIndex, planConfig.playbackSpeed],
  );

  const paceLabel =
    stats.deltaDays <= -0.5
      ? `${Math.abs(stats.deltaDays).toFixed(stats.deltaDays > -2 ? 1 : 0)} days behind`
      : stats.deltaDays >= 0.5
        ? `${stats.deltaDays.toFixed(stats.deltaDays < 2 ? 1 : 0)} days ahead`
        : 'On track';

  return (
    <div className="screen">
      <GreetingBox
        paceBadge={
          <span className={`badge ${stats.deltaDays <= -0.5 ? 'warn' : stats.deltaDays >= 0.5 ? 'ok' : ''}`}>
            {paceLabel}
          </span>
        }
      />

      <TodayHoursControl />

      <div className="card study-card">
        {day?.type === 'study' && day.lectureIds.length ? (
          <>
            <div className="study-sentence">
              Today we&rsquo;re studying: <b>{day.subjectName}</b>
            </div>
            <div style={{ marginBottom: 12 }}>
              <ProgressBar
                value={basisDoneSec}
                max={basisSec || completion.plannedSec}
                tone={dayDone ? 'ok' : 'accent'}
              />
            </div>
            <TopicSection lectureIds={day.lectureIds} showContext={false} contextDate={today} />
            {dayDone ? (
              <div
                className={`ok-box warm-copy${wasDoneAtMount.current ? '' : ' pop'}`}
                style={{ marginTop: 14 }}
              >
                Everything planned for today is watched. Nice. Tomorrow's list is already
                generated from what is left.
              </div>
            ) : null}
          </>
        ) : day?.type === 'buffer' ? (
          <EmptyState icon="🌿" title="Rest day (buffer)" warm>
            {day.subjectName ? `${day.subjectName} is done — ` : ''}
            today is the catch-up and rest time built into the plan before the next subject
            starts. Not an off day by mistake - it was scheduled here on purpose.
          </EmptyState>
        ) : day?.isLeaveDay ? (
          <EmptyState icon="🏖️" title="Leave day" warm>
            Marked as time off. The plan resumes on the next available study day.
          </EmptyState>
        ) : day?.type === 'off' ? (
          <EmptyState icon="☕" title="Not a study day" warm>
            {formatDate(today)} is not one of your study days.
          </EmptyState>
        ) : (
          <EmptyState icon="✅" title="Nothing scheduled for today">
            {schedule.length === 0
              ? 'Import a curriculum and include at least one subject to get a plan.'
              : 'Everything in the current plan is already watched, or the plan has finished.'}
          </EmptyState>
        )}
      </div>

      {doneToday.length ? (
        <div className="card">
          <button
            type="button"
            className="done-summary"
            onClick={() => setDoneOpen((v) => !v)}
            aria-expanded={doneOpen}
          >
            <span>
              {formatDuration(doneTodaySec)} watched today <span aria-hidden>✓</span>
            </span>
            <span className="hours-chev" aria-hidden>
              {doneOpen ? '▴' : '▾'}
            </span>
          </button>
          <div className={`done-list ${doneOpen ? 'open' : ''}`}>
            <div className="done-list-inner">
              <TopicSection lectureIds={doneToday} showContext={false} accordion={false} contextDate={today} />
            </div>
          </div>
        </div>
      ) : null}

      {missed.length > 0 ? (
        <div className="card tight quiet">
          <div className="row between wrap" style={{ gap: 10 }}>
            <div className="small">
              <b>{missed.length}</b> lecture(s) from earlier days are still unwatched (
              {formatDuration(missedSec)}).
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn sm" onClick={catchUp}>
                Catch me up
              </button>
              <button className="btn sm ghost" onClick={() => setRoute('backlog')}>
                Backlog →
              </button>
            </div>
          </div>
          <div className="tiny faint" style={{ marginTop: 6 }}>
            In the Backlog tab you can send a missed lecture to your off day, or shift the whole
            week.
          </div>
        </div>
      ) : null}

      {revisionDue > 0 ? (
        <button
          className="card tight row between quiet"
          onClick={() => setRoute('revision')}
          style={{ width: '100%', border: '1px solid var(--border)', textAlign: 'left' }}
        >
          <span className="small">
            <b>{revisionDue}</b> lecture(s) due for revision
          </span>
          <span className="badge accent">Revise →</span>
        </button>
      ) : null}
    </div>
  );
}
