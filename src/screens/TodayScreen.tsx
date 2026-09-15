import { useMemo } from 'react';
import { useAppStore } from '../store/appStore';
import { LectureRow } from '../components/LectureRow';
import { ProgressBar, EmptyState, StatCard } from '../components/ui';
import { completedOnDate, computeTodayStats, dayCompletion } from '../lib/stats';
import { formatDateLong, formatDate, todayISO } from '../lib/dates';
import { formatDuration } from '../lib/duration';
import { dueRevisions } from '../lib/revision';

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

  const today = todayISO();

  const stats = useMemo(
    () => computeTodayStats(curriculum, planConfig, progress, schedule, today),
    [curriculum, planConfig, progress, schedule, today],
  );
  const day = scheduleByDate.get(today);
  const completion = useMemo(() => dayCompletion(day, progress, lectureIndex), [day, progress, lectureIndex]);
  const revisionDue = useMemo(() => dueRevisions(revision, today).length, [revision, today]);

  // Lectures ticked today: they drop out of the schedule, so list them here
  // instead of letting them disappear.
  const doneToday = useMemo(() => completedOnDate(progress, today), [progress, today]);
  // Most recent first: the things to clear before worrying about anything else.
  const backlogIds = useMemo(() => {
    const ids: string[] = [];
    for (let i = schedule.length - 1; i >= 0 && ids.length < 10; i--) {
      const day = schedule[i];
      if (day.type !== 'study' || day.date >= today) continue;
      for (let j = day.lectureIds.length - 1; j >= 0 && ids.length < 10; j--) ids.push(day.lectureIds[j]);
    }
    return ids;
  }, [schedule, today]);

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
      <div className="card">
        <div className="row between wrap">
          <div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>{formatDateLong(today)}</div>
            <div className="tiny faint">
              {day?.type === 'study'
                ? `${day.lectureIds.length} lecture${day.lectureIds.length === 1 ? '' : 's'} planned · ${formatDuration(day.plannedSec)} at ${planConfig.playbackSpeed}×`
                : 'No lectures planned'}
            </div>
          </div>
          <span className={`badge ${stats.deltaDays <= -0.5 ? 'warn' : stats.deltaDays >= 0.5 ? 'ok' : ''}`}>
            {paceLabel}
          </span>
        </div>

        {completion.total > 0 ? (
          <div style={{ marginTop: 12 }}>
            <div className="row between tiny faint" style={{ marginBottom: 5 }}>
              <span>
                Watched {completion.watched}/{completion.total}
              </span>
              <span className="mono">
                {formatDuration(completion.doneSec)} / {formatDuration(completion.plannedSec)}
              </span>
            </div>
            <ProgressBar
              value={completion.doneSec}
              max={completion.plannedSec}
              tone={completion.allDone ? 'ok' : 'accent'}
            />
          </div>
        ) : null}
      </div>

      {stats.backlogLectures > 0 ? (
        <div className="card tight">
          <div className="row between wrap" style={{ gap: 10 }}>
            <div className="small">
              <b>{stats.backlogLectures}</b> lecture(s) from earlier days are still unwatched (
              {formatDuration(stats.backlogSec)}).
            </div>
            <button className="btn sm" onClick={catchUp}>
              Catch me up
            </button>
          </div>
          <div className="tiny faint" style={{ marginTop: 6 }}>
            "Catch me up" restarts the plan from today and re-spreads everything that is left. It is
            never done automatically - surprise reshuffling is worse than a visible backlog.
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
            <b>{revisionDue}</b> lecture(s) due for revision today
          </span>
          <span className="badge accent">Revise →</span>
        </button>
      ) : null}

      <div className="card">
        <div className="card-title">
          <span>Today's lectures</span>
          <span className="spacer" />
          {day?.subjectName ? <span className="tiny faint">{day.subjectName}</span> : null}
        </div>

        {day?.type === 'study' && day.lectureIds.length ? (
          <>
            {day.lectureIds.map((id) => (
              <LectureRow key={id} lectureId={id} showContext={false} />
            ))}
            {completion.allDone ? (
              <div className="ok-box" style={{ marginTop: 12 }}>
                Everything planned for today is watched. Nice. Tomorrow's list is already generated
                from what is left.
              </div>
            ) : null}
          </>
        ) : day?.type === 'buffer' ? (
          <EmptyState icon="🌿" title="Buffer day">
            {day.subjectName ? `${day.subjectName} is done — ` : ''}today is catch-up and rest time
            before the next subject starts.
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
          <div className="card-title">
            <span>Done today</span>
            <span className="spacer" />
            <span className="tiny faint">{formatDuration(doneTodaySec)} watched</span>
          </div>
          {doneToday.map((id) => (
            <LectureRow key={id} lectureId={id} showContext={false} />
          ))}
        </div>
      ) : null}

      {backlogIds.length ? (
        <div className="card">
          <div className="card-title">
            <span>Pending from earlier days</span>
            <span className="spacer" />
            <span className="tiny faint">
              {stats.backlogLectures} lectures · {formatDuration(stats.backlogSec)}
            </span>
          </div>
          {backlogIds.map((id) => (
            <LectureRow key={id} lectureId={id} showContext={false} showScheduledDate />
          ))}
          {stats.backlogLectures > backlogIds.length ? (
            <div className="tiny faint" style={{ marginTop: 8 }}>
              …and {stats.backlogLectures - backlogIds.length} more. Work through them here, or use
              “Catch me up” to re-plan everything left from today.
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="stat-grid">
        <StatCard value={stats.backlogLectures} label="Backlog" tone={stats.backlogLectures ? 'var(--warn)' : undefined} />
        <StatCard value={formatDuration(stats.actualSec)} label="Watched (eff.)" />
        <StatCard value={Object.keys(progress).length} label="Tracked" />
        <StatCard value={schedule.length ? schedule.length : 0} label="Plan days" />
      </div>
    </div>
  );
}
