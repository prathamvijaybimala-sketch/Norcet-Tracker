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
import { addDays, todayISO } from '../src/lib/dates';
import { nextOffDayOnOrAfter } from '../src/lib/schedule';

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
    expect(screen.queryByText("Today's lectures")).toBeNull();
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
    expect(await screen.findByText("Today's lectures")).toBeTruthy();

    const state = () => useAppStore.getState();
    const todayIds = [...(state().scheduleByDate.get(state().planConfig.startDate)?.lectureIds ?? [])];
    expect(todayIds.length).toBeGreaterThan(0);

    const before = state().schedule.length;
    const lecture = state().lectureIndex.get(todayIds[0])!;
    expect(screen.getByText(lecture.lecture.name)).toBeTruthy();

    // Tick "Lecture" on the first lecture row (two boxes per lecture: Lecture + Notes).
    const rows = screen.getAllByText(lecture.lecture.name);
    const row = rows[0].closest('.lecture') as HTMLElement;
    const boxes = within(row).getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    fireEvent.click(boxes[0]);

    await waitFor(() =>
      expect(useAppStore.getState().progress[todayIds[0]]?.lectureWatched).toBe(true),
    );
    // The schedule regenerated: the lecture is gone from today's planned list…
    expect(state().scheduleByDate.get(state().planConfig.startDate)?.lectureIds).not.toContain(
      todayIds[0],
    );
    // …and shows up under "Done today" instead of vanishing.
    expect(await screen.findByText('Done today')).toBeTruthy();
    expect(state().schedule.length).toBeLessThanOrEqual(before);
  });

  it('keeps lecture boxes independent, with Questions at topic level', async () => {
    await boot();
    await importDemo();
    await screen.findByText("Today's lectures");

    const state = () => useAppStore.getState();
    const firstId = state().schedule[0].lectureIds[0];
    const row = screen.getAllByText(state().lectureIndex.get(firstId)!.lecture.name)[0].closest(
      '.lecture',
    ) as HTMLElement;
    const boxes = within(row).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes).toHaveLength(2); // Lecture + Notes only, per lecture
    fireEvent.click(boxes[1]); // notes only
    const p = state().progress[firstId];
    expect(p.lectureWatched).toBe(false);
    expect(p.notesDone).toBe(true);
    expect(p.questionsDone).toBe(false);

    // Questions is a single checkbox on the topic header and ticks the whole
    // topic at once.
    const topic = state().lectureIndex.get(firstId)!.topic;
    fireEvent.click(screen.getByRole('checkbox', { name: `Questions done for ${topic.name}` }));
    for (const l of topic.lectures) {
      expect(state().progress[l.id]?.questionsDone).toBe(true);
    }
    // Still scheduled (only "watched" removes a lecture from the plan).
    expect(state().scheduleByLecture.get(firstId)).toBe(state().schedule[0].date);
  });

  it('queues a lecture for revision only when all three boxes are ticked', async () => {
    await boot();
    await importDemo();
    await screen.findByText("Today's lectures");

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
  it('shows the greeting box with a time-of-day line and a quote', async () => {
    await boot();
    await importDemo();
    await screen.findByText("Today's lectures");

    const line = document.querySelector('.greeting-line');
    expect(line).toBeTruthy();
    expect(line!.textContent).toMatch(/Hiiii|Hey|Hello|Namaste|Hi/);
    const sub = document.querySelector('.greeting-sub')!.textContent ?? '';
    expect(sub).toMatch(/Good (morning|afternoon|evening|night)/);
    expect(document.querySelector('.greeting-quote')).toBeTruthy();
  });

  it('toggles between dark and light mode', async () => {
    await boot();
    await importDemo();
    await screen.findByText("Today's lectures");

    fireEvent.click(screen.getByRole('button', { name: /Switch to light mode/ }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
    fireEvent.click(screen.getByRole('button', { name: /Switch to dark mode/ }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
  });

  it('lets the user set the name shown in the greeting', async () => {
    await boot();
    await importDemo();
    await screen.findByText("Today's lectures");

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
