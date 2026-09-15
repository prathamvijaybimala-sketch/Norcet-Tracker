# NORCET Study Tracker

An offline-first study tracker and schedule generator for NORCET / nursing exam preparation.

Import your lecture curriculum as JSON, pick a subject order and pacing, and the app generates a
day-by-day watch schedule. Tick lectures off as you go; the schedule is regenerated from what is
actually left, so marking things done out of order, taking leave days, or changing settings never
requires manual re-planning.

- **No backend, no login, no sync.** All state lives in your browser (IndexedDB).
- **Progress is never lost.** Debounced auto-save on every change, plus one-file JSON export/import.
- **Works at full scale.** The real curriculum (~1000 lectures / ~670 hours) regenerates the whole
  plan in a couple of milliseconds, so every checkbox tick is instant.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 63 unit + integration + UI tests
npm run build    # type-check + production bundle in dist/
npm run demo     # regenerate public/demo-curriculum.json
```

## Quick start in the app

1. **Import** — upload your curriculum JSON (or paste it, or hit *Load demo curriculum* to try it
   with a realistic 767-lecture / 516-hour sample).
2. **Plan** — drag subjects into study order, set daily hours, study days, playback speed and start
   date. The finish-date preview updates as you type.
3. **Today** — the day's lectures with three independent checkboxes: watched / notes / questions.
4. **Timeline** — the whole plan as a calendar; tap any day (past or future) to tick things off.
5. **Revise** — a spaced-repetition queue that is completely separate from the schedule.
6. **Data** — export one JSON file with everything in it, or restore one.

## Architecture

```
src/
  types.ts            domain types (Curriculum / PlanConfig / Progress / Revision)
  lib/
    parseCurriculum.ts  parseCurriculumJSON() - pure importer, stable id generation
    duration.ts         defensive HH:MM:SS parsing
    dates.ts            local-timezone YYYY-MM-DD helpers
    schedule.ts         generateSchedule() - the core engine (pure)
    stats.ts            derived numbers: plan summary, days ahead/behind, completion
    buffer.ts           buffer auto-suggestion heuristic
    revision.ts         spaced-repetition queue (pure)
    exportImport.ts     backup payload + schema validation
    storage.ts          IndexedDB (idb) with debounced writes + localStorage fallback
    colors.ts           stable per-subject colours
  store/appStore.ts     zustand store: 3 persisted slices + derived schedule
  screens/              Import, Plan, Today, Timeline, Revision, Data
  components/           LectureRow, SubjectOrderList, PaceControls, BulkMarkPanel, LeaveManager…
tests/                  parser, scheduler, revision, integration (spec §8.2), UI smoke tests
```

### The one rule that matters

**The day-by-day schedule is never stored.** It is always recomputed:

```
generateSchedule(curriculum, planConfig, progress) -> ScheduleDay[]
```

Only four things are persisted (`curriculum`, `planConfig`, `progress`, `revision`). This is what
makes reordering, leave days and out-of-order completion "just work": there is no stored plan to
patch, so there is no way for it to drift out of sync with reality.

| Screen | Thing | Writes to |
| --- | --- | --- |
| Import | curriculum JSON | `curriculum` |
| Plan | order, hours, days, speed, buffers, leave | `planConfig` |
| Today / Timeline / Mark done | checkboxes | `progress` |
| Revise | review / skip | `revision` (reads `progress`) |

### Lecture ids are stable, and that is deliberate

The source JSON has no ids, so `parseCurriculumJSON` derives them from names:

```
slugify(subject) + "__" + slugify(topic) + "__" + slugify(lecture)      (+ "--2" on collision)
```

Never from array indexes: if the upstream curriculum inserts or removes a lecture, index-based ids
would shift every later lecture and orphan all of your progress. Name-based ids mean re-importing an
updated file keeps every tick where it belongs. Lectures that disappear from a new file are reported
but never deleted from storage.

### Scheduling rules

- A day holds `dailyHours × 3600` seconds; a lecture costs `durationSec / playbackSpeed`.
- Lectures are packed greedily, but **a lecture is never split across two days** — one that does not
  fit is carried whole to the next study day, so some days are under-filled by design.
- Non-study weekdays and leave dates get zero lectures and are emitted as `type: "off"`.
- After the last lecture day of a subject, its buffer days are inserted, tagged `type: "buffer"`.
- A subject with nothing left contributes zero days *and* zero buffer days.

**Buffer days count through weekends and leave days by default** (a buffer of 3 = three calendar
days of rest, whatever weekdays they land on). The spec explicitly left this choice open; it is
configurable (`planConfig.bufferCountsOffDays`) and toggleable in the Plan screen, with the
reasoning documented in `src/types.ts` and `src/lib/schedule.ts`.

### Falling behind is visible, not "fixed" for you

Missed lectures are never silently reflowed. The Today screen shows a "N days behind" badge and a
backlog list, and offers an explicit **Catch me up** button, which restarts the plan from today and
re-spreads everything that is left. Surprise reshuffling of a study plan is worse than a visible
backlog.

### Revision is a separate module

A lecture enters the revision queue once **all three** checkboxes are ticked, due after
`revisionIntervals[0]` days (default `[3, 14, 30]`). "Reviewed" advances the stage; past the last
interval it loops on that interval forever, so nothing ever silently graduates out of revision
(documented choice). "Skip" moves a due item to tomorrow. The queue reads `progress` and writes only
`revision` — it never consumes daily hours and never affects `generateSchedule`. The Today screen
shows a non-blocking "N due for revision" badge that links to the tab, and nothing more.

## Verifying against the spec's sanity check (§8.2)

`tests/integration.test.ts` runs the exact scenario from the spec: Community Health Nursing →
Obs/Gyn → Pediatrics → Surgery → Medicine → Nursing Foundation → Pharmacology → Microbiology,
3 hrs/day, 6 days/week, 1.5× speed, starting 2026-09-15, using `public/demo-curriculum.json`
(8 subjects, 767 lectures, 516.1 raw hours — generated at true scale by `npm run demo`).

Result: **129 study days + 33 buffer days = 186 calendar days (~26.6 weeks), finishing
2027-03-16.**

The spec's estimate was ~172 days / ~24 weeks "finishing around early March 2027". Dividing hours
naively (516.1 h ÷ 1.5 ÷ 3 h = 114.7 study days → ~134 calendar days + 33 buffer ≈ 167–172) predicts
that figure; the real bin-packer lands ~8% longer because lectures are never split across days, so
each day is under-filled by the remainder of the next lecture (~10% here) and each subject boundary
wastes part of a day. That waste is required by the algorithm, so the test asserts a band around the
estimate (168–196 days, 24–28 weeks, finishing in March 2027) rather than the estimate itself.

The same test also covers the spec's walkthrough: marking 100 Obs/Gyn lectures pre-done compresses
the plan, adding a 5-day November leave block pushes the finish date later, a backup round-trips
without loss, and a malformed backup is rejected before anything is committed.

## Testing

| File | Covers |
| --- | --- |
| `tests/parseCurriculum.test.ts` | duration parsing, id stability across re-imports, malformed/missing/duplicate data, warnings |
| `tests/schedule.test.ts` | the seven §5.4 cases, no-split packing, playback speed, buffer modes, degenerate configs, perf (<50 ms) |
| `tests/revision.test.ts` | queue eligibility, stage advance + looping, skip semantics, decoupling from the schedule, stats helpers |
| `tests/integration.test.ts` | the §8.2 sanity check and the end-to-end walkthrough |
| `tests/ui.test.tsx` | rendering, ticking boxes, timeline, plan reorder/exclude/bulk-mark, revision flow (jsdom) |

## Android app (Capacitor)

The same client-side web app is wrapped as a native Android app with
[Capacitor](https://capacitorjs.com/) — no native code, no plugins, still 100% offline.

```bash
npm run cap:sync     # build the web app and copy it into android/
npm run cap:open     # open the project in Android Studio
npm run cap:run      # build and install on a connected device / emulator
```

- `capacitor.config.ts` — app id `app.norcet.tracker`, `webDir: dist`, `androidScheme: https`
  (so IndexedDB behaves exactly like it does in the browser).
- `android/` is committed (the standard Capacitor native project, regenerated/copied by `cap sync`).
- Vite builds with `base: './'` so the same bundle works on the web and inside the WebView.

### CI: `.github/workflows/android.yml`

Runs on the working branch `arena/01a0a541-norcet-tracker` (plus `v*` tags and manual dispatch) —
when this lands on `main`, add `main` to the push branches in the workflow.

Every push type-checks, runs the test suite, builds the web bundle, syncs Capacitor and assembles a
**debug APK** (uploaded as the `norcet-tracker-debug` artifact, kept 30 days).

Validate workflow edits locally before pushing — GitHub rejects a bad workflow file before any job
starts, which looks like a run that fails instantly with no logs:

```bash
npm run lint:workflows   # actionlint over .github/workflows
```

Pushing a tag like `v1.0.0` — or running the workflow manually with `build_type: release` — also
builds a **release APK and AAB**; tagged release builds are attached to the GitHub Release.

Optional signed release builds: set four repository secrets and the workflow writes
`android/key.properties` before building (otherwise release builds are simply unsigned):

| Secret | Value |
| --- | --- |
| `KEYSTORE_BASE64` | `base64 -w0 your.keystore` |
| `KEYSTORE_PASSWORD` | keystore password |
| `KEY_ALIAS` | key alias |
| `KEY_PASSWORD` | key password |

Version codes come from the GitHub run number; pass `version_name` on a manual run to override the
version name. Release builds also produce an `.aab` for Play Store uploads.

> Note: the Android build has not been executed in this repo's dev sandbox (no JDK/Android SDK there)
> — it is exercised by the GitHub Actions runner, which installs JDK 17 and the Android SDK.

## Notes and limitations (v1 non-goals)

- Single user, no auth, no cloud sync, no notifications.
- No automatic catch-up reflow (explicit action only, by design).
- "Questions done" is a checkbox, not a linked question bank.
- Import validation is a schema check, not a cryptographic integrity check — a hand-edited backup
  that is still schema-valid will be restored as-is.
- IndexedDB is the primary store; if it is unavailable (private browsing, blocked storage) the app
  falls back to localStorage rather than losing writes.
