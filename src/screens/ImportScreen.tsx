import { useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import {
  CurriculumParseError,
  parseCurriculumDetailed,
  subjectStats,
  type ParseWarning,
} from '../lib/parseCurriculum';
import type { Subject } from '../types';
import { formatHours } from '../lib/duration';
import { Modal } from '../components/ui';

type Preview = {
  subjects: Subject[];
  warnings: ParseWarning[];
  lectures: number;
  totalSec: number;
};

export function ImportScreen() {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const hasCurriculum = useAppStore((s) => s.curriculum.length > 0);
  const existingSubjects = useAppStore((s) => s.curriculum.length);
  const importCurriculum = useAppStore((s) => s.importCurriculum);
  const notify = useAppStore((s) => s.notify);

  const buildPreview = (raw: string) => {
    setError(null);
    try {
      const { subjects, warnings, lectureCount, totalSec } = parseCurriculumDetailed(raw);
      setPreview({ subjects, warnings, lectures: lectureCount, totalSec });
      setText((current) => (current === raw ? current : raw));
    } catch (err) {
      setPreview(null);
      setError(err instanceof CurriculumParseError ? err.message : `Could not read that file: ${String(err)}`);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const raw = await file.text();
      buildPreview(raw);
    } catch {
      setError('Could not read that file.');
    }
  };

  const commit = () => {
    if (!preview) return;
    const raw = text;
    const result = importCurriculum(raw);
    setPreview(null);
    setText('');
    setConfirming(false);
    notify(
      `Imported ${result.subjects} subjects / ${result.lectures} lectures${
        result.warnings ? ` · ${result.warnings} warning(s)` : ''
      }.`,
    );
  };

  const askCommit = () => {
    if (hasCurriculum) setConfirming(true);
    else commit();
  };

  const loadDemo = async () => {
    setLoadingDemo(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}demo-curriculum.json`);
      if (!res.ok) throw new Error(String(res.status));
      const raw = await res.text();
      buildPreview(raw);
    } catch {
      setError('Could not load the demo curriculum.');
    } finally {
      setLoadingDemo(false);
    }
  };

  return (
    <div className="screen">
      <div className="card">
        <div className="card-title">Import your curriculum</div>
        <p className="small muted" style={{ marginTop: 0 }}>
          Upload the lecture JSON exported from your classes app. Everything stays on this device -
          there is no server, no login, no upload.
        </p>

        <div className="stack">
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            onChange={(e) => void onFile(e.target.files?.[0])}
            style={{ display: 'none' }}
          />
          <div className="row wrap">
            <button className="btn primary" onClick={() => fileInput.current?.click()}>
              Choose JSON file
            </button>
            <button className="btn" onClick={() => void loadDemo()} disabled={loadingDemo}>
              {loadingDemo ? 'Loading…' : 'Load demo curriculum'}
            </button>
          </div>

          <div className="field">
            <label>…or paste JSON here</label>
            <textarea
              value={text}
              placeholder='{ "Anatomy and Physiology": { "instructor": "…", "topics": [ … ] } }'
              onChange={(e) => setText(e.target.value)}
              onBlur={() => text.trim() && buildPreview(text)}
            />
          </div>
          {text.trim() ? (
            <button className="btn" onClick={() => buildPreview(text)}>
              Parse pasted JSON
            </button>
          ) : null}
        </div>

        {error ? (
          <div className="err-box" style={{ marginTop: 12 }}>
            {error}
          </div>
        ) : null}
      </div>

      {preview ? (
        <div className="card">
          <div className="card-title">
            <span>Preview</span>
            <span className="spacer" />
            <span className="tiny faint">
              {preview.subjects.length} subjects · {preview.lectures} lectures ·{' '}
              {formatHours(preview.totalSec)} hrs
            </span>
          </div>

          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Instructor</th>
                  <th className="num">Hours</th>
                  <th className="num">Lectures</th>
                </tr>
              </thead>
              <tbody>
                {preview.subjects.map((subject) => {
                  const stats = subjectStats(subject);
                  return (
                    <tr key={subject.id}>
                      <td>{subject.name}</td>
                      <td className="muted small">{subject.instructor || '—'}</td>
                      <td className="num mono">{formatHours(stats.totalSec)}</td>
                      <td className="num mono">{stats.lectureCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {preview.warnings.length ? (
            <details style={{ marginTop: 10 }}>
              <summary className="small" style={{ color: 'var(--warn)' }}>
                {preview.warnings.length} warning(s): lectures kept, nothing dropped
              </summary>
              <ul className="small muted" style={{ paddingLeft: 18, marginTop: 6 }}>
                {preview.warnings.slice(0, 40).map((w, i) => (
                  <li key={i}>{w.message}</li>
                ))}
                {preview.warnings.length > 40 ? (
                  <li>…and {preview.warnings.length - 40} more.</li>
                ) : null}
              </ul>
            </details>
          ) : null}

          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn primary" onClick={askCommit}>
              {hasCurriculum ? 'Re-import and merge' : 'Import curriculum'}
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                setPreview(null);
                setText('');
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {hasCurriculum && !preview ? (
        <div className="card tight">
          <div className="row between wrap">
            <div className="small muted">
              A curriculum with <b>{existingSubjects}</b> subjects is already loaded. Re-importing
              updates names and durations and keeps every progress record whose lecture still
              exists.
            </div>
          </div>
        </div>
      ) : null}

      {confirming ? (
        <Modal
          title="Re-import curriculum?"
          onClose={() => setConfirming(false)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button className="btn primary" onClick={commit}>
                Re-import & keep progress
              </button>
            </>
          }
        >
          <p className="small">
            Re-importing will update lecture names and durations but <b>preserve your existing
            progress</b> by matching lecture IDs. Lectures that are no longer present in the new
            file are flagged, not deleted: their progress records stay in storage so nothing is lost
            if you import the old file again.
          </p>
          <p className="small muted">
            Lecture IDs are derived from subject / topic / lecture names (never array positions), so
            appending new lectures upstream never orphans what you have already done.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
