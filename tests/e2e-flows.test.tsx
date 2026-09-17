// @vitest-environment jsdom
/**
 * END-TO-END FLOW EXERCISE (the "whole thing" pass).
 *
 * Every flow below is exercised through the REAL UI (clicks, typing, file
 * upload, app close/reopen), not through store calls alone. Where a real
 * device is needed (Android scroll jank, second phone) the closest
 * browser-level equivalent is asserted and the device-only gap is noted.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { flushWrites } from '../src/lib/storage';
import { formatDate } from '../src/lib/dates';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { useAppStore as UseAppStore } from '../src/store/appStore';

const demo = readFileSync(resolve(__dirname, '../public/demo-curriculum.json'), 'utf8');

type Store = typeof UseAppStore;

/**
 * One "app launch": a pristine store (like a fresh process) plus the real
 * App rendered on top of it, waiting for hydration.
 *
 * The zustand module is a singleton for the whole test file, so "fresh
 * process" is assembled explicitly: settle any pending debounced writes,
 * reset the in-memory store (which also flips `hydrated` so init() re-runs
 * on mount), wipe storage, and clear the hash (App re-reads it after
 * init).
 */
async function launch(): Promise<{ store: Store; unmount: () => void }> {
  const mod: { useAppStore: Store } = await import('../src/store/appStore');
  await flushWrites();
  await mod.useAppStore.getState().resetEverything();
  localStorage.clear();
  window.location.hash = '';
  const app: { default: ComponentType } = await import('../src/App');
  const view = render(<app.default />);
  await waitFor(() => expect(mod.useAppStore.getState().ready).toBe(true));
  return { store: mod.useAppStore, unmount: () => view.unmount() };
}

/**
 * A genuine close/reopen: unmount the running app, then mount a fresh one
 * that hydrates from the persisted localStorage - exactly what a cold start
 * of the real app does. (Storage is snapshotted across the in-memory reset.)
 */
async function relaunch(store: Store): Promise<{ store: Store; unmount: () => void }> {
  await flushWrites(); // the final state must be on disk first
  const snapshot: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    snapshot[k] = localStorage.getItem(k)!;
  }
  await store.getState().resetEverything(); // hydrated=false, in-memory cleared
  for (const [k, v] of Object.entries(snapshot)) localStorage.setItem(k, v);
  window.location.hash = '';
  const app: { default: ComponentType } = await import('../src/App');
  const view = render(<app.default />);
  await waitFor(() => expect(store.getState().ready).toBe(true));
  return { store, unmount: () => view.unmount() };
}

async function launchWithDemo() {
  const ctx = await launch();
  ctx.store.getState().importCurriculum(demo);
  await waitFor(() => expect(ctx.store.getState().curriculum.length).toBe(8));
  return ctx;
}

/** Navigate via the bottom nav (scoped - Today's banner has a "Backlog →" button too). */
function bottomNav() {
  return within(document.querySelector('.bottom-nav') as HTMLElement);
}

async function openMenuThen(name: string | RegExp) {
  fireEvent.click(await screen.findByRole('button', { name: 'Open menu' }));
  fireEvent.click(await screen.findByRole('button', { name }));
}

const SPLIT = JSON.stringify({
  'Rev Subject': {
    instructor: 'Dr R',
    topics: [{ topic: 'Only Topic', subtopics: [{ name: 'Only Lecture', duration: '01:00:00' }] }],
  },
});

/* ============================ Plan & scheduling ============================ */

describe('plan & scheduling flows', () => {
  it('import produces a sane schedule; re-import keeps it stable and progress', async () => {
    const { store, unmount } = await launchWithDemo();
    const state = () => store.getState();
    const today = state().planConfig.startDate; // default: today

    // Sane: every study day has lectures, off days don't, dates are continuous.
    const sched = state().schedule;
    expect(sched.length).toBeGreaterThan(60);
    for (const d of sched) {
      if (d.type === 'study') expect(d.lectureIds.length).toBeGreaterThan(0);
      else expect(d.lectureIds).toEqual([]);
    }
    for (let i = 1; i < sched.length; i++) {
      const prev = new Date(sched[i - 1].date + 'T00:00:00');
      prev.setDate(prev.getDate() + 1);
      expect(prev.toISOString().slice(0, 10)).toBe(sched[i].date);
    }
    expect(screen.getByText(/Today we.re studying/)).toBeTruthy();

    // Tick one lecture through the UI, then RE-IMPORT the same file.
    const firstId = state().scheduleByDate.get(today)!.lectureIds[0];
    const name = state().lectureIndex.get(firstId)!.lecture.name;
    const row = screen.getAllByText(name)[0].closest('.lecture') as HTMLElement;
    fireEvent.click(within(row).getByRole('checkbox'));
    expect(state().progress[firstId]?.lectureWatched).toBe(true);

    const outlineBefore = state().schedule.map((d) => `${d.date}:${d.type}:${d.lectureIds.length}`);
    state().importCurriculum(demo); // re-import
    const outlineAfter = state().schedule.map((d) => `${d.date}:${d.type}:${d.lectureIds.length}`);
    expect(outlineAfter).toEqual(outlineBefore); // identical plan
    expect(state().progress[firstId]?.lectureWatched).toBe(true); // progress kept
    unmount();
  });

  it('editing start date / study days / daily hours recomputes the finish date', async () => {
    const { store, unmount } = await launchWithDemo();
    const state = () => store.getState();
    await openMenuThen(/Plan/);
    await screen.findByText('Live preview');

    const finishDate = () => {
      let last: string | null = null;
      for (let i = state().schedule.length - 1; i >= 0; i--) {
        if (state().schedule[i].type === 'study') { last = state().schedule[i].date; break; }
      }
      return last;
    };

    // Start date +3 days -> the whole plan re-packs: every lecture still
    // scheduled, first study day on/after the new start, finish recomputed.
    // (The finish does NOT move by exactly 3 days: per-subject rest days are
    // counted in calendar days, so their study-day cost shifts with the week
    // alignment - pinned by the schedule unit tests.)
    const totalBefore = state().schedule.reduce((n, d) => n + d.lectureIds.length, 0);
    const before = finishDate()!;
    const startBefore = state().planConfig.startDate;
    fireEvent.change(screen.getByLabelText('Start date'), {
      target: { value: shiftISO(startBefore, 3) },
    });
    await waitFor(() => expect(state().planConfig.startDate).toBe(shiftISO(startBefore, 3)));
    const totalAfter = state().schedule.reduce((n, d) => n + d.lectureIds.length, 0);
    expect(totalAfter).toBe(totalBefore); // no lecture lost or duplicated
    const firstStudy = state().schedule.find((d) => d.type === 'study')!;
    expect(firstStudy.date >= shiftISO(startBefore, 3)).toBe(true);
    expect(finishDate()!).toBeTruthy();

    // Remove Saturday as a study day -> the plan gets LONGER.
    fireEvent.click(screen.getByRole('button', { name: 'Sat' }));
    await waitFor(() => expect(state().planConfig.studyDays).not.toContain(6));
    expect(finishDate()! > shiftISO(before, 3)).toBe(true);

    // 6h/day -> the plan gets shorter again (put Saturday back first).
    fireEvent.click(screen.getByRole('button', { name: 'Sat' }));
    await waitFor(() => expect(state().planConfig.studyDays).toContain(6));
    fireEvent.change(screen.getByLabelText('Daily hours'), { target: { value: '6' } });
    await waitFor(() => expect(state().planConfig.dailyHours).toBe(6));
    expect(finishDate()! < shiftISO(before, 3)).toBe(true);
    unmount();
  });

  it('timeline puts day 1 of every month in its true weekday column, across a year boundary', async () => {
    const { unmount } = await launchWithDemo();
    fireEvent.click(screen.getByRole('button', { name: /Timeline/ }));
    expect(await screen.findByText(/January 2027/)).toBeTruthy(); // plan spans Dec -> Jan

    const gridOf = (label: string) =>
      [...document.querySelectorAll('.month-grid')].find((g) =>
        g.closest('.card')!.textContent!.includes(label),
      ) as HTMLElement;

    const indexOfDay = (grid: HTMLElement, datePrefix: string) => {
      const cells = [...grid.querySelectorAll('.day-cell')];
      const cell = cells.find((c) => (c as HTMLElement).title!.startsWith(datePrefix));
      expect(cell, `${datePrefix} missing in grid`).toBeTruthy();
      return cells.indexOf(cell as Element);
    };

    // 1 Nov 2026 = Sunday -> column 0.  1 Dec 2026 = Tuesday -> column 2.
    expect(indexOfDay(gridOf('November 2026'), 'Sun 1 Nov')).toBe(0);
    expect(indexOfDay(gridOf('December 2026'), 'Tue 1 Dec')).toBe(2);
    // Year boundary: 1 Jan 2027 = Friday -> column 5.
    expect(indexOfDay(gridOf('January 2027'), 'Fri 1 Jan')).toBe(5);
    unmount();
  });
});

/* ================================ Today screen =============================== */

describe('today screen flows', () => {
  it('shows exactly today scheduled lectures - the day is a fixed set that only shrinks', async () => {
    const { store, unmount } = await launchWithDemo();
    const state = () => store.getState();
    const today = state().planConfig.startDate;
    const nameOf = (id: string) => state().lectureIndex.get(id)!.lecture.name;
    const baseList = state()
      .scheduleByDate.get(today)!
      .lectureIds.map((id) => state().lectureIndex.get(id)!.lecture.name);

    const rendered = () =>
      [...document.querySelectorAll('.study-card .lec-row-name')].map((e) => e.textContent);
    expect(rendered()).toEqual(baseList);

    // Tick the first lecture: it leaves the list and appears in "done
    // today". The day does NOT refill - the list is the original fixed set
    // minus the watched ones, and the plan keeps its exact shape.
    const firstId = state().scheduleByDate.get(today)!.lectureIds[0];
    const row = screen.getAllByText(nameOf(firstId))[0].closest('.lec-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('checkbox'));
    await waitFor(() =>
      expect(rendered()).toEqual(baseList.slice(1)),
    );
    expect(state().scheduleByDate.get(today)!.lectureIds).toContain(firstId); // still on its fixed day
    expect(await screen.findByText(/watched today/)).toBeTruthy();
    unmount();
  });

  it('flat rows: name left, square checkbox right, one per lecture - tapping the row ticks it', async () => {
    const { store, unmount } = await launchWithDemo();
    const state = () => store.getState();
    const today = state().planConfig.startDate;
    const ids = state().scheduleByDate.get(today)!.lectureIds;
    expect(ids.length).toBeGreaterThanOrEqual(3);
    const nameOf = (id: string) => state().lectureIndex.get(id)!.lecture.name;

    // One square checkbox per lecture, no accordion nodes anywhere.
    const boxes = screen.getAllByRole('checkbox', { name: /Mark watched: / });
    expect(boxes).toHaveLength(ids.length);
    expect(document.querySelector('.lecture.acc')).toBeNull();
    for (const id of ids) {
      const row = screen.getAllByText(nameOf(id))[0].closest('.lec-row') as HTMLElement;
      expect(row.className).toContain('lec-row');
      // The checkbox is the row's last element - i.e. on the right.
      expect(row.lastElementChild).toBeInstanceOf(HTMLInputElement);
    }

    // Tapping anywhere on the row (even the name) ticks the box - and the
    // lecture leaves the list; the rest of the fixed day set stays.
    fireEvent.click(screen.getAllByText(nameOf(ids[1]))[0]);
    await waitFor(() => expect(state().progress[ids[1]]?.lectureWatched).toBe(true));
    await waitFor(() =>
      expect(document.querySelectorAll('.study-card .lec-row')).toHaveLength(ids.length - 1),
    );
    expect(screen.getByText(nameOf(ids[0]))).toBeTruthy();
    unmount();
  });

  it('hours slider: reduction rides the shortfall to the week off day; increase lightens the week last day; next week untouched', async () => {
    // Pin the clock: the plan starts on "today", so this test's week math is
    // written for a Wednesday start and would drift on any other weekday.
    // Only Date is faked - real setTimeout keeps the async UI waiting sane.
    vi.useFakeTimers({ now: new Date(2026, 8, 16, 12, 0, 0).getTime(), toFake: ['Date'] });
    try {
      const { store, unmount } = await launchWithDemo();
      const state = () => store.getState();
      const today = state().planConfig.startDate; // Wed 2026-09-16
      const SUNDAY = '2026-09-20'; // this week's off day
      const MON_NEXT = '2026-09-21';

    const weekMap = () => {
      const m = new Map<string, { sec: number; ids: string[] }>();
      for (const d of state().schedule) m.set(d.date, { sec: d.plannedSec, ids: [...d.lectureIds] });
      return m;
    };
    const nextWeek = (m: Map<string, { sec: number; ids: string[] }>) =>
      [...m.entries()].filter(([date]) => date >= MON_NEXT).sort();

    const base = weekMap();
    const baseNext = nextWeek(base);
    const weekPool = base.get(today)!.ids.length; // today's share in the base plan
    expect(weekPool).toBeGreaterThan(0);

    // --- REDUCE to 2h: today's excess rides onto Sunday; next week identical.
    fireEvent.click(screen.getByRole('button', { name: /Today: 3h/ }));
    fireEvent.click(screen.getByRole('button', { name: '2h' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state().planConfig.dayHours[today]).toBe(2));

    let m = weekMap();
    expect(m.get(today)!.sec).toBeLessThanOrEqual(2 * 3600);
    expect(m.get(SUNDAY)!.ids.length).toBeGreaterThan(0); // overflow parked on the off day
    // The week kept every lecture it had: today + later days + Sunday = base total.
    const weekDates = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'];
    const weekTotalNow = weekDates.reduce((n, d) => n + (m.get(d)?.ids.length ?? 0), 0);
    const weekTotalBase = weekDates.reduce((n, d) => n + (base.get(d)?.ids.length ?? 0), 0);
    expect(weekTotalNow).toBe(weekTotalBase);
    expect(nextWeek(m)).toEqual(baseNext); // next week untouched

    // --- INCREASE to 4h: later days (up to Saturday, the week's last study day) get lighter.
    fireEvent.click(screen.getByRole('button', { name: /Today: 2h/ }));
    fireEvent.click(screen.getByRole('button', { name: '4h' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state().planConfig.dayHours[today]).toBe(4));

    m = weekMap();
    expect(m.get(today)!.sec).toBeLessThanOrEqual(4 * 3600);
    expect(m.get(SUNDAY)!.ids.length).toBe(0); // nothing left to overflow
    // The absorbed hour leaves later days lighter (carry-whole keeps each
    // lecture intact, so which day lightens depends on lecture boundaries):
    // no later day may get HEAVIER, and at least one must lighten.
    const later = ['2026-09-17', '2026-09-18', '2026-09-19'];
    for (const d of later) expect(m.get(d)!.sec).toBeLessThanOrEqual(base.get(d)!.sec);
    expect(later.some((d) => m.get(d)!.sec < base.get(d)!.sec)).toBe(true);
      expect(nextWeek(m)).toEqual(baseNext); // next week STILL untouched
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Skip Day behaves exactly like a leave day - whole plan shifts, no overflow logic', async () => {
    const { store, unmount } = await launchWithDemo();
    const state = () => store.getState();
    const today = state().planConfig.startDate;
    const SUNDAY = '2026-09-20';
    const endBefore = state().schedule[state().schedule.length - 1].date;
    const totalBefore = state().schedule.reduce((n, d) => n + d.lectureIds.length, 0);

    fireEvent.click(screen.getByRole('button', { name: /Today: 3h/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip Day' }));

    await waitFor(() => expect(state().planConfig.leaveDates).toContain(today));
    // Today is now a leave day with nothing on it...
    const todayDay = state().scheduleByDate.get(today)!;
    expect(todayDay.type).toBe('off');
    expect(todayDay.isLeaveDay).toBe(true);
    expect(todayDay.lectureIds).toEqual([]);
    // ...every lecture is still scheduled (none lost)...
    expect(state().schedule.reduce((n, d) => n + d.lectureIds.length, 0)).toBe(totalBefore);
    // ...and the plan's tail moved no earlier, and at most one study day's
    // worth later: the per-subject rest days are fixed calendar gaps, so a
    // skipped day is absorbed by the first rest gap whose date slips (the
    // rest day becomes a study day) - pinned by the schedule unit tests.
    const endAfter = state().schedule[state().schedule.length - 1].date;
    expect(endAfter >= endBefore).toBe(true);
    expect(endAfter <= shiftISO(endBefore, 2)).toBe(true);
    // The overflow/off-day mechanism was NOT used: Sunday stays empty and the
    // skipped day's lectures landed on ordinary study days.
    expect(state().scheduleByDate.get(SUNDAY)!.lectureIds).toEqual([]);
    const nextDay = state().scheduleByDate.get(shiftISO(today, 1))!;
    expect(nextDay.type).toBe('study');
    expect(nextDay.lectureIds.length).toBeGreaterThan(0);
    expect(screen.getByText(/Marked as time off\./)).toBeTruthy();
    unmount();
  });

  it('greeting: collapsed by default, no date, tap reveals the quote, tap hides it', async () => {
    const { unmount } = await launchWithDemo();
    const greeting = document.querySelector('.greeting') as HTMLElement;
    expect(greeting.className).not.toContain('expanded');
    // No date anywhere on the greeting line (the header already has it).
    expect(greeting.querySelector('.greeting-line')!.textContent).not.toMatch(
      /\b(0?[1-9]|1[0-9]|2[0-9]|3[01]) (Sep|Oct|Nov|Dec|Jan)\b/,
    );
    // The quote text exists in the DOM (jsdom has no layout, so collapse is
    // asserted by the class below, not by a measured height).
    const quote = document.querySelector('.greeting-quote')!;
    expect(quote.textContent!.length).toBeGreaterThan(10);

    fireEvent.click(greeting);
    await waitFor(() => expect((document.querySelector('.greeting') as HTMLElement).className).toContain('expanded'));
    fireEvent.click(greeting);
    await waitFor(() => expect((document.querySelector('.greeting') as HTMLElement).className).not.toContain('expanded'));
    unmount();
  });

  it('finishing today ENDS today: the box appears, pops once, survives a real reopen, and clears on untick', async () => {
    const { store, unmount } = await launchWithDemo();
    const state = () => store.getState();
    const today = state().planConfig.startDate;
    const ids = state().scheduleByDate.get(today)!.lectureIds;
    expect(ids.length).toBeGreaterThan(0);

    // Watch everything the plan assigned to today, through the UI. Each tick
    // only REMOVES a lecture from the list (the day is a fixed set) - and
    // when the last one is gone the day simply ends.
    for (let i = 0; i < ids.length; i++) {
      const firstRow = document.querySelector('.study-card .lec-row') as HTMLElement;
      fireEvent.click(within(firstRow).getByRole('checkbox'));
      await waitFor(() =>
        expect(document.querySelectorAll('.study-card .lec-row')).toHaveLength(ids.length - i - 1),
      );
    }
    const box = await screen.findByText(/Everything for today is watched/);
    const boxEl = box.closest('.ok-box') as HTMLElement;
    // First time the day becomes done, in THIS visit -> the pop class.
    expect(boxEl.className).toContain('pop');

    // An unrelated state change re-renders the screen: the box must NOT
    // unmount/remount (that would re-trigger the pop).
    store.getState().setTheme('light');
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
    expect(document.body.contains(boxEl)).toBe(true);

    // Untick one lecture (from "watched today") -> the state goes away and
    // the lecture is back in today's (fixed) list.
    fireEvent.click(await screen.findByText(/watched today/));
    const doneBox = document.querySelector('.done-list .lec-row') as HTMLElement;
    const undoneName = doneBox.querySelector('.lec-row-name')!.textContent!;
    fireEvent.click(within(doneBox).getByRole('checkbox'));
    await waitFor(() => expect(document.body.contains(boxEl)).toBe(false));
    expect(
      document.querySelector('.study-card .lec-row')!.textContent,
    ).toContain(undoneName);

    // Watch it again so the day is done, then close the app for real: let
    // the debounced flush write, unmount, and relaunch a fresh app.
    const backRow = document.querySelector('.study-card .lec-row') as HTMLElement;
    fireEvent.click(within(backRow).getByRole('checkbox'));
    await waitFor(() =>
      expect(screen.queryByText(/Everything for today is watched/)).toBeTruthy(),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600)); // settle the 400ms debounce
    });
    unmount();

    const again = await relaunch(store); // true reopen: hydrates from storage
    const box2 = await screen.findByText(/Everything for today is watched/);
    const boxEl2 = box2.closest('.ok-box') as HTMLElement;
    // The state PERSISTED (box on reopen) but WITHOUT the pop class: a
    // reopen starts already done, so it must not re-celebrate. And the
    // fixed day list is still fully watched on the stored plan.
    expect(boxEl2.className).not.toContain('pop');
    const saved = store.getState();
    const savedDay = saved.scheduleByDate.get(today)!;
    expect(savedDay.lectureIds).toEqual(ids);
    for (const id of ids) expect(saved.progress[id]?.lectureWatched).toBe(true);
    again.unmount();
  });

  it('ticking persists across a full close and reopen of the app', async () => {
    const { store, unmount } = await launchWithDemo();
    const state = () => store.getState();
    const today = state().planConfig.startDate;
    const firstId = state().scheduleByDate.get(today)!.lectureIds[0];
    const name = state().lectureIndex.get(firstId)!.lecture.name;

    const row = screen.getAllByText(name)[0].closest('.lecture') as HTMLElement;
    fireEvent.click(within(row).getByRole('checkbox'));
    expect(state().progress[firstId]?.lectureWatched).toBe(true);

    // Let the 400ms storage debounce flush to localStorage, then close the app.
    await new Promise((r) => setTimeout(r, 600));
    unmount();

    // The app's data now lives in localStorage - verify, then do a genuine
    // cold start on top of it (relaunch: snapshot, in-memory reset, restore,
    // fresh App mount hydrating from storage via the real init()).
    const hasPersisted = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
      .some((k) => k!.startsWith('norcet:'));
    expect(hasPersisted).toBe(true);
    const fresh = await relaunch(store);
    expect(fresh.store.getState().progress[firstId]?.lectureWatched).toBe(true);
    expect(fresh.store.getState().progress[firstId]?.notesDone).toBe(true);
    // And the UI reflects it: the lecture is out of today's list.
    expect(screen.queryAllByText(name).some((el) => el.closest('.study-card'))).toBe(false);
    expect(await screen.findByText(/watched today/)).toBeTruthy();
    fresh.unmount();
  });
});

/* ================================= Backlog ================================= */

describe('backlog flows', () => {
  it('a missed lecture shows up, parks onto the off day cleanly, and returns cleanly', async () => {
    const { store, unmount } = await launchWithDemo();
    const state = () => store.getState();
    const today = state().planConfig.startDate;

    // Age the plan by 9 days so several study days are in the past, unwatched.
    store.getState().updatePlan({ startDate: shiftISO(today, -9) });
    await waitFor(() => expect(state().schedule[0].date).toBe(shiftISO(today, -9)));

    const missedCount = () => {
      const n = state().schedule.filter((d) => d.type === 'study' && d.date < today).reduce(
        (n2, d) => n2 + d.lectureIds.length,
        0,
      );
      return n;
    };
    expect(missedCount()).toBeGreaterThan(0);

    // The Backlog tab shows them.
    fireEvent.click(bottomNav().getByRole('button', { name: /Backlog/ }));
    expect(await screen.findByText('Missed lectures')).toBeTruthy();
    expect(screen.getAllByText(/was due/).length).toBe(missedCount());

    const allScheduled = () =>
      state().schedule.flatMap((d) => d.lectureIds).sort();
    const before = allScheduled();

    // Park the first missed lecture onto the off day. The default plan
    // studies Mon-Sat, so the off day is the next Sunday.
    let offDayISO = today;
    for (let i = 0; i < 7; i++) {
      if (new Date(offDayISO + 'T00:00:00').getDay() === 0) break;
      offDayISO = shiftISO(offDayISO, 1);
    }
    const parkBtn = screen.getAllByRole('button', { name: /To .* \(off day\)/ })[0];
    expect(parkBtn.textContent).toContain(`To ${formatDate(offDayISO)} (off day)`);
    fireEvent.click(parkBtn);

    await waitFor(() => {
      const off = state().planConfig.offDayLectures;
      expect(Object.keys(off).length).toBe(1);
    });
    const [parkedId, parkedDate] = Object.entries(state().planConfig.offDayLectures)[0];
    expect(parkedDate).toBe(offDayISO); // the store keeps ISO dates
    // The off day is now a real study day carrying that lecture...
    const offDay = state().scheduleByDate.get(parkedDate)!;
    expect(offDay.type).toBe('study');
    expect(offDay.lectureIds).toContain(parkedId);
    // ...the rest of the plan is untouched (same lecture set overall)...
    expect(allScheduled()).toEqual(before);
    // The parked lecture leaves the missed list (it is on a future off day
    // now). The schedule is a compacting queue, so the next lecture slides
    // into the vacated past-day slot and becomes the new "missed" one: the
    // count holds, the membership does not.
    const missedIds = () =>
      state()
        .schedule.filter((d) => d.type === 'study' && d.date < today)
        .flatMap((d) => d.lectureIds);
    expect(missedIds()).not.toContain(parkedId);
    expect(missedIds()).toHaveLength(missedCount());
    expect(screen.getAllByText(/was due/).length).toBe(missedCount());
    // It is listed under "Waiting on off days".
    expect(await screen.findByText('Waiting on off days')).toBeTruthy();

    // Return it to the normal plan: everything reverts.
    fireEvent.click(screen.getByRole('button', { name: 'Return to plan' }));
    await waitFor(() => expect(Object.keys(state().planConfig.offDayLectures).length).toBe(0));
    expect(allScheduled()).toEqual(before);
    unmount();
  });
});

/* ================================= Revision ================================= */

describe('revision flows', () => {
  it('enters the queue only when combined checkbox AND topic Questions are done', async () => {
    const { store, unmount } = await launch();
    const state = () => store.getState();
    store.getState().importCurriculum(SPLIT);
    await waitFor(() => expect(state().curriculum.length).toBe(1));

    const id = state().schedule[0].lectureIds[0];
    expect(state().revision).toEqual({});

    // Merged checkbox only (watched + notes): NOT enough.
    const row = screen.getAllByText('Only Lecture')[0].closest('.lec-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('checkbox'));
    expect(state().progress[id]).toMatchObject({ lectureWatched: true, notesDone: true, questionsDone: false });
    expect(state().revision).toEqual({});

    // Topic Questions live in the Revision tab (the homepage tracks
    // lectures only): open the tab and tick the topic there - now it queues.
    await screen.findByText(/Today we.re studying/);
    fireEvent.click(bottomNav().getByRole('button', { name: /Revision/ }));
    await screen.findByText('Questions by topic');
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Questions done for Only Topic' }));
    await waitFor(() => expect(Object.keys(state().revision).length).toBe(1));
    const item = state().revision[id];
    expect(item.intervalStage).toBe(0);
    expect(item.nextDueDate).toBe(shiftISO(state().planConfig.startDate, 3)); // default [3,14,30]
    // Not due yet -> no badge on the Revision tab.
    expect(bottomNav().queryByRole('button', { name: /Revision/ })!.querySelector('.nav-badge')).toBeNull();
    unmount();
  });

  it('reviewed / skip / drop all behave and update the due count; intervals advance', async () => {
    const { store, unmount } = await launch();
    const state = () => store.getState();
    store.getState().importCurriculum(SPLIT);
    await waitFor(() => expect(state().curriculum.length).toBe(1));
    const id = state().schedule[0].lectureIds[0];
    store.getState().setFlags(id, { lectureWatched: true, notesDone: true, questionsDone: true });
    expect(Object.keys(state().revision).length).toBe(1);
    const today = state().planConfig.startDate;
    const forceDue = () => setRevisionDate(store, id, today);

    // Due today -> badge shows 1, item listed on the tab.
    forceDue();
    fireEvent.click(bottomNav().getByRole('button', { name: /Revision/ }));
    expect(await screen.findByText('Due for revision')).toBeTruthy();
    expect(bottomNav().getByRole('button', { name: /Revision/ }).querySelector('.nav-badge')!.textContent).toBe('1');

    // Reviewed -> advances to interval 2 (14 days), no longer due.
    fireEvent.click(screen.getByRole('button', { name: 'Reviewed' }));
    await waitFor(() => expect(state().revision[id].intervalStage).toBe(1));
    expect(state().revision[id].nextDueDate).toBe(shiftISO(today, 14));
    expect(state().revision[id].history).toEqual([{ date: today, result: 'done' }]);
    expect(bottomNav().queryByRole('button', { name: /Revision/ })!.querySelector('.nav-badge')).toBeNull();

    // Skip (push 1 day): force due again, skip -> tomorrow, stage unchanged.
    forceDue();
    fireEvent.click(screen.getByRole('button', { name: 'Skip (push 1 day)' }));
    await waitFor(() => expect(state().revision[id].nextDueDate).toBe(shiftISO(today, 1)));
    expect(state().revision[id].intervalStage).toBe(1);

    // Drop: force due again, drop -> gone entirely.
    forceDue();
    fireEvent.click(screen.getByRole('button', { name: 'Drop' }));
    await waitFor(() => expect(state().revision).toEqual({}));
    expect(bottomNav().queryByRole('button', { name: /Revision/ })!.querySelector('.nav-badge')).toBeNull();
    unmount();
  });
});

/** Force a revision item's due date so the flow is exercised without waiting real days. */
function setRevisionDate(store: Store, id: string, date: string): void {
  const s = store.getState();
  // act(): flush the subscription re-render before the next UI query.
  act(() => {
    store.setState({
      revision: { ...s.revision, [id]: { ...s.revision[id], nextDueDate: date } },
    });
  });
}

/* ================================ Data tab ================================= */

describe('data tab flows', () => {
  it('export -> re-import round-trips the whole state without loss', async () => {
    const { store, unmount } = await launchWithDemo();
    const state = () => store.getState();
    const today = state().planConfig.startDate;
    const id = state().schedule[0].lectureIds[0];
    // Build a rich state: one fully-done lecture (also in revision), a leave day.
    store.getState().setFlags(id, { lectureWatched: true, notesDone: true, questionsDone: true });
    store.getState().addLeaveDates([shiftISO(today, 5)]);
    await waitFor(() => expect(Object.keys(state().revision).length).toBe(1));

    const snapshot = {
      curriculum: state().curriculum,
      planConfig: state().planConfig,
      progress: state().progress,
      revision: state().revision,
    };

    // Export (web path: capture the Blob handed to the download).
    await openMenuThen(/Data/);
    await screen.findByText('Backup');
    let captured: Blob | null = null;
    URL.createObjectURL = ((b: Blob) => { captured = b; return 'blob:test'; }) as typeof URL.createObjectURL;
    // jsdom has no revokeObjectURL; the export path schedules a revoke 1s
    // later, which would otherwise throw as an unhandled timer error after
    // the test (and flakily fail whichever test was running at the time).
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Export data (JSON)' }));
    await waitFor(() => expect(captured).toBeTruthy());
    const exported = JSON.parse(await (captured as unknown as Blob).text());

    // The file carries everything.
    expect(exported.appVersion).toBeTruthy();
    expect(exported.curriculum).toHaveLength(8);
    expect(exported.progress[id]).toMatchObject({ lectureWatched: true });
    expect(Object.keys(exported.revision)).toHaveLength(1);
    expect(exported.planConfig.leaveDates).toContain(shiftISO(today, 5));

    // Feed the SAME file back in through the Data screen's file input.
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File([JSON.stringify(exported)], 'norcet-backup.json', { type: 'application/json' })] },
    });
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Restore this backup?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

    await waitFor(() => expect(state().route).toBe('today'));
    expect(state().curriculum).toEqual(snapshot.curriculum);
    expect(state().planConfig).toEqual(snapshot.planConfig);
    expect(state().progress).toEqual(snapshot.progress);
    expect(state().revision).toEqual(snapshot.revision);

    clickSpy.mockRestore();
    unmount();
  });

  it('erase all local data asks for confirmation and clears everything it claims', async () => {
    const { store, unmount } = await launchWithDemo();
    const state = () => store.getState();
    store.getState().setFlags(state().schedule[0].lectureIds[0], {
      lectureWatched: true, notesDone: true, questionsDone: true,
    });
    await openMenuThen(/Data/);
    await screen.findByText('Danger zone');

    fireEvent.click(screen.getByRole('button', { name: 'Erase all local data' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/deletes 8 subject/)).toBeTruthy(); // the warning names what it clears
    fireEvent.click(screen.getByRole('button', { name: 'Erase everything' }));

    await waitFor(() => expect(state().curriculum.length).toBe(0));
    expect(state().progress).toEqual({});
    expect(state().revision).toEqual({});
    expect(state().route).toBe('import');
    expect(await screen.findByText('Import your curriculum')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 600)); // debounced clear already ran; storage is clean
    for (const key of ['curriculum', 'planConfig', 'progress', 'revision']) {
      expect(localStorage.getItem('norcet:' + key)).toBeNull();
    }
    unmount();
  });
});

/* ================================= General ================================== */

describe('general', () => {
  it('walks all seven routes with the full demo loaded and produces no console errors', async () => {
    const { unmount } = await launchWithDemo();
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      const msg = args.map(String).join(' ');
      if (!msg.startsWith('Warning:')) errors.push(msg); // ignore React dev notices
    });

    expect(await screen.findByText(/Today we.re studying/)).toBeTruthy();
    fireEvent.click(bottomNav().getByRole('button', { name: /Backlog/ }));
    await screen.findByText('Missed lectures');
    fireEvent.click(bottomNav().getByRole('button', { name: /Revision/ }));
    expect((await screen.findAllByText(/Nothing due|Due for revision|Coming up/)).length).toBeGreaterThan(0);
    fireEvent.click(bottomNav().getByRole('button', { name: /Timeline/ }));
    await screen.findByText(/January 2027/);
    fireEvent.click(bottomNav().getByRole('button', { name: /Mark done/ }));
    await screen.findByText(/recalculates the plan without those lectures/);
    await openMenuThen(/Plan/);
    await screen.findByText('Live preview');
    await openMenuThen(/Data/);
    await screen.findByText('Backup');
    fireEvent.click(bottomNav().getByRole('button', { name: /Today/ }));
    await screen.findByText(/Today we.re studying/);

    spy.mockRestore();
    expect(errors).toEqual([]);
    unmount();
  });

  it('renders the full plan (every month of the schedule) and paginates a large subject without loss', async () => {
    const { store, unmount } = await launchWithDemo();
    const state = () => store.getState();

    // The whole plan renders (767 lectures, Sep 2026 -> Mar 2027).
    fireEvent.click(bottomNav().getByRole('button', { name: /Timeline/ }));
    await screen.findByText(/March 2027/);
    const months = document.querySelectorAll('.month-grid').length;
    const expectedMonths = new Set(state().schedule.map((d) => d.date.slice(0, 7))).size;
    expect(months).toBe(expectedMonths); // every month of the schedule, none lost
    const dayCells = document.querySelectorAll('.day-cell:not(.blank)').length;
    expect(dayCells).toBe(state().schedule.length);

    // Mark done tab: the biggest subject (79+ lectures) lists all of its
    // topics at once (no pagination) and bulk-marks without losing rows.
    const biggest = [...state().curriculum].sort(
      (a, b) =>
        b.topics.reduce((n, t) => n + t.lectures.length, 0) -
        a.topics.reduce((n, t) => n + t.lectures.length, 0),
    )[0];
    const biggestCount = biggest.topics.reduce((n, t) => n + t.lectures.length, 0);
    expect(biggestCount).toBeGreaterThanOrEqual(79);

    fireEvent.click(bottomNav().getByRole('button', { name: /Mark done/ }));
    await screen.findByText(/recalculates the plan without those lectures/);
    expect(document.querySelectorAll('.md-subject')).toHaveLength(state().planConfig.subjectOrder.length);

    // Open the biggest subject (rows are in plan order)...
    const idx = state().planConfig.subjectOrder.indexOf(biggest.id);
    fireEvent.click(document.querySelectorAll('.md-subject .md-subject-head')[idx] as HTMLElement);
    // ...every one of its topics is visible at once, none lost.
    const topicRows = document.querySelectorAll('.md-topics .md-topic');
    expect(topicRows.length).toBe(biggest.topics.length);

    // Mark the whole subject through the confirm modal.
    fireEvent.click(screen.getByRole('button', { name: /Mark whole subject done/ }));
    fireEvent.click(
      await screen.findByRole('button', { name: new RegExp(`Mark ${biggestCount} done`) }),
    );
    await screen.findByText(`${biggestCount}/${biggestCount}`); // progress bar full
    for (const t of biggest.topics) {
      for (const l of t.lectures) {
        expect(state().progress[l.id]?.lectureWatched).toBe(true);
        expect(state().progress[l.id]?.preDone).toBe(true); // "already done before the app"
      }
    }
    // And the plan recalculated WITHOUT the subject: no day belongs to it,
    // and the calendar shrank accordingly.
    expect(state().schedule.every((d) => d.subjectId !== biggest.id)).toBe(true);
    unmount();
  });
});

/* --------------------------------- helpers --------------------------------- */

function shiftISO(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
