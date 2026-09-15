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

    // Tick "Watched" on the first lecture row.
    const rows = screen.getAllByText(lecture.lecture.name);
    const row = rows[0].closest('.lecture') as HTMLElement;
    const boxes = within(row).getAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
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

  it('keeps the three checkboxes independent', async () => {
    await boot();
    await importDemo();
    await screen.findByText("Today's lectures");

    const state = () => useAppStore.getState();
    const firstId = state().schedule[0].lectureIds[0];
    const row = screen.getAllByText(state().lectureIndex.get(firstId)!.lecture.name)[0].closest(
      '.lecture',
    ) as HTMLElement;
    const boxes = within(row).getAllByRole('checkbox') as HTMLInputElement[];
    fireEvent.click(boxes[1]); // notes only
    fireEvent.click(boxes[2]); // questions only
    const p = state().progress[firstId];
    expect(p.lectureWatched).toBe(false);
    expect(p.notesDone).toBe(true);
    expect(p.questionsDone).toBe(true);
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
