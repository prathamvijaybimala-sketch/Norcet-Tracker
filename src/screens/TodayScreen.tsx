import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAppStore } from '../store/appStore';
import { TopicSection } from '../components/TopicSection';
import { Modal, ProgressBar, EmptyState } from '../components/ui';
import { completedOnDate, computeTodayStats, dayCompletion, missedLectures } from '../lib/stats';
import { dayOfYear, formatDate, todayISO } from '../lib/dates';
import { formatDuration } from '../lib/duration';
import { STUDY_QUOTES } from '../lib/quotes';
import {
  doneMessageFor,
  greetingFor,
  milestoneMessageFor,
  nameForDay,
  studyLineFor,
} from '../lib/dayFlavor';
import { computeStreak } from '../lib/streak';
import { dueRevisions } from '../lib/revision';
import { nextOffDayOnOrAfter } from '../lib/schedule';

/**
 * Homepage. Deliberately quiet - one idea per block:
 *
 *   1. greeting (name + time-of-day line + daily line + streak + quote, always visible)
 *   2. "Today: Xh" hours control (collapsed; soft per-day adjustment + Skip Day)
 *   3. "Today we're studying: <Subject>" (a plain sentence, not a stat header)
 *   4. topic -> lecture rows (one flat row: name left, square checkbox right)
 *
 * THE DAY IS A FIXED SET: the plan assigned specific lectures to today's
 * date and watching never re-packs the plan. Ticking a lecture marks it
 * done - it leaves the list, nothing from tomorrow slides in, and when the
 * day's own lectures are all watched the day simply ENDS. Leftovers from
 * earlier days are "missed" (Backlog tab); catching up is a deliberate
 * action (Catch me up / Backlog), never automatic.
 *
 * One accent colour marks what needs action; everything else is neutral
 * surface with whitespace-based hierarchy. No numeric "0/5" counters -
 * the single progress bar and the checkbox states carry the information.
 * Questions (MCQs) are NOT tracked here - the Revision tab owns them.
 */

const GREETINGS = ['Hiiii', 'Hey', 'Hello', 'Namaste', 'Hi'];
const GREETING_EMOJIS = ['👋', '😊', '🙃', '😄', '☺️', '🙂'];

/**
 * The daily greeting. Everything is always visible (no tap-to-expand):
 *
 *   1. "<random word> <name> <emoji>"  (name = daily nickname roulette)
 *   2. time-of-day line: "Good Morning 🌅" etc.
 *   3. the daily "chalo padhte hai" line (Hinglish, seeded per day)
 *   4. the streak chip (🔥 N-day streak) once she has a streak
 *   5. the day's quote, always visible in the serif type
 */
function GreetingBox({ paceBadge }: { paceBadge: ReactNode }) {
  const planConfig = useAppStore((s) => s.planConfig);
  const updatePlan = useAppStore((s) => s.updatePlan);
  const progress = useAppStore((s) => s.progress);
  const schedule = useAppStore((s) => s.schedule);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const now = new Date();
  const day = dayOfYear(now);
  const today = todayISO();
  const greeting = GREETINGS[day % GREETINGS.length];
  const emoji = GREETING_EMOJIS[Math.floor(day / 2) % GREETING_EMOJIS.length];
  // The name (with the daily nickname roulette) and the time-of-day line.
  const name = nameForDay(planConfig.studentName, today);
  const timeGreeting = greetingFor(now.getHours());
  const line = studyLineFor(today, now.getHours());
  const quote = STUDY_QUOTES[day % STUDY_QUOTES.length];
  const streak = useMemo(
    () => computeStreak(progress, schedule, today),
    [progress, schedule, today],
  );

  return (
    <div className="greeting">
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
      <div className="greeting-time">
        {timeGreeting.text} <span aria-hidden>{timeGreeting.emoji}</span>
      </div>
      <div className="greeting-line2">{line}</div>
      {streak > 0 ? (
        <div
          className="greeting-streak"
          title="Days with at least one lecture watched in the app. Off days and rest days don't break it."
        >
          <span aria-hidden>🔥</span> {streak}-day streak
        </div>
      ) : null}
      <div className="greeting-quote">
        “{quote.text}”
        {quote.author && quote.author !== 'Unknown' ? ` — ${quote.author}` : ''}
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
  const planConfig = useAppStore((s) => s.planConfig);
  const progress = useAppStore((s) => s.progress);
  const revision = useAppStore((s) => s.revision);
  const schedule = useAppStore((s) => s.schedule);
  const scheduleByDate = useAppStore((s) => s.scheduleByDate);
  const lectureIndex = useAppStore((s) => s.lectureIndex);
  const catchUp = useAppStore((s) => s.catchUp);
  const setRoute = useAppStore((s) => s.setRoute);
  const streakMilestonesSeen = useAppStore((s) => s.streakMilestonesSeen);
  const markStreakMilestoneSeen = useAppStore((s) => s.markStreakMilestoneSeen);
  /** Streak milestone (5, 10, 15, ...) box: shown once per milestone. */
  const [milestoneShown, setMilestoneShown] = useState<number | null>(null);
  /** "Done today" starts as a one-line summary; tapping it expands the list. */
  const [doneOpen, setDoneOpen] = useState(false);

  const today = todayISO();

  const stats = useMemo(
    () => computeTodayStats(planConfig, progress, schedule, today, lectureIndex),
    [planConfig, progress, schedule, today, lectureIndex],
  );
  const day = scheduleByDate.get(today);
  const completion = useMemo(
    () => dayCompletion(day, progress, lectureIndex),
    [day, progress, lectureIndex],
  );

  // Today's FIXED set: exactly the lectures the plan assigned to today's
  // date. Watching lectures never re-packs the schedule, so this list only
  // ever shrinks during the day - and when it is empty, the day is done.
  const unwatchedIds = useMemo(
    () => (day ? day.lectureIds.filter((id) => !progress[id]?.lectureWatched) : []),
    [day, progress],
  );
  const dayDone =
    day !== undefined && day.lectureIds.length > 0 && unwatchedIds.length === 0;

  const streak = useMemo(
    () => computeStreak(progress, schedule, today),
    [progress, schedule, today],
  );
  // The day is over, the streak just hit a multiple of 5, and this milestone
  // has not been celebrated yet.
  const milestoneDue =
    dayDone && streak >= 5 && streak % 5 === 0 && !streakMilestonesSeen.includes(streak);
  useEffect(() => {
    if (milestoneDue && milestoneShown !== streak) {
      setMilestoneShown(streak);
      markStreakMilestoneSeen(streak); // once, ever
    }
  }, [milestoneDue, streak, milestoneShown, markStreakMilestoneSeen]);

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
              <ProgressBar value={completion.doneSec} max={completion.plannedSec} tone={dayDone ? 'ok' : 'accent'} />
            </div>
            {unwatchedIds.length ? (
              <TopicSection lectureIds={unwatchedIds} showContext={false} />
            ) : null}
            {dayDone ? (
              <div
                className={`ok-box warm-copy${wasDoneAtMount.current ? '' : ' pop'}`}
                style={{ marginTop: 14 }}
              >
                {doneMessageFor(
                  today,
                  nameForDay(planConfig.studentName, today),
                )}
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
              <TopicSection lectureIds={doneToday} showContext={false} />
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

      {milestoneShown !== null ? (
        <Modal
          title="Streak milestone 🏆"
          onClose={() => setMilestoneShown(null)}
          footer={
            <button className="btn primary" onClick={() => setMilestoneShown(null)}>
              Let&rsquo;s go! 🚀
            </button>
          }
        >
          <p className="small warm-copy">{milestoneMessageFor(milestoneShown)}</p>
        </Modal>
      ) : null}
    </div>
  );
}
