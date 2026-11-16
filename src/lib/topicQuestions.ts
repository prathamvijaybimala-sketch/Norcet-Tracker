/**
 * Topic-level "Questions" state, shared by the UI and the store so both sides
 * agree on exactly which lectures a topic's Questions checkbox covers.
 *
 * The bug this guards against: a topic's lectures often span more than one
 * scheduled day (the packer carries whole lectures, so any topic that does not
 * fit a day's budget splits across days). The checkbox must be judged over the
 * topic's ACTIVE lectures - not just the lectures visible on the current
 * render - or it either (a) shows "done" while later days' lectures have not
 * had their questions done, or (b) never becomes tickable.
 */

import type { ProgressStore, Topic } from '../types';

/**
 * The lectures of a topic the student is actually working through: the ones
 * currently scheduled, or already watched. Lectures that are unwatched AND
 * not scheduled (excluded subjects, or a tail dropped off the plan) do not
 * block the topic's Questions state.
 */
export function topicActiveLectureIds(
  topic: Topic,
  scheduleByLecture: Map<string, string>,
  progress: ProgressStore,
): string[] {
  return topic.lectures
    .map((l) => l.id)
    .filter((id) => scheduleByLecture.has(id) || progress[id]?.lectureWatched === true);
}

/**
 * The scheduled day on which the topic's last active lecture sits - i.e. the
 * day the topic "finishes" and its Questions become meaningful to confirm.
 * Null when the topic has no scheduled lectures left (fully watched).
 */
export function topicLastScheduledDate(
  ids: string[],
  scheduleByLecture: Map<string, string>,
): string | null {
  let last: string | null = null;
  for (const id of ids) {
    const d = scheduleByLecture.get(id);
    if (d && (last === null || d > last)) last = d;
  }
  return last;
}

/**
 * True when `contextDate` (the day being rendered) is the topic's last
 * scheduled day or later - or when the topic has nothing scheduled left.
 * Earlier partial days hide the checkbox: there is nothing meaningful to
 * confirm yet, and the tick on the last day covers the whole topic at once.
 */
export function topicQuestionsUnlocked(
  ids: string[],
  scheduleByLecture: Map<string, string>,
  contextDate: string,
): boolean {
  const last = topicLastScheduledDate(ids, scheduleByLecture);
  return last === null || contextDate >= last;
}
