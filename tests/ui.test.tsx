// @vitest-environment jsdom
/**
 * UI smoke tests: the screens render, ticking a box updates the schedule
 * immediately, and bulk actions reflow the plan. These run against the real
 * React components (no backend, no IndexedDB - storage falls back to
 * localStorage in jsdom).
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import App from '../src/App';
import { useAppStore } from '../src/store/appStore';
import { addDays, dayOfYear, isISODate, todayISO, weekdayOf } from '../src/lib/dates';
import { DONE_MESSAGES, nameForDay } from '../src/lib/dayFlavor';
import { nextOffDayOnOrAfter } from '../src/lib/schedule';
import { computePlanStats } from '../src/lib/stats';
import { STUDY_QUOTES } from '../src/lib/quotes';
import { makeSubjects, hours } from './helpers';
import type { PlanConfig, ProgressStore } from '../src/types';

/** Native-platform export path: flipped per test (defaults to the web path). */
const capMock = vi.hoisted(() => ({
  native: false,
  writeFile: vi.fn(),
  share: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => capMock.native },
}));
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile: capMock.writeFile },
  Directory: { Documents: 'DOCUMENTS' },
}));
vi.mock('@capacitor/share', () => ({
  Share: { share: capMock.share },
}));

const demo = readFileSync(resolve(__dirname, '../public/demo-curriculum.json'), 'utf8');

// The export path creates + revokes a Blob URL. Depending on the jsdom
// build, the URL object may lack one of the helpers (and CI has hit a build
// where the 1s-later revoke timer blew up as an unhandled error). Stub any
// missing helper - with writable: true, so the export tests' own per-test
// swaps and restores keep working.
for (const name of ['createObjectURL', 'revokeObjectURL'] as const) {
  if (typeof (URL as unknown as Record<string, unknown>)[name] === 'function') continue;
  Object.defineProperty(URL, name, {
    value: name === 'createObjectURL' ? vi.fn(() => 'blob:norcet-test') : vi.fn(),
    writable: true,
    configurable: true,
  });
}

async function boot() {
  await useAppStore.getState().resetEverything();
  const view = render(<App />);
  // Wait for hydration to finish before driving the UI.
  await waitFor(() => expect(useAppStore.getState().ready).toBe(true));
  return view;
}

async function importDemo() {
  useAppStore.getState().importCurriculum(demo);
  await waitFor(() => expect(useAppStore.getState().curriculum.length).toBe(8));
}

/** Plan and Data live in the hamburger side menu (not the bottom row). */
async function openMenu() {
  fireEvent.click(await screen.findByRole('button', { name: 'Open menu' }));
  await screen.findByRole('button', { name: /Plan/ });
}

describe('import screen', () => {
  it('shows the import screen when there is no curriculum', async () => {
    await boot();
    expect(await screen.findByText('Import your curriculum')).toBeTruthy();
    expect(screen.queryByText(/Today we.re studying/)).toBeNull();
  });

  it('parses pasted JSON and shows a summary table', async () => {
    await boot();
    const textarea = screen.getByPlaceholderText(/Anatomy and Physiology/i);
    fireEvent.change(textarea, {
      target: {
        value: JSON.stringify({
          'Test Subject': {
            instructor: 'Dr X',
            topics: [
              { topic: 'T1', subtopics: [{ name: 'L1', duration: '01:00:00' }] },
            ],
          },
        }),
      },
    });
    fireEvent.click(screen.getByText('Parse pasted JSON'));
    expect(await screen.findByText('Preview')).toBeTruthy();
    expect(screen.getByText('Test Subject')).toBeTruthy();
    expect(screen.getByText('1.0')).toBeTruthy(); // hours
  });

  it('re-importing a different curriculum prunes stale progress and revision', async () => {
    await boot();
    await importDemo();
    const state = useAppStore.getState();
    const id = state.schedule[0].lectureIds[0];
    // Fully done -> also enters the revision queue (3 days out).
    state.setFlags(id, { lectureWatched: true, notesDone: true, questionsDone: true });
    expect(Object.keys(useAppStore.getState().revision)).toHaveLength(1);

    // A completely different curriculum: none of the old lecture ids exist.
    const other = JSON.stringify({
      'Brand New Subject': {
        instructor: 'Dr Y',
        topics: [{ topic: 'T1', subtopics: [{ name: 'L1', duration: '01:00:00' }] }],
      },
    });
    useAppStore.getState().importCurriculum(other);

    const after = useAppStore.getState();
    expect(after.curriculum).toHaveLength(1);
    const freshIds = new Set<string>();
    for (const sub of after.curriculum)
      for (const t of sub.topics) for (const l of t.lectures) freshIds.add(l.id);
    // Orphaned progress / revision entries must be gone (persisted + exported).
    expect(Object.keys(after.progress).every((k) => freshIds.has(k))).toBe(true);
    expect(Object.keys(after.revision).every((k) => freshIds.has(k))).toBe(true);
  });
});

describe('today screen', () => {
  it("lists today's lectures; ticking only shrinks the list (the day is a fixed set)", async () => {
    await boot();
    await importDemo();
    expect(await screen.findByText(/Today we.re studying/)).toBeTruthy();

    const state = () => useAppStore.getState();
    const todayIds = [...(state().scheduleByDate.get(state().planConfig.startDate)?.lectureIds ?? [])];
    expect(todayIds.length).toBeGreaterThan(0);

    const before = state().schedule.length;
    const lecture = state().lectureIndex.get(todayIds[0])!;
    expect(screen.getByText(lecture.lecture.name)).toBeTruthy();

    // Tick the square checkbox on the first flat row (name left, box right).
    const row = screen.getAllByText(lecture.lecture.name)[0].closest('.lec-row') as HTMLElement;
    const boxes = within(row).getAllByRole('checkbox');
    expect(boxes).toHaveLength(1); // one box per lecture (watched + notes together)
    fireEvent.click(boxes[0]);

    await waitFor(() =>
      expect(useAppStore.getState().progress[todayIds[0]]?.lectureWatched).toBe(true),
    );
    expect(useAppStore.getState().progress[todayIds[0]]?.notesDone).toBe(true); // set together
    // The FIXED calendar is untouched: the lecture keeps its slot on today's
    // day (it is simply done) and the plan neither shrinks nor refills.
    expect(state().scheduleByDate.get(state().planConfig.startDate)!.lectureIds).toContain(
      todayIds[0],
    );
    expect(state().schedule.length).toBe(before);
    // …the row itself is gone from today's list (which shows the UNwatched).
    // Scoped to the study card: the collapsed "watched today" list also holds
    // the name in the DOM.
    await waitFor(() =>
      expect(
        within(document.querySelector('.study-card') as HTMLElement).queryAllByText(
          lecture.lecture.name,
        ),
      ).toHaveLength(0),
    );
    // …and it shows up in the "Done today" summary instead of vanishing.
    expect(await screen.findByText(/watched today/)).toBeTruthy();
  });

  it('uses ONE box per lecture (sets watched + notes together); Questions lives in the Revision tab', async () => {
    await boot();
    await importDemo();
    await screen.findByText(/Today we.re studying/);

    const state = () => useAppStore.getState();
    const firstId = state().schedule[0].lectureIds[0];
    const nameOf = (id: string) => state().lectureIndex.get(id)!.lecture.name;
    const row = screen.getAllByText(nameOf(firstId))[0].closest('.lec-row') as HTMLElement;
    const boxes = within(row).getAllByRole('checkbox');
    expect(boxes).toHaveLength(1); // one box per lecture
    fireEvent.click(boxes[0]);
    // Both fields set in the same update (data model unchanged)…
    expect(state().progress[firstId].lectureWatched).toBe(true);
    expect(state().progress[firstId].notesDone).toBe(true);
    expect(state().progress[firstId].questionsDone).toBe(false);

    // …and unticking clears both. The watched lecture now sits in "Done
    // today", so untick it from there.
    fireEvent.click(await screen.findByText(/watched today/));
    await waitFor(() =>
      expect(document.querySelector('.done-list')!.className).toContain('open'),
    );
    const doneRow = within(document.querySelector('.done-list') as HTMLElement)
      .getByText(nameOf(firstId))
      .closest('.lec-row') as HTMLElement;
    fireEvent.click(within(doneRow).getByRole('checkbox'));
    expect(state().progress[firstId].lectureWatched).toBe(false);
    expect(state().progress[firstId].notesDone).toBe(false);

    // The homepage tracks LECTURES ONLY: no Questions checkbox anywhere on
    // the Today screen.
    expect(screen.queryAllByRole('checkbox', { name: /Questions done for / })).toHaveLength(0);

    // Questions live in the Revision tab: watch the lecture again, open the
    // tab, and the topic appears with its single per-topic checkbox.
    fireEvent.click(
      screen.getAllByText(nameOf(firstId))[0].closest('.lec-row')!.querySelector('input')!,
    );
    const topic = state().lectureIndex.get(firstId)!.topic;
    fireEvent.click(screen.getByRole('button', { name: /Revision/ }));
    expect(await screen.findByText('Questions by topic')).toBeTruthy();
    const box = await screen.findByRole('checkbox', { name: `Questions done for ${topic.name}` });
    fireEvent.click(box);
    // One tick covers the whole topic, including lectures not on this day.
    for (const l of topic.lectures) {
      expect(state().progress[l.id]?.questionsDone).toBe(true);
    }
  });

  it('flat rows: name on the left, one square checkbox on the right, per lecture', async () => {
    await boot();
    await importDemo();
    await screen.findByText(/Today we.re studying/);

    const state = () => useAppStore.getState();
    const dayIds = state().scheduleByDate.get(state().planConfig.startDate)!.lectureIds;
    expect(dayIds.length).toBeGreaterThanOrEqual(2);
    const nameOf = (id: string) => state().lectureIndex.get(id)!.lecture.name;

    // Exactly one checkbox per lecture - nothing else in the study card.
    const boxes = screen.getAllByRole('checkbox', { name: /Mark watched: / });
    expect(boxes).toHaveLength(dayIds.length);
    // No accordion anywhere: every row is a flat .lec-row with the box last
    // (on the right) and the name inside it (on the left).
    expect(document.querySelector('.lecture.acc')).toBeNull();
    for (const id of dayIds) {
      const row = screen.getAllByText(nameOf(id))[0].closest('.lec-row') as HTMLElement;
      expect(row.className).toContain('lec-row');
      expect(row.textContent).toContain(nameOf(id));
      expect(row.lastElementChild).toBe(boxes.find((b) => b.closest('.lec-row') === row));
    }
  });

  it('ticking a row removes it - the list never grows, and no future lecture slides in', async () => {
    await boot();
    await importDemo();
    await screen.findByText(/Today we.re studying/);

    const state = () => useAppStore.getState();
    const day = state().scheduleByDate.get(state().planConfig.startDate)!;
    expect(day.lectureIds.length).toBeGreaterThanOrEqual(2);
    const [a, b] = day.lectureIds;
    const lastId = day.lectureIds[day.lectureIds.length - 1];
    const nameOf = (id: string) => state().lectureIndex.get(id)!.lecture.name;

    // A lecture from a LATER study day must NOT be visible on Today.
    const laterDay = state().schedule.find(
      (d) => d.type === 'study' && d.date !== state().planConfig.startDate,
    )!;
    const futureName = nameOf(laterDay.lectureIds[0]);
    expect(screen.queryByText(futureName)).toBeNull();

    // One tap on the square box: the lecture leaves the list and NOTHING
    // replaces it - the rest of the fixed day set remains, in order.
    const row = screen.getAllByText(nameOf(a))[0].closest('.lec-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('checkbox'));
    await waitFor(() => expect(state().progress[a]?.lectureWatched).toBe(true));
    const card = () => document.querySelector('.study-card') as HTMLElement;
    await waitFor(() => expect(within(card()).queryByText(nameOf(a))).toBeNull());
    expect(within(card()).getByText(nameOf(b))).toBeTruthy();
    expect(within(card()).getByText(nameOf(lastId))).toBeTruthy();
    // Still no future lecture has slid in.
    expect(within(card()).queryByText(futureName)).toBeNull();

    // The finished lecture shows up in the "Done today" summary with its box
    // pre-ticked (watched + notes came together).
    fireEvent.click(await screen.findByText(/watched today/));
    await waitFor(() =>
      expect(document.querySelector('.done-list')!.className).toContain('open'),
    );
    const doneRow = within(document.querySelector('.done-list') as HTMLElement)
      .getByText(nameOf(a))
      .closest('.lec-row') as HTMLElement;
    const box = within(doneRow).getByRole('checkbox') as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(state().progress[a]?.lectureWatched).toBe(true);
    expect(state().progress[a]?.notesDone).toBe(true);
  });

  it('shows "Done today" as a one-line summary that expands on tap', async () => {
    await boot();
    await importDemo();
    await screen.findByText(/Today we.re studying/);

    const state = () => useAppStore.getState();
    const id = state().scheduleByDate.get(state().planConfig.startDate)!.lectureIds[0];
    state().setFlags(id, { lectureWatched: true, notesDone: true });

    const summary = await screen.findByText(/watched today/);
    const listEl = () => document.querySelector('.done-list') as HTMLElement;
    expect(listEl().className).not.toContain('open');
    fireEvent.click(summary);
    await waitFor(() => expect(listEl().className).toContain('open'));
    expect(listEl().querySelectorAll('.lecture').length).toBeGreaterThan(0);
  });

  it('queues a lecture for revision only when all three boxes are ticked', async () => {
    await boot();
    await importDemo();
    await screen.findByText(/Today we.re studying/);

    const state = () => useAppStore.getState();
    const firstId = state().schedule[0].lectureIds[0];
    state().setFlag(firstId, 'lectureWatched', true);
    state().setFlag(firstId, 'notesDone', true);
    expect(Object.keys(state().revision)).toHaveLength(0);
    state().setFlag(firstId, 'questionsDone', true);
    expect(Object.keys(state().revision)).toEqual([firstId]);
    expect(state().revision[firstId].intervalStage).toBe(0);
  });
});

describe('today hours control', () => {
  const state = () => useAppStore.getState();
  const count = (date: string) => state().scheduleByDate.get(date)?.lectureIds.length ?? 0;
  const totalLectures = () =>
    state().schedule.reduce((n, d) => n + d.lectureIds.length, 0);
  /** First study day on/after `date` - must be untouched by week-scoped edits. */
  const nextStudyDayIds = (date: string) => {
    const day = state().schedule.find((d) => d.date > date && d.type === 'study');
    return day?.lectureIds ?? [];
  };

  async function openHours() {
    await boot();
    await importDemo();
    await screen.findByText(/Today we.re studying/);
    fireEvent.click(await screen.findByRole('button', { name: /Today:/ }));
    await screen.findByText(/only rebalances this week/);
  }

  it('increasing today reflows the week: later days get lighter (soft, week-scoped)', async () => {
    await openHours();
    const today = todayISO();
    const offDay = nextOffDayOnOrAfter(today, state().planConfig)!;
    const todayBefore = count(today);
    const nextWeekBefore = nextStudyDayIds(offDay);
    const totalBefore = totalLectures();
    expect(todayBefore).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('4h'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(state().planConfig.dayHours[today]).toBe(4));
    // Today grew…
    expect(count(today)).toBeGreaterThan(todayBefore);
    // …and the whole week reflows around it: no lectures created or
    // destroyed (the week's later days carry the difference), next week
    // untouched…
    expect(totalLectures()).toBe(totalBefore);
    expect(nextStudyDayIds(offDay)).toEqual(nextWeekBefore);
    // …no negative loads anywhere.
    for (const day of state().schedule) expect(day.plannedSec).toBeGreaterThanOrEqual(0);
    // …and it never touches the leave-day / backlog machinery or dailyHours.
    expect(state().planConfig.dailyHours).toBe(3);
    expect(state().planConfig.leaveDates).toEqual([]);
    expect(state().planConfig.offDayLectures).toEqual({});
    expect(state().planConfig.backlogAnchor).toBeNull();
    // The compact row now shows the override with a plan hint.
    expect(screen.getByRole('button', { name: /Today: 4h/ })).toBeTruthy();
  });

  it('reducing today via the slider rides the shortfall onto the week\'s off day (soft)', async () => {
    await openHours();
    const today = todayISO();
    const offDay = nextOffDayOnOrAfter(today, state().planConfig)!;
    expect(state().scheduleByDate.get(offDay)?.type).toBe('off'); // off day to start
    const todayBefore = count(today);
    const nextWeekBefore = nextStudyDayIds(offDay);
    const totalBefore = totalLectures();

    fireEvent.click(screen.getByText('2h'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(state().planConfig.dayHours[today]).toBe(2));
    // Today shrank; the off day opened as a study day carrying the tail.
    expect(count(today)).toBeLessThan(todayBefore);
    await waitFor(() => expect(count(offDay)).toBeGreaterThan(0));
    expect(state().scheduleByDate.get(offDay)?.type).toBe('study');
    // Total content unchanged, next week untouched, no leave-day side effects.
    expect(totalLectures()).toBe(totalBefore);
    expect(nextStudyDayIds(offDay)).toEqual(nextWeekBefore);
    expect(state().planConfig.leaveDates).toEqual([]);
    expect(state().planConfig.dailyHours).toBe(3);
  });

  it('Skip Day adds today to leaveDates - a real leave day that shifts the whole plan', async () => {
    await openHours();
    const today = todayISO();
    const finishBefore = computePlanStats(state().schedule).finishDate;
    const todayLectures = [...state().scheduleByDate.get(today)!.lectureIds];
    const allBefore = new Set(state().schedule.flatMap((d) => d.lectureIds));
    expect(todayLectures.length).toBeGreaterThan(0);
    expect(state().planConfig.leaveDates).not.toContain(today);

    fireEvent.click(screen.getByRole('button', { name: 'Skip Day' }));

    await waitFor(() => expect(state().planConfig.leaveDates).toContain(today));
    // Today is now a leave day: zero lectures, flagged as leave…
    expect(count(today)).toBe(0);
    expect(state().scheduleByDate.get(today)?.isLeaveDay).toBe(true);
    // …and the plan shifts exactly like any leave day: every lecture that
    // sat on today carries forward to a LATER date, nothing is dropped…
    const dateOf = new Map(state().schedule.flatMap((d) => d.lectureIds.map((id) => [id, d.date])));
    for (const id of todayLectures) {
      const after = dateOf.get(id);
      expect(after).toBeTruthy();
      expect(after! > today, `${id} must move to a later date`).toBe(true); // ISO: lex = chronological
    }
    // …no lecture is lost or duplicated, and the finish date never moves
    // earlier (slack later in the plan may absorb the shift).
    const allAfter = state().schedule.flatMap((d) => d.lectureIds);
    expect(new Set(allAfter)).toEqual(allBefore);
    expect(allAfter).toHaveLength([...allBefore].length);
    const finishAfter = computePlanStats(state().schedule).finishDate;
    expect(finishAfter).not.toBeNull();
    // ISO dates: lexicographic order = chronological order.
    expect(finishAfter! >= (finishBefore ?? '')).toBe(true);
    // …and it deliberately does NOT touch the soft-override machinery.
    expect(state().planConfig.dayHours).toEqual({});
    expect(state().planConfig.offDayLectures).toEqual({});
    expect(state().planConfig.backlogAnchor).toBeNull();
  });
});

describe('timeline screen', () => {
  it('renders months, day cells and a day detail modal', async () => {
    await boot();
    await importDemo();
    fireEvent.click(await screen.findByRole('button', { name: /Timeline/ }));
    expect(await screen.findByText(/September 2026/)).toBeTruthy();
    expect(screen.getByText(/March 2027/)).toBeTruthy();

    const cells = document.querySelectorAll('.day-cell.has-plan');
    expect(cells.length).toBeGreaterThan(50);
    fireEvent.click(cells[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByRole('checkbox').length).toBeGreaterThan(0);
  });

  it('aligns every month under the correct weekday column (day 1 in its true weekday)', async () => {
    await boot();
    await importDemo();
    fireEvent.click(await screen.findByRole('button', { name: /Timeline/ }));
    await screen.findByText(/September 2026/);

    const gridOf = (label: string) =>
      [...document.querySelectorAll('.month-grid')].find((g) =>
        g.closest('.card')!.textContent!.includes(label),
      ) as HTMLElement;

    // October 2026: the 1st is a Thursday -> exactly 4 leading blanks.
    const octCells = [...gridOf('October 2026').querySelectorAll('.day-cell')];
    const oct1 = octCells.find((c) => (c as HTMLElement).title!.startsWith('Thu 1 Oct'));
    expect(octCells.indexOf(oct1 as HTMLElement)).toBe(4);

    // November 2026: the 1st is a Sunday -> no leading blanks at all.
    const novCells = [...gridOf('November 2026').querySelectorAll('.day-cell')];
    expect((novCells[0] as HTMLElement).title).toMatch(/^Sun 1 Nov/);

    // December 2026: the 1st is a Tuesday -> 2 leading blanks.
    const decCells = [...gridOf('December 2026').querySelectorAll('.day-cell')];
    const dec1 = decCells.find((c) => (c as HTMLElement).title!.startsWith('Tue 1 Dec'));
    expect(decCells.indexOf(dec1 as HTMLElement)).toBe(2);
  });

  it('the day detail modal lists the day FIXED set with checkboxes and a watched count - no Questions', async () => {
    await boot();
    await importDemo();
    fireEvent.click(await screen.findByRole('button', { name: /Timeline/ }));
    const cells = document.querySelectorAll('.day-cell.has-plan');
    expect(cells.length).toBeGreaterThan(0);
    fireEvent.click(cells[0] as HTMLElement);
    const dialog = (await screen.findByRole('dialog')) as HTMLElement;

    // Every lecture the plan assigned to that date is listed, each with its
    // own square checkbox - and Questions live in the Revision tab, not here.
    const firstDay = useAppStore.getState().schedule.find((d) => d.type === 'study')!;
    const names = firstDay.lectureIds.map(
      (id) => useAppStore.getState().lectureIndex.get(id)!.lecture.name,
    );
    for (const name of names) expect(within(dialog).getByText(name)).toBeTruthy();
    expect(
      within(dialog).queryAllByRole('checkbox', { name: /Mark watched: / }).length,
    ).toBe(names.length);
    expect(within(dialog).getByText(/watched 0\//)).toBeTruthy();
    expect(within(dialog).queryAllByRole('checkbox', { name: /Questions done for / })).toHaveLength(0);
    // No accordion anywhere in the modal either.
    expect(dialog.querySelector('.lecture.acc')).toBeNull();

    // Ticking a box in the modal marks the lecture done on its fixed day.
    const someId = firstDay.lectureIds[0];
    const someName = useAppStore.getState().lectureIndex.get(someId)!.lecture.name;
    const someRow = within(dialog)
      .getByText(someName)
      .closest('.lec-row') as HTMLElement;
    fireEvent.click(within(someRow).getByRole('checkbox'));
    expect(useAppStore.getState().progress[someId]?.lectureWatched).toBe(true);
  });
});

describe('questions live in the revision tab (not the homepage)', () => {
  const SPLIT = JSON.stringify({
    'Split Subject': {
      instructor: 'Dr S',
      topics: [
        {
          topic: 'Big Topic',
          subtopics: [
            { name: 'L1', duration: '02:00:00' },
            { name: 'L2', duration: '02:00:00' },
            { name: 'L3', duration: '02:00:00' },
          ],
        },
      ],
    },
  });

  it('a topic appears once watched, one tick covers the whole topic, only watched lectures queue', async () => {
    await boot();
    useAppStore.getState().importCurriculum(SPLIT);
    // 2h lectures, 3h day, 1x speed -> one lecture per day: the topic spans three days.
    useAppStore.getState().updatePlan({ playbackSpeed: 1 });
    const state = useAppStore.getState();
    const ids = state.schedule.filter((d) => d.type === 'study').map((d) => d.lectureIds[0]);
    expect(ids).toHaveLength(3);

    // Nothing watched yet: the section exists but has no topics.
    await screen.findByText(/Today we.re studying/);
    fireEvent.click(screen.getByRole('button', { name: /Revision/ }));
    expect(await screen.findByText('Questions by topic')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Questions done for Big Topic' })).toBeNull();

    // Watch L1 (its fixed day is today) - the topic now appears in the section.
    state.setFlags(ids[0], { lectureWatched: true, notesDone: true });
    const box = await screen.findByRole('checkbox', { name: 'Questions done for Big Topic' });

    // One tick covers the WHOLE topic - including L2/L3, which are scheduled on
    // LATER days (a single deliberate action, wherever the topic sits).
    fireEvent.click(box);
    const after = useAppStore.getState();
    for (const id of ids) expect(after.progress[id]?.questionsDone).toBe(true);
    expect((box as HTMLInputElement).checked).toBe(true);
    // L1 is watched + notes + questions -> it enters the queue. L2/L3 are not
    // watched yet, so they stay out until they are.
    expect(after.revision[ids[0]]).toBeTruthy();
    expect(after.revision[ids[1]]).toBeUndefined();
    expect(after.revision[ids[2]]).toBeUndefined();
  });
});

describe('plan screen', () => {
  it('previews the finish date and reacts to pacing changes', async () => {
    await boot();
    await importDemo();
    await openMenu();
    fireEvent.click(screen.getByRole('button', { name: /Plan/ }));
    expect(await screen.findByText('Live preview')).toBeTruthy();
    expect(screen.getByText(/you'll finish/)).toBeTruthy();

    const before = useAppStore.getState().schedule.length;
    fireEvent.change(screen.getByLabelText('Daily hours'), { target: { value: '6' } });
    await waitFor(() => expect(useAppStore.getState().schedule.length).toBeLessThan(before));
  });

  it('survives a cleared start date and clamps out-of-range pace values', async () => {
    await boot();
    await importDemo();
    await openMenu();
    fireEvent.click(screen.getByRole('button', { name: /Plan/ }));
    await screen.findByText('Live preview');

    const startBefore = useAppStore.getState().planConfig.startDate;
    const daysBefore = useAppStore.getState().schedule.length;
    // Clearing the date field delivers "" - the plan must stay intact
    // (this used to persist a garbage date and empty the whole schedule).
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '' } });
    expect(useAppStore.getState().planConfig.startDate).toBe(startBefore);
    expect(useAppStore.getState().schedule.length).toBe(daysBefore);

    // HTML max= is decorative: typed "99" must be clamped at the store.
    fireEvent.change(screen.getByLabelText('Daily hours'), { target: { value: '99' } });
    await waitFor(() => expect(useAppStore.getState().planConfig.dailyHours).toBe(16));
    fireEvent.change(screen.getByLabelText('Playback speed'), { target: { value: '99' } });
    await waitFor(() => expect(useAppStore.getState().planConfig.playbackSpeed).toBe(4));
    // A clamped plan still generates days.
    expect(useAppStore.getState().schedule.length).toBeGreaterThan(0);
  });

  it('refuses a leave range with a cleared date instead of injecting junk', async () => {
    await boot();
    await importDemo();
    await openMenu();
    fireEvent.click(screen.getByRole('button', { name: /Plan/ }));
    await screen.findByText('Live preview');
    fireEvent.click(screen.getByRole('button', { name: 'Leave days' }));

    // Clear the "From" date and submit - this used to loop dateRange to its
    // 20,000-iteration cap and flood leaveDates with NaN-dates.
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add range as leave' }));
    expect(useAppStore.getState().planConfig.leaveDates).toEqual([]);
    expect(await screen.findByText('Pick a valid From and To date first.')).toBeTruthy();
  });

  it('supports excluding a subject and reordering', async () => {
    await boot();
    await importDemo();
    await openMenu();
    fireEvent.click(screen.getByRole('button', { name: /Plan/ }));
    await screen.findByText('Live preview');

    const order = [...useAppStore.getState().planConfig.subjectOrder];
    const downButtons = screen.getAllByRole('button', { name: /Move .* down/ });
    fireEvent.click(downButtons[0]);
    expect(useAppStore.getState().planConfig.subjectOrder[0]).toBe(order[1]);

    const exclude = screen.getAllByRole('button', { name: /^Exclude / });
    fireEvent.click(exclude[0]);
    expect(useAppStore.getState().planConfig.subjectOrder).toHaveLength(order.length - 1);
    // Progress is untouched by exclusion.
    expect(useAppStore.getState().progress).toEqual({});
  });

  // "Mark done" moved OUT of the Plan tab into the bottom row.
  it('no longer has a Mark done tab - the feature lives in the bottom row', async () => {
    await boot();
    await importDemo();
    await openMenu();
    fireEvent.click(screen.getByRole('button', { name: /Plan/ }));
    await screen.findByText('Live preview');
    // No "Mark done" TAB on the Plan screen (the tab buttons are plain-text).
    const tabButtons = [...document.querySelectorAll('.tabs button')].map((b) => b.textContent);
    expect(tabButtons).not.toContain('Mark done');
    expect(screen.getAllByRole('button', { name: /Mark done/ })).toHaveLength(1); // bottom nav only
  });
});

describe('mark done screen (bottom tab)', () => {
  it('lists only the plan subjects with progress bars; marking a topic recalculates the plan', async () => {
    await boot();
    await importDemo();
    const state = () => useAppStore.getState();

    fireEvent.click(screen.getByRole('button', { name: /Mark done/ }));
    expect(await screen.findByText(/recalculates the plan without those lectures/)).toBeTruthy();

    // One row per plan subject, each with its progress bar.
    const subjectCount = state().planConfig.subjectOrder.length;
    expect(document.querySelectorAll('.md-subject')).toHaveLength(subjectCount);
    expect(document.querySelectorAll('.md-subject .bar')).toHaveLength(subjectCount);

    // Tap the first subject: its topics open, each with a checkbox.
    const subject = state().curriculum.find(
      (c) => c.id === state().planConfig.subjectOrder[0],
    )!;
    const topic = subject.topics[0];
    fireEvent.click(document.querySelector('.md-subject .md-subject-head') as HTMLElement);
    await screen.findByRole('checkbox', {
      name: `Mark topic "${topic.name}" as already done`,
    });

    // Mark the first topic as already done: it leaves the plan entirely and
    // the schedule recalculates without it.
    const topicIds = new Set(topic.lectures.map((l) => l.id));
    const before = state().schedule;
    fireEvent.click(
      screen.getByRole('checkbox', { name: `Mark topic "${topic.name}" as already done` }),
    );
    await screen.findByText(/recalculates without them/);
    for (const l of topic.lectures) {
      expect(state().progress[l.id]?.preDone).toBe(true);
      expect(state().progress[l.id]?.lectureWatched).toBe(true);
      expect(state().progress[l.id]?.completedDate).toBeNull(); // not "watched today"
    }
    expect(
      state().schedule.every((d) => d.lectureIds.every((id) => !topicIds.has(id))),
    ).toBe(true);
    expect(state().schedule.length).toBeLessThanOrEqual(before.length);
    expect(screen.queryByText(/watched today/)).toBeNull();

    // The topic's checkbox is now ON and shows "put back"; tapping it returns
    // the lectures to the plan.
    fireEvent.click(
      screen.getByRole('checkbox', { name: `Put topic "${topic.name}" back into the plan` }),
    );
    await screen.findByText(/put back into the plan/);
    expect(
      state().schedule.some((d) => d.lectureIds.some((id) => topicIds.has(id))),
    ).toBe(true);
    expect(
      topic.lectures.every((l) => state().progress[l.id]?.preDone !== true),
    ).toBe(true);
  });

  it('only lists the subjects the plan includes - excluded ones disappear', async () => {
    await boot();
    await importDemo();
    const state = () => useAppStore.getState();

    fireEvent.click(screen.getByRole('button', { name: /Mark done/ }));
    await screen.findByText(/recalculates the plan without those lectures/);
    expect(document.querySelectorAll('.md-subject')).toHaveLength(state().curriculum.length);

    // Exclude a subject from the plan...
    await openMenu();
    fireEvent.click(screen.getByRole('button', { name: /Plan/ }));
    await screen.findByText('Live preview');
    fireEvent.click(screen.getAllByRole('button', { name: /^Exclude / })[0]);
    expect(state().planConfig.subjectOrder).toHaveLength(state().curriculum.length - 1);

    // ...and it is gone from the Mark done list.
    fireEvent.click(screen.getByRole('button', { name: /Mark done/ }));
    await screen.findByText(/recalculates the plan without those lectures/);
    expect(document.querySelectorAll('.md-subject')).toHaveLength(
      state().curriculum.length - 1,
    );
  });

  it('tapping a chapter opens its lectures; marking one lecture recalculates the plan', async () => {
    await boot();
    await importDemo();
    const state = () => useAppStore.getState();

    fireEvent.click(screen.getByRole('button', { name: /Mark done/ }));
    await screen.findByText(/recalculates the plan without those lectures/);

    const subject = state().curriculum.find(
      (c) => c.id === state().planConfig.subjectOrder[0],
    )!;
    fireEvent.click(document.querySelector('.md-subject .md-subject-head') as HTMLElement);
    const topic = subject.topics[0];

    // Tapping the chapter row (not its checkbox) opens the individual lectures.
    fireEvent.click(document.querySelector(`.md-topic[data-topic="${topic.id}"]`) as HTMLElement);
    const lec = topic.lectures[0];
    await screen.findByRole('checkbox', { name: `Mark lecture "${lec.name}" as already done` });
    expect(
      document.querySelectorAll(`.md-topic[data-topic="${topic.id}"] + .md-lectures .md-lecture`),
    ).toHaveLength(topic.lectures.length);

    // Mark a SINGLE lecture: only it leaves the plan, the chapter's other
    // lectures keep their days.
    const others = topic.lectures.slice(1);
    fireEvent.click(
      screen.getByRole('checkbox', { name: `Mark lecture "${lec.name}" as already done` }),
    );
    await screen.findByText(/recalculates without them/);
    expect(state().progress[lec.id]?.preDone).toBe(true);
    expect(state().progress[lec.id]?.completedDate).toBeNull();
    expect(state().schedule.every((d) => !d.lectureIds.includes(lec.id))).toBe(true);
    expect(
      others.every((l) => state().schedule.some((d) => d.lectureIds.includes(l.id))),
    ).toBe(true);

    // Untick it: the lecture goes straight back into the plan.
    fireEvent.click(
      screen.getByRole('checkbox', { name: `Put lecture "${lec.name}" back into the plan` }),
    );
    await screen.findByText(/put back into the plan/);
    expect(state().progress[lec.id]?.preDone).not.toBe(true);
    expect(state().schedule.some((d) => d.lectureIds.includes(lec.id))).toBe(true);
  });

  it('holding the grip and dragging reorders a subject\'s chapters and re-packs the plan', async () => {
    await boot();
    await importDemo();
    const state = () => useAppStore.getState();

    fireEvent.click(screen.getByRole('button', { name: /Mark done/ }));
    await screen.findByText(/recalculates the plan without those lectures/);
    const subject = state().curriculum.find(
      (c) => c.id === state().planConfig.subjectOrder[0],
    )!;
    fireEvent.click(document.querySelector('.md-subject .md-subject-head') as HTMLElement);
    const topics = subject.topics;
    expect(topics.length).toBeGreaterThanOrEqual(3);

    // jsdom has no layout: hand each chapter row a 40px slot in DOM order.
    const layoutRows = () => {
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>('.md-topics .md-topic[data-topic]'),
      );
      rows.forEach((r, i) => {
        const top = i * 40;
        r.getBoundingClientRect = () =>
          ({ top, bottom: top + 40, height: 40, width: 320, left: 0, right: 320, x: 0, y: top }) as DOMRect;
      });
      return rows;
    };
    layoutRows();

    // Press the first chapter's grip and HOLD: after the hold threshold the
    // drag goes live (its row is highlighted).
    const rows = layoutRows();
    const grip = rows[0].querySelector('.md-grip') as HTMLElement;
    fireEvent.pointerDown(grip, { clientY: 20 });
    await new Promise((r) => setTimeout(r, 400));
    expect(rows[0].className).toContain('dragging');

    // Drag onto the third slot (just below the third row's midpoint)...
    layoutRows();
    fireEvent.pointerMove(grip, { clientY: 101 });
    const moved = layoutRows();
    expect(moved.map((r) => r.dataset.topic)).toEqual([
      topics[1].id,
      topics[2].id,
      topics[0].id,
      ...topics.slice(3).map((t) => t.id),
    ]);
    // ...and release: the order is stored and the plan re-packs in it.
    fireEvent.pointerUp(grip, { clientY: 101 });
    expect(state().planConfig.topicOrder[subject.id]).toEqual([
      topics[1].id,
      topics[2].id,
      topics[0].id,
      ...topics.slice(3).map((t) => t.id),
    ]);
    const firstDay = state().schedule.find((d) => d.subjectId === subject.id);
    const topicOf = new Map(subject.topics.flatMap((t) => t.lectures.map((l) => [l.id, t.id])));
    expect(firstDay).toBeTruthy();
    expect(topicOf.get(firstDay!.lectureIds[0])).toBe(topics[1].id); // new first chapter
    // and the drag did not expand the chapter
    expect(document.querySelectorAll('.md-lectures')).toHaveLength(0);

    // A fresh tap on a chapter still opens its lectures (no reorder).
    // After the reorder, the first row is the original topics[1].
    const rows2 = layoutRows();
    const target = rows2[0];
    fireEvent.pointerDown(target, { clientY: 20 });
    fireEvent.pointerUp(target, { clientY: 20 });
    fireEvent.click(target);
    expect(state().planConfig.topicOrder[subject.id]).toEqual([
      topics[1].id,
      topics[2].id,
      topics[0].id,
      ...topics.slice(3).map((t) => t.id),
    ]);
    await screen.findByRole('checkbox', {
      name: `Mark lecture "${topics[1].lectures[0].name}" as already done`,
    });
  });
});

describe('revision screen', () => {
  it('lists due items and advances them when reviewed', async () => {
    await boot();
    await importDemo();
    const state = useAppStore.getState();
    const id = state.schedule[0].lectureIds[0];
    state.setFlags(id, { lectureWatched: true, notesDone: true, questionsDone: true });
    // Due 3 days after "today", so force it due now.
    const queued = useAppStore.getState().revision[id];
    useAppStore.setState({
      revision: { [id]: { ...queued, nextDueDate: state.planConfig.startDate } },
    });

    fireEvent.click(await screen.findByRole('button', { name: /Revise/ }));
    expect(await screen.findByText('Due for revision')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reviewed' }));
    await waitFor(() => expect(useAppStore.getState().revision[id].intervalStage).toBe(1));
    expect(useAppStore.getState().revision[id].history).toEqual([
      { date: expect.any(String), result: 'done' },
    ]);
  });
});

describe('side menu and data screen', () => {
  it('hamburger opens the left menu with Plan and Data; the bottom row is Today, Backlog, Revision, Timeline', async () => {
    await boot();
    await importDemo();
    await screen.findByText(/Today we.re studying/);

    const menu = () => document.querySelector('.side-menu') as HTMLElement;
    expect(menu().className).not.toContain('open');
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await waitFor(() => expect(menu().className).toContain('open'));
    expect(screen.getByRole('button', { name: /Plan/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Data/ })).toBeTruthy();

    // The bottom row has exactly the five tabs, in order.
    const bottom = [...document.querySelectorAll('.bottom-nav button')].map(
      (b) => b.textContent,
    );
    expect(bottom).toHaveLength(5);
    expect(bottom[0]).toContain('Today');
    expect(bottom[1]).toContain('Backlog');
    expect(bottom[2]).toContain('Revision');
    expect(bottom[3]).toContain('Timeline');
    expect(bottom[4]).toContain('Mark done');

    // Picking Data navigates and closes the menu.
    fireEvent.click(screen.getByRole('button', { name: /Data/ }));
    expect(await screen.findByText('Backup')).toBeTruthy();
    await waitFor(() => expect(menu().className).not.toContain('open'));
  });

  it('exports a backup file from the Data screen', async () => {
    await boot();
    await importDemo();
    await openMenu();
    fireEvent.click(screen.getByRole('button', { name: /Data/ }));
    await screen.findByText('Backup');

    // Web fallback: capture the Blob handed to URL.createObjectURL (absent
    // in jsdom, so stub it) and the anchor click that triggers the download.
    let captured: Blob | null = null;
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = (b: Blob | MediaSource) => {
      captured = b as Blob;
      return 'blob:test';
    };
    URL.revokeObjectURL = () => {};
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    fireEvent.click(screen.getByRole('button', { name: 'Export data (JSON)' }));
    await waitFor(() => expect(captured).toBeTruthy());

    const text = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => rej(r.error);
      r.readAsText(captured as Blob);
    });
    const payload = JSON.parse(text);
    expect(payload.appVersion).toBeTruthy();
    expect(payload.curriculum).toHaveLength(8);
    expect(payload.planConfig.dailyHours).toBe(3);

    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
    clickSpy.mockRestore();
  });

  it('restoring a hand-edited backup normalizes the plan config', async () => {
    await boot();
    const subject = makeSubjects([hours('Survivor Subject', 1, 1, 1, 1)])[0];
    // Missing fields, negative hours, empty study days, impossible date and a
    // junk leave date - exactly what a hand-edited export file can carry.
    useAppStore.getState().applyBackup({
      curriculum: [subject],
      planConfig: {
        subjectOrder: [subject.id],
        dailyHours: -5,
        studyDays: [],
        playbackSpeed: 0,
        startDate: '2026-13-40',
        leaveDates: ['2026-09-20', 'not-a-date'],
      } as unknown as PlanConfig,
      progress: {},
      revision: {},
    });

    const cfg = useAppStore.getState().planConfig;
    expect(isISODate(cfg.startDate)).toBe(true);
    expect(cfg.dailyHours).toBe(3);
    expect(cfg.playbackSpeed).toBe(1.5);
    expect(cfg.studyDays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(cfg.leaveDates).toEqual(['2026-09-20']);
    // The repaired plan actually generates days.
    expect(useAppStore.getState().schedule.length).toBeGreaterThan(0);
    expect(useAppStore.getState().route).toBe('today');
  });

  it('on native, writes the backup to Documents and opens the share sheet', async () => {
    await boot();
    await importDemo();
    await openMenu();
    fireEvent.click(screen.getByRole('button', { name: /Data/ }));
    await screen.findByText('Backup');

    let webDownloads = 0;
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = () => {
      webDownloads++;
      return 'blob:test';
    };
    capMock.native = true;
    capMock.writeFile.mockResolvedValueOnce({
      uri: 'file:///storage/emulated/0/Documents/norcet-tracker-backup.json',
    });
    capMock.share.mockResolvedValueOnce({});
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Export data (JSON)' }));
      expect(await screen.findByText(/Backup saved to Documents/)).toBeTruthy();
      expect(capMock.writeFile).toHaveBeenCalledTimes(1);
      expect(capMock.share).toHaveBeenCalledTimes(1);
      // The anchor download (broken in the WebView) must not be attempted.
      expect(webDownloads).toBe(0);
      // The native Filesystem API demands BASE64 `data`. A regression here is
      // the "The supplied data is not valid base64 content" export failure:
      // the payload must encode to real base64 that round-trips to the JSON.
      const writeArgs = capMock.writeFile.mock.calls[0]![0] as { path: string; data: string };
      expect(writeArgs.data).toMatch(/^[A-Za-z0-9+/=]+$/);
      const roundTrip = JSON.parse(Buffer.from(writeArgs.data, 'base64').toString('utf8'));
      expect(roundTrip.appVersion).toBeTruthy();
      expect(roundTrip.curriculum).toHaveLength(8);
    } finally {
      capMock.native = false;
      capMock.writeFile.mockReset();
      capMock.share.mockReset();
      URL.createObjectURL = origCreate;
    }
  });

  it('on native failure, shows a real error instead of silently doing nothing', async () => {
    await boot();
    await importDemo();
    await openMenu();
    fireEvent.click(screen.getByRole('button', { name: /Data/ }));
    await screen.findByText('Backup');

    let webDownloads = 0;
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = () => {
      webDownloads++;
      return 'blob:test';
    };
    capMock.native = true;
    capMock.writeFile.mockRejectedValueOnce(new Error('storage full'));
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Export data (JSON)' }));
      // A VISIBLE error - the silent fall-through to the (broken) web
      // download used to look exactly like "the button does nothing".
      expect(await screen.findByText(/Export failed/)).toBeTruthy();
      expect(webDownloads).toBe(0);
    } finally {
      capMock.native = false;
      capMock.writeFile.mockReset();
      URL.createObjectURL = origCreate;
    }
  });
});

describe('greeting and theme', () => {
  it('always shows the name line, time-of-day line, daily line and quote (no tap)', async () => {
    await boot();
    await importDemo();
    await screen.findByText(/Today we.re studying/);

    const greeting = document.querySelector('.greeting') as HTMLElement;
    const line = document.querySelector('.greeting-line');
    expect(line).toBeTruthy();
    expect(line!.textContent).toMatch(/Hiiii|Hey|Hello|Namaste|Hi/);
    expect(line!.textContent).not.toMatch(/\bSep\b/); // no date in the greeting
    // Default name = the saloni family (nickname roulette, stable per day).
    expect(line!.textContent).toMatch(/Saloni|Shalu|Meloni/);
    // Time-of-day line is present.
    const timeLine = greeting.querySelector('.greeting-time')!.textContent ?? '';
    expect(
      ['Good Morning', 'Good Afternoon', 'Good Evening', 'Good Night', 'Still up?'].some((t) =>
        timeLine.startsWith(t),
      ),
    ).toBe(true);
    // Daily line + quote are always visible, nothing collapsed.
    expect((document.querySelector('.greeting-line2')!.textContent ?? '').length).toBeGreaterThan(5);
    const quote = document.querySelector('.greeting-quote')!.textContent ?? '';
    expect(quote.length).toBeGreaterThan(10);
    // Tapping the card does nothing (no expand state anymore).
    fireEvent.click(greeting);
    expect(greeting.className).not.toContain('expanded');
  });

  it('shows the day\'s quote from the quote bank (same quote for the whole day)', async () => {
    await boot();
    await importDemo();
    await screen.findByText(/Today we.re studying/);

    // Daily quote: seeded off the day-of-year, so the exact quote is known.
    const expected = STUDY_QUOTES[dayOfYear(new Date()) % STUDY_QUOTES.length];
    const quote = document.querySelector('.greeting-quote')!.textContent ?? '';
    expect(quote).toContain(expected.text);
    expect(quote.startsWith('“')).toBe(true);

    // The quote is always visible (no tap-to-expand anymore).
    expect(document.querySelector('.greeting')!.className).not.toContain('expanded');
  });

  it('toggles between dark and light mode', async () => {
    await boot();
    await importDemo();
    await screen.findByText(/Today we.re studying/);

    fireEvent.click(screen.getByRole('button', { name: /Switch to light mode/ }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
    fireEvent.click(screen.getByRole('button', { name: /Switch to dark mode/ }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
  });

  it('lets the user set the name shown in the greeting', async () => {
    await boot();
    await importDemo();
    await screen.findByText(/Today we.re studying/);

    // The default name is saloni, so the pencil edits it.
    fireEvent.click(screen.getByRole('button', { name: 'Edit your name' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Shown in the daily greeting/), {
      target: { value: 'Priya' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(useAppStore.getState().planConfig.studentName).toBe('Priya'),
    );
    // A non-saloni name is shown as-is (no nickname roulette).
    expect(document.querySelector('.greeting-line')!.textContent).toContain('Priya');
  });
});

describe('personal touches: streak, victory message, milestone', () => {
  it('watching a lecture starts the streak; finishing the day shows a victory message', async () => {
    await boot();
    await importDemo();
    const state = () => useAppStore.getState();
    const today = todayISO();
    if (weekdayOf(today) === 0) return; // Sunday: nothing to watch today
    const day = state().scheduleByDate.get(today);
    if (!day || day.type !== 'study' || day.lectureIds.length === 0) return;

    // Nothing watched yet: no streak chip.
    expect(document.querySelector('.greeting-streak')).toBeNull();

    // Watch one lecture today: the streak chip appears.
    state().setFlag(day.lectureIds[0], 'lectureWatched', true);
    expect(await screen.findByText('1-day streak')).toBeTruthy();

    // Finish the rest of today: the done box shows a victory message.
    for (const id of day.lectureIds.slice(1)) state().setFlag(id, 'lectureWatched', true);
    const name = nameForDay(state().planConfig.studentName, today);
    await waitFor(() => {
      const el = document.querySelector('.ok-box');
      expect(el).toBeTruthy();
      expect(
        DONE_MESSAGES.some((m) => m.replace('{name}', name) === el!.textContent?.trim()),
      ).toBe(true);
    });
  });

  it('a 5-day streak fires the congratulations box once, then never again', async () => {
    await boot();
    await importDemo();
    const state = () => useAppStore.getState();
    const today = todayISO();
    if (weekdayOf(today) === 0) return; // Sunday: the day cannot be "done"
    const day = state().scheduleByDate.get(today);
    if (!day || day.type !== 'study' || day.lectureIds.length === 0) return;

    // Move the plan start back so there are EXACTLY four past study days
    // (study days are Mon-Sat; Sundays are off and must not count).
    let start = addDays(today, -1);
    let found = 0;
    while (found < 4) {
      if (weekdayOf(start) !== 0) found++;
      start = addDays(start, -1);
    }
    start = addDays(start, 1);
    state().updatePlan({ startDate: start });

    // One watched lecture on each of those past study days.
    const progress: ProgressStore = { ...state().progress };
    for (const d of state().schedule) {
      if (d.type === 'study' && d.date < today && d.lectureIds.length > 0) {
        const id = d.lectureIds[0];
        progress[id] = {
          lectureId: id,
          lectureWatched: true,
          notesDone: false,
          questionsDone: false,
          completedDate: d.date,
        };
      }
    }
    useAppStore.setState({ progress });

    // Finish today: the streak reaches 5 and the milestone box appears.
    const todayDay = state().scheduleByDate.get(today)!;
    for (const id of todayDay.lectureIds) state().setFlag(id, 'lectureWatched', true);
    expect(
      await screen.findByText(/5 (days of study|din ki streak|days strong|days of showing up)/),
    ).toBeTruthy();
    expect(screen.getByText(/Pratham/)).toBeTruthy();
    expect(state().streakMilestonesSeen).toContain(5);
    expect(document.querySelector('.greeting-streak')).toBeTruthy();

    // Dismiss it, go away and come back: never shown again for this milestone.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.querySelector('.modal')).toBeNull();
    const bottomBtn = (label: string) =>
      [...document.querySelectorAll<HTMLElement>('.bottom-nav button')].find(
        (b) => b.textContent?.includes(label),
      ) as HTMLElement;
    fireEvent.click(bottomBtn('Backlog'));
    fireEvent.click(bottomBtn('Today'));
    await screen.findByText(/Today we.re studying/);
    expect(document.querySelector('.modal')).toBeNull();
    // the done box is still there, quietly
    expect(document.querySelector('.ok-box')).toBeTruthy();
  });
});

describe('plan lock', () => {
  it('locks the plan after setting a password, and unlocks with it', async () => {
    await boot();
    await importDemo();
    await openMenu();
    fireEvent.click(screen.getByRole('button', { name: /Plan/ }));
    await screen.findByText('Live preview');

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nurse123' } });
    fireEvent.change(screen.getByLabelText('Repeat it'), { target: { value: 'nurse123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set lock' }));
    await waitFor(() => expect(useAppStore.getState().planLockHash).toBeTruthy());

    // Lock now -> the lock screen replaces the plan screen.
    fireEvent.click(screen.getByRole('button', { name: 'Lock now' }));
    expect(await screen.findByText('The plan is locked')).toBeTruthy();
    expect(screen.queryByText('Live preview')).toBeNull();

    // Wrong password shows an error and keeps the gate up.
    fireEvent.change(screen.getByLabelText('Plan password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(screen.getByText(/Wrong password/)).toBeTruthy());
    expect(useAppStore.getState().planUnlocked).toBe(false);

    // Right password opens the plan again.
    fireEvent.change(screen.getByLabelText('Plan password'), { target: { value: 'nurse123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(screen.getByText('Live preview')).toBeTruthy());
    expect(useAppStore.getState().planUnlocked).toBe(true);
  });
});

describe('backlog tab', () => {
  async function openBacklog() {
    const state = () => useAppStore.getState();
    // Backdate the plan by two days so at least one study day is in the past
    // (works no matter which weekday "today" falls on).
    state().updatePlan({ startDate: addDays(state().planConfig.startDate, -2) });
    await waitFor(() =>
      expect(state().schedule.some((d) => d.type === 'study' && d.date < todayISO())).toBe(true),
    );
    const nav = document.querySelector('.bottom-nav') as HTMLElement;
    fireEvent.click(within(nav).getByRole('button', { name: /Backlog/ }));
    await screen.findByText('Missed lectures');
  }

  it('lists missed lectures and can park one on the off day', async () => {
    await boot();
    await importDemo();
    await openBacklog();
    const state = () => useAppStore.getState();

    const offDay = nextOffDayOnOrAfter(todayISO(), state().planConfig);
    expect(state().planConfig.offDayLectures).toEqual({});
    fireEvent.click(screen.getAllByRole('button', { name: /off day/ })[0]);

    await waitFor(() =>
      expect(Object.keys(state().planConfig.offDayLectures)).toHaveLength(1),
    );
    const [movedId, movedDate] = Object.entries(state().planConfig.offDayLectures)[0];
    expect(movedDate).toBe(offDay);
    // The off day now shows up as a study day carrying that lecture.
    const day = state().scheduleByDate.get(movedDate);
    expect(day?.type).toBe('study');
    expect(day?.lectureIds).toContain(movedId);
    // The moved lecture is no longer sitting on a past day (the repacker may
    // pull a different lecture into the gap - that is expected).
    const pastIds = state()
      .schedule.filter((d) => d.type === 'study' && d.date < todayISO())
      .flatMap((d) => d.lectureIds);
    expect(pastIds).not.toContain(movedId);
  });

  it('shifts the schedule from today and opens the next off day for overflow', async () => {
    await boot();
    await importDemo();
    await openBacklog();
    const state = () => useAppStore.getState();

    fireEvent.click(screen.getAllByRole('button', { name: 'Shift schedule' })[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Shift schedule' }));

    await waitFor(() => expect(state().planConfig.startDate).toBe(todayISO()));
    expect(state().planConfig.backlogAnchor).toBe(todayISO());
    // The first off day after today (usually the following Sunday) is now an
    // open study day in the re-spread plan.
    const offDay = nextOffDayOnOrAfter(addDays(todayISO(), 1), state().planConfig);
    expect(offDay).toBeTruthy();
    const day = state().scheduleByDate.get(offDay!);
    expect(day?.type).toBe('study');
  });

  it('can return a lecture from its off day to the plan', async () => {
    await boot();
    await importDemo();
    await openBacklog();
    const state = () => useAppStore.getState();

    fireEvent.click(screen.getAllByRole('button', { name: /off day/ })[0]);
    await waitFor(() =>
      expect(Object.keys(state().planConfig.offDayLectures)).toHaveLength(1),
    );
    expect(await screen.findByText('Waiting on off days')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Return to plan' }));
    await waitFor(() => expect(state().planConfig.offDayLectures).toEqual({}));
  });
});
