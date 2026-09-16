import { useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { payloadSummary, validateExportPayload } from '../lib/exportImport';
import type { ExportPayload } from '../types';
import { Modal, StatCard } from '../components/ui';
import { formatDateLong } from '../lib/dates';
import { formatHours } from '../lib/duration';
import { subjectStats } from '../lib/parseCurriculum';
import { computePlanStats } from '../lib/stats';

export function DataScreen() {
  const curriculum = useAppStore((s) => s.curriculum);
  const planConfig = useAppStore((s) => s.planConfig);
  const progress = useAppStore((s) => s.progress);
  const revision = useAppStore((s) => s.revision);
  const schedule = useAppStore((s) => s.schedule);
  const lectureIndex = useAppStore((s) => s.lectureIndex);
  const exportData = useAppStore((s) => s.exportData);
  const applyBackup = useAppStore((s) => s.applyBackup);
  const resetEverything = useAppStore((s) => s.resetEverything);
  const planLockHash = useAppStore((s) => s.planLockHash);
  const clearPlanPassword = useAppStore((s) => s.clearPlanPassword);
  const setRoute = useAppStore((s) => s.setRoute);
  const notify = useAppStore((s) => s.notify);

  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<ExportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const stats = computePlanStats(schedule);
  let lectures = 0;
  let hours = 0;
  for (const subject of curriculum) {
    const s = subjectStats(subject);
    lectures += s.lectureCount;
    hours += s.totalSec;
  }
  // Only count lectures that still exist in the current curriculum, so a
  // stale progress entry can never inflate the number past the lecture count.
  const watched = Object.entries(progress).filter(
    ([id, p]) => p.lectureWatched && lectureIndex.has(id),
  ).length;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const raw = JSON.parse(await file.text());
      const result = validateExportPayload(raw);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPending(result.payload);
    } catch (err) {
      setError(`Could not read that file: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const commitBackup = () => {
    if (!pending) return;
    applyBackup({
      curriculum: pending.curriculum,
      planConfig: pending.planConfig,
      progress: pending.progress,
      revision: pending.revision,
    });
    const summary = payloadSummary(pending);
    setPending(null);
    notify(`Restored ${summary.subjects} subjects and ${summary.watched} completed lectures.`);
  };

  return (
    <div className="screen">
      <div className="stat-grid">
        <StatCard value={curriculum.length} label="Subjects" />
        <StatCard value={lectures} label="Lectures" />
        <StatCard value={`${formatHours(hours)}`} label="Total hrs" />
        <StatCard value={watched} label="Watched" />
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-title">Backup</div>
        <p className="small muted" style={{ marginTop: 0 }}>
          Everything is auto-saved to this device's IndexedDB as you work (debounced ~0.4s). Export
          is for durability: moving to another device, or reinstalling the app.
        </p>
        <div className="row wrap" style={{ gap: 8 }}>
          <button
            className="btn primary"
            disabled={busy || curriculum.length === 0}
            onClick={() => {
              setBusy(true);
              void exportData().finally(() => setBusy(false));
            }}
          >
            {busy ? 'Preparing…' : 'Export data (JSON)'}
          </button>
          <button className="btn" onClick={() => fileInput.current?.click()}>
            Import data
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </div>
        {error ? (
          <div className="err-box" style={{ marginTop: 10 }}>
            {error}
          </div>
        ) : null}
      </div>

      <div className="card">
        <div className="card-title">Current plan</div>
        <div className="small">
          Start <b>{formatDateLong(planConfig.startDate)}</b>
          {stats.finishDate ? (
            <>
              {' '}
              → finish <b>{formatDateLong(stats.finishDate)}</b>
            </>
          ) : null}
        </div>
        <div className="tiny faint" style={{ marginTop: 4 }}>
          {planConfig.dailyHours} h/day · {planConfig.studyDays.length} days/week ·{' '}
          {planConfig.playbackSpeed}× speed · {planConfig.leaveDates.length} leave day(s) ·{' '}
          {Object.keys(revision).length} revision item(s)
        </div>
        <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
          <button className="btn sm" onClick={() => setRoute('setup')}>
            Edit order &amp; pacing
          </button>
          <button className="btn sm" onClick={() => setRoute('import')}>
            Re-import curriculum
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title" style={{ color: 'var(--danger)' }}>
          Danger zone
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          Clears the curriculum, plan, progress and revision queue from this device. Export first if
          you are not sure.
        </p>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn danger" onClick={() => setConfirmReset(true)}>
            Erase all local data
          </button>
          {planLockHash ? (
            <button className="btn" onClick={() => clearPlanPassword()}>
              Remove plan lock
            </button>
          ) : null}
        </div>
      </div>

      {pending ? (
        <Modal
          title="Restore this backup?"
          onClose={() => setPending(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setPending(null)}>
                Cancel
              </button>
              <button className="btn primary" onClick={commitBackup}>
                Restore
              </button>
            </>
          }
        >
          <ImportSummary payload={pending} />
          <div className="warn-box" style={{ marginTop: 12 }}>
            Restoring overwrites everything currently on this device.
          </div>
        </Modal>
      ) : null}

      {confirmReset ? (
        <Modal
          title="Erase all local data?"
          onClose={() => setConfirmReset(false)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setConfirmReset(false)}>
                Keep my data
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  setConfirmReset(false);
                  void resetEverything();
                }}
              >
                Erase everything
              </button>
            </>
          }
        >
          <p className="small">
            This deletes {curriculum.length} subject(s), {Object.keys(progress).length} progress
            record(s) and {Object.keys(revision).length} revision item(s) from this browser. It
            cannot be undone unless you exported first.
          </p>
          <p className="small muted">The app will return to the import screen.</p>
        </Modal>
      ) : null}
    </div>
  );
}

function ImportSummary({ payload }: { payload: ExportPayload }) {
  const s = payloadSummary(payload);
  // Primitive selectors: an object-returning selector re-renders on every
  // store change (and is a crash under zustand v5).
  const subjects = useAppStore((st) => st.curriculum.length);
  const progressCount = useAppStore((st) => Object.keys(st.progress).length);
  return (
    <div className="stack">
      <div className="small">
        This will restore progress for <b>{s.watched}</b> completed lecture
        {s.watched === 1 ? '' : 's'} across <b>{s.subjects}</b> subject
        {s.subjects === 1 ? '' : 's'} ({s.lectures} lectures, {s.revisionItems} revision items),
        overwriting the {subjects} subject(s) and {progressCount} progress record(s)
        currently on this device.
      </div>
      {s.exportedAt ? (
        <div className="tiny faint">
          Exported {formatDateLong(s.exportedAt.slice(0, 10))}
          {payload.appVersion ? ` · app v${payload.appVersion}` : ''}
        </div>
      ) : null}
    </div>
  );
}
