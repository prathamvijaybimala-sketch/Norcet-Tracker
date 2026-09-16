// @vitest-environment jsdom
/**
 * UI smoke tests: the screens render, ticking a box updates the schedule
 * immediately, and bulk actions reflow the plan. These run against the real
 * React components (no backend, no IndexedDB - storage falls back to
 * localStorage in jsdom).
 */
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import App from '../src/App';
import { useAppStore } from '../src/store/appStore';
import { addDays, dayOfYear, todayISO } from '../src/lib/dates';
import { nextOffDayOnOrAfter } from '../src/lib/schedule';
import { computePlanStats } from '../src/lib/stats';
import { STUDY_QUOTES } from '../src/lib/quotes';

const demo = readFileSync(resolve(__dirname, '../public/demo-curriculum.json'), 'utf8');

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
});

describe('today screen', () => {
  it('lists today\'s lectures and recomputes when a box is ticked', async () => {
    await boot();
    await importDemo();
    expect(await screen.findByText(/Today we.re studying/)).toBeTruthy();

    const state = () => useAppStore.getState();
    const todayIds = [...(state().scheduleByDate.get(state().planConfig.startDate)?.lectureIds ?? [])];
    expect(todayIds.length).toBeGreaterThan(0);

    const before = state().schedule.length;
    const lecture = state().lectureIndex.get(todayIds[0])!;
    expect(screen.getByText(lecture.lecture.name)).toBeTruthy();

    // Tick the single "Done" box on the first (auto-expanded) lecture row.
    const rows = screen.getAllByText(lecture.lecture.name);
    const row = rows[0].closest('.lecture') as HTMLElement;
    const boxes = within(row).getAllByRole('checkbox');
    expect(boxes).toHaveLength(1); // one box per lecture (watched + notes together)
    fireEvent.click(boxes[0]);

    await waitFor(() =>
      expect(useAppStore.getState().progress[todayIds[0]]?.lectureWatched).toBe(true),
    );
    expect(useAppStore.getState().progress[todayIds[0]]?.notesDone).toBe(true); // set together
    // The schedule regenerated: the lecture is gone from today's planned list…
    expect(state().scheduleByDate.get(state().planConfig.startDate)?.lectureIds).not.toContain(
      todayIds[0],
    );
    // …and shows up in the "Done today" summary instead of vanishing.
    expect(await screen.findByText(/watched today/)).toBeTruthy();
    expect(state().schedule.length).toBeLessThanOrEqual(before);
  });

  it('uses ONE box per lecture (sets watched + notes together), Questions stays per topic', async () => {
    await boot();
    await importDemo();
    await screen.findByText(/Today we.re studying/);

    const state = () => useAppStore.getState();
    const firstId = state().schedule[0].lectureIds[0];
    const nameOf = (id: string) => state().lectureIndex.get(id)!.lecture.name;
    const row = screen.getAllByText(nameOf(firstId))[0].closest('.lecture') as HTMLElement;
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
      .closest('.lecture') as HTMLElement;
    fireEvent.click(within(doneRow).getByRole('checkbox'));
    expect(state().progress[firstId].lectureWatched).toBe(false);
    expect(state().progress[firstId].notesDone).toBe(false);

    // Questions is a single per-topic checkbox (at the end of the topic) and
    // ticks the whole topic at once.
    const topic = state().lectureIndex.get(firstId)!.topic;
    fireEvent.click(screen.getByRole('checkbox', { name: `Questions done for ${topic.name}` }));
    for (const l of topic.lectures) {
      expect(state().progress[l.id]?.questionsDone).toBe(true);
    }
  });

  it('keeps exactly one lecture row expanded at a time (accordion)', async () => {
    await boot();
    await importDemo();
    await screen.findByText(/Today we.re studying/);

    const state = () => useAppStore.getState();
    const dayIds = state().scheduleByDate.get(state().planConfig.startDate)!.lectureIds;
    expect(dayIds.length).toBeGreaterThanOrEqual(2);
    const nameOf = (id: string) => state().lectureIndex.get(id)!.lecture.name;
    const openName = () => document.querySelector('.lecture.acc.open .acc-name')!.textContent;

    // The first not-fully-done lecture is expanded automatically.
    expect(openName()).toBe(nameOf(dayIds[0]));
    expect(document.querySelectorAll('.lecture.acc.open')).toHaveLength(1);

    // Tapping a collapsed row expands it - view only, no flags are created.
    fireEvent.click(screen.getByText(nameOf(dayIds[1])));
    expect(openName()).toBe(nameOf(dayIds[1]));
    expect(document.querySelectorAll('.lecture.acc.open')).toHaveLength(1);
    expect(state().progress[dayIds[1]]).toBeUndefined();

    // Tapping the (manual) expanded row collapses it back to the auto row.
    fireEvent.click(screen.getByText(nameOf(dayIds[1])));
    expect(openName()).toBe(nameOf(dayIds[0]));
    expect(document.querySelectorAll('.lecture.acc.open')).toHaveLength(1);
  });

  it('auto-advances to the next row when the open row is ticked', async () => {
    await boot();
    await importDemo();
    await screen.findByText(/Today we.re studying/);

    const state = () => useAppStore.getState();
    const dayIds = state().scheduleByDate.get(state().planConfig.startDate)!.lectureIds;
    expect(dayIds.length).toBeGreaterThanOrEqual(2);
    const [a, b] = dayIds;
    const nameOf = (id: string) => state().lectureIndex.get(id)!.lecture.name;
    const openName = () => document.querySelector('.lecture.acc.open .acc-name')!.textContent;
    expect(openName()).toBe(nameOf(a));

    // One tap on the single "Done" box: the lecture leaves the schedule and
    // the accordion advances to the next one - no reload, no remount.
    fireEvent.click(
      within(document.querySelector('.lecture.acc.open') as HTMLElement).getByRole('checkbox'),
    );
    await waitFor(() => expect(openName()).toBe(nameOf(b)));
    expect(document.querySelectorAll('.lecture.acc.open')).toHaveLength(1);

    // The finished lecture shows up in the "Done today" summary with its box
    // pre-ticked (watched + notes came together).
    fireEvent.click(await screen.findByText(/watched today/));
    await waitFor(() =>
      expect(document.querySelector('.done-list')!.className).toContain('open'),
    );
    const doneRow = within(document.querySelector('.done-list') as HTMLElement)
      .getByText(nameOf(a))
      .closest('.lecture') as HTMLElement;
    const box = within(doneRow).getByRole('checkbox') as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(state().progress[a]?.lectureWatched).toBe(true);
    expect(state().progress[a]?.notesDone).toBe(true);
    expect(openName()).toBe(nameOf(b));
    expect(document.querySelectorAll('.lecture.acc.open')).toHaveLength(1);
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

  it('uses the same accordion in the day detail modal (one open row)', async () => {
    await boot();
    await importDemo();
    fireEvent.click(await screen.findByRole('button', { name: /Timeline/ }));
    const cells = document.querySelectorAll('.day-cell.has-plan');
    expect(cells.length).toBeGreaterThan(0);
    fireEvent.click(cells[0] as HTMLElement);
    const dialog = (await screen.findByRole('dialog')) as HTMLElement;
    expect(dialog.querySelectorAll('.lecture.acc.open')).toHaveLength(1);
    // The Questions checkbox stays a single per-topic control in the header.
    expect(dialog.querySelectorAll('.topic-block').length).toBeGreaterThan(0);
    expect(
      within(dialog).getAllByRole('checkbox', { name: /Questions done for / }).length,
    ).toBe(dialog.querySelectorAll('.topic-block').length);
  });
});

describe('plan screen', () => {
  it('previews the finish date and reacts to pacing changes', async () => {
    await boot();
    await importDemo();
    fireEvent.click(await screen.findByRole('button', { name: /Plan/ }));
    expect(await screen.findByText('Live preview')).toBeTruthy();
    expect(screen.getByText(/you'll finish/)).toBeTruthy();

    const before = useAppStore.getState().schedule.length;
    fireEvent.change(screen.getByLabelText('Daily hours'), { target: { value: '6' } });
    await waitFor(() => expect(useAppStore.getState().schedule.length).toBeLessThan(before));
  });

  it('supports excluding a subject and reordering', async () => {
    await boot();
    await importDemo();
    fireEvent.click(await screen.findByRole('button', { name: /Plan/ }));
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

  it('bulk-marks a subject done and shrinks the plan', async () => {
    await boot();
    await importDemo();
    fireEvent.click(await screen.findByRole('button', { name: /Plan/ }));
    await screen.findByText('Live preview');
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));

    fireEvent.click(await screen.findByRole('button', { name: /Mark entire subject done/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Mark \d+ done/ }));

    const state = useAppStore.getState();
    const subject = state.curriculum[0];
    const watchedCount = Object.values(state.progress).filter((p) => p.lectureWatched).length;
    expect(watchedCount).toBe(
      subject.topics.reduce((n, t) => n + t.lectures.length, 0),
    );
    expect(state.schedule.some((d) => d.subjectId === subject.id)).toBe(false);
    expect(await screen.findByText(/Updated \d+ lectures/)).toBeTruthy();
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

describe('greeting and theme', () => {
  it('shows only the greeting line by default (no date), tap reveals the quote', async () => {
    await boot();
    await importDemo();
    await screen.findByText(/Today we.re studying/);

    const greeting = document.querySelector('.greeting') as HTMLElement;
    // Collapsed by default: just the greeting line, no date line.
    expect(greeting.className).not.toContain('expanded');
    const line = document.querySelector('.greeting-line');
    expect(line).toBeTruthy();
    expect(line!.textContent).toMatch(/Hiiii|Hey|Hello|Namaste|Hi/);
    expect(line!.textContent).not.toMatch(/\bSep\b/); // no date in the greeting
    expect(document.querySelector('.greeting-sub')).toBeNull();
    expect(document.querySelector('.greeting-quote')).toBeTruthy();

    // Tap reveals the quote; tapping again collapses it.
    fireEvent.click(greeting);
    expect(greeting.className).toContain('expanded');
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

    // Collapsed by default; tap-toggle both ways.
    const card = document.querySelector('.greeting') as HTMLElement;
    expect(card.className).not.toContain('expanded');
    fireEvent.click(card);
    expect(card.className).toContain('expanded');
    fireEvent.click(card);
    expect(card.className).not.toContain('expanded');
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

    fireEvent.click(screen.getByRole('button', { name: 'Set your name' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Shown in the daily greeting/), {
      target: { value: 'Priya' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(useAppStore.getState().planConfig.studentName).toBe('Priya'),
    );
    expect(document.querySelector('.greeting-line')!.textContent).toContain('Priya');
  });
});

describe('plan lock', () => {
  it('locks the plan after setting a password, and unlocks with it', async () => {
    await boot();
    await importDemo();
    fireEvent.click(await screen.findByRole('button', { name: /Plan/ }));
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
    fireEvent.click(await screen.findByRole('button', { name: /Revise/ }));
    await screen.findByText('Due for revision');
    fireEvent.click(screen.getByRole('button', { name: 'Backlog' }));
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
