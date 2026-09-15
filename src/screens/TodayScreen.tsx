import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAppStore } from '../store/appStore';
import { TopicSection } from '../components/TopicSection';
import { Modal, ProgressBar, EmptyState } from '../components/ui';
import { completedOnDate, computeTodayStats, dayCompletion } from '../lib/stats';
import { dayOfYear, formatDateLong, formatDate, todayISO } from '../lib/dates';
import { formatDuration } from '../lib/duration';
import { STUDY_QUOTES } from '../lib/quotes';
import { dueRevisions } from '../lib/revision';

/**
 * Homepage. Deliberately quiet: a greeting, today's lectures, what got done,
 * and a nudge if something slipped. Everything else (calendar, backlog,
 * data) lives in its own tab.
 */

const GREETINGS = ['Hiiii', 'Hey', 'Hello', 'Namaste', 'Hi'];
const GREETING_EMOJIS = ['👋', '😊', '🙃', '😄', '☺️', '🙂'];

/** How much scrolling (px, accumulated in one direction) flips the card. */
const SCROLL_THRESHOLD = 32;

function timeGreeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  if (hour >= 17 && hour < 21) return 'Good evening';
  return 'Good night';
}

/**
 * The daily greeting card.
 *
 * EXPANDED by default: greeting word + name + emoji, time-of-day + date, and
 * the day's quote (one per day, seeded off the day-of-year so it stays the
 * same all day long). Scrolling DOWN past the hysteresis threshold collapses
 * it to a single line ("Good morning, Priya · Tue 15 Sep"); scrolling back UP
 * past the threshold re-expands it. Small back-and-forth gestures reset the
 * accumulator, so they never cause jitter. A manual tap toggles the card and
 * wins until the next scroll direction change past the threshold. Collapse
 * state is local UI state only - never persisted.
 */
function GreetingBox({ paceBadge }: { paceBadge: ReactNode }) {
  const planConfig = useAppStore((s) => s.planConfig);
  const updatePlan = useAppStore((s) => s.updatePlan);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [manual, setManual] = useState<boolean | null>(null);

  const now = new Date();
  const day = dayOfYear(now);
  const greeting = GREETINGS[day % GREETINGS.length];
  const emoji = GREETING_EMOJIS[Math.floor(day / 2) % GREETING_EMOJIS.length];
  const name = planConfig.studentName.trim();
  const quote = STUDY_QUOTES[day % STUDY_QUOTES.length];
  const shown = manual ?? collapsed;

  // Scroll-driven collapse with hysteresis: movement only counts while it
  // keeps the same direction, and only past the threshold does anything flip.
  useEffect(() => {
    let lastY = window.scrollY;
    let acc = 0;
    const onScroll = () => {
      const y = window.scrollY;
      const dy = y - lastY;
      lastY = y;
      if (dy === 0) return;
      if ((acc > 0 && dy < 0) || (acc < 0 && dy > 0)) acc = 0;
      acc += dy;
      if (acc >= SCROLL_THRESHOLD) {
        setCollapsed(true);
        setManual(null);
        acc = 0;
      } else if (acc <= -SCROLL_THRESHOLD) {
        setCollapsed(false);
        setManual(null);
        acc = 0;
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const onCardClick = (e: React.MouseEvent) => {
    // Taps on the pencil (or any control) do not toggle the card.
    if (e.target instanceof Element && e.target.closest('button, a, input')) return;
    setManual(!shown);
  };

  return (
    <div className={`card greeting-card ${shown ? 'collapsed' : ''}`} onClick={onCardClick}>
      <div className="greeting-top">
        <div>
          <div className="greeting-line">
            {shown ? (
              <>
                {timeGreeting(now.getHours())}
                {name ? `, ${name}` : ''} · {formatDate(todayISO())}
              </>
            ) : (
              <>
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
              </>
            )}
            <span className="greeting-chev" aria-hidden>
              {shown ? '▸' : '▾'}
            </span>
          </div>
          <div className="greeting-collapse">
            <div className="greeting-collapse-inner">
              {shown ? null : (
                <div className="greeting-sub">
                  {timeGreeting(now.getHours())} · {formatDateLong(todayISO())}
                </div>
              )}
              <div className="greeting-quote">
                “{quote.text}”
                {quote.author && quote.author !== 'Unknown' ? ` — ${quote.author}` : ''}
              </div>
            </div>
          </div>
        </div>
        {paceBadge}
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
  const revisionDue = useMemo(() => dueRevisions(revision, today).length, [revision, today]);

  // Lectures ticked today: they drop out of the schedule, so list them here
  // instead of letting them disappear.
  const doneToday = useMemo(() => completedOnDate(progress, today), [progress, today]);

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

      <div className="card">
        <div className="card-title">
          <span>Today's lectures</span>
          <span className="spacer" />
          {day?.subjectName ? <span className="tiny faint">{day.subjectName}</span> : null}
        </div>

        {day?.type === 'study' && day.lectureIds.length ? (
          <>
            <div className="row between tiny faint" style={{ marginBottom: 6 }}>
              <span>
                Watched {completion.watched}/{completion.total}
              </span>
              <span className="mono">
                {formatDuration(completion.doneSec)} / {formatDuration(completion.plannedSec)}
              </span>
            </div>
            <div style={{ marginBottom: 10 }}>
              <ProgressBar
                value={completion.doneSec}
                max={completion.plannedSec}
                tone={completion.allDone ? 'ok' : 'accent'}
              />
            </div>
            <TopicSection lectureIds={day.lectureIds} showContext={false} />
            {completion.allDone ? (
              <div className="ok-box" style={{ marginTop: 12 }}>
                Everything planned for today is watched. Nice. Tomorrow's list is already
                generated from what is left.
              </div>
            ) : null}
          </>
        ) : day?.type === 'buffer' ? (
          <EmptyState icon="🌿" title="Rest day (buffer)">
            {day.subjectName ? `${day.subjectName} is done — ` : ''}
            today is the catch-up and rest time built into the plan before the next subject
            starts. Not an off day by mistake - it was scheduled here on purpose.
          </EmptyState>
        ) : day?.isLeaveDay ? (
          <EmptyState icon="🏖️" title="Leave day">
            Marked as time off. The plan resumes on the next available study day.
          </EmptyState>
        ) : day?.type === 'off' ? (
          <EmptyState icon="☕" title="Not a study day">
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
            <span className="greeting-chev" aria-hidden>
              {doneOpen ? '▴' : '▾'}
            </span>
          </button>
          <div className={`done-list ${doneOpen ? 'open' : ''}`}>
            <div className="done-list-inner">
              <TopicSection lectureIds={doneToday} showContext={false} accordion={false} />
            </div>
          </div>
        </div>
      ) : null}

      {stats.backlogLectures > 0 ? (
        <div className="card tight">
          <div className="row between wrap" style={{ gap: 10 }}>
            <div className="small">
              <b>{stats.backlogLectures}</b> lecture(s) from earlier days are still unwatched (
              {formatDuration(stats.backlogSec)}).
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn sm" onClick={catchUp}>
                Catch me up
              </button>
              <button className="btn sm ghost" onClick={() => setRoute('revision')}>
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
          className="card tight row between"
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
