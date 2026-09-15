/**
 * Accordion focus for a list of lecture rows.
 *
 * At most ONE row is expanded at a time in a list:
 *  - auto: the first row that is NOT fully done (lecture watched + notes) is
 *    expanded - that is the "next up" row;
 *  - tapping a COLLAPSED row makes it the manually expanded row (view only -
 *    the checkboxes are not touched);
 *  - tapping the MANUALLY expanded row collapses it (back to the auto row);
 *  - tapping the AUTO-expanded row is a no-op (finish its boxes to advance);
 *  - when the expanded row goes not-done -> done, focus advances to the next
 *    row automatically - no reload, no scroll jump;
 *  - when the list's contents change (different day / topic), any manual
 *    pick is reset.
 *
 * Deliberately LOCAL state (useState) - not part of the Zustand store.
 */

import { useEffect, useRef, useState } from 'react';

export type Accordion = {
  /** The id of the currently expanded row, or null when the list is empty. */
  expandedId: string | null;
  isExpanded: (id: string) => boolean;
  onToggle: (id: string) => void;
};

export function useAccordion(
  lectureIds: string[],
  isDone: (id: string) => boolean,
): Accordion {
  const [manualId, setManualId] = useState<string | null>(null);

  // Reset the manual pick when the list contents change (different day/topic).
  const idKey = lectureIds.join('|');
  const [prevKey, setPrevKey] = useState(idKey);
  if (idKey !== prevKey) {
    setPrevKey(idKey);
    setManualId(null);
  }

  const autoId = lectureIds.find((id) => !isDone(id)) ?? null;
  const expandedId =
    manualId !== null && lectureIds.includes(manualId) ? manualId : autoId;

  // Auto-advance: if the manually pinned row is completed, unpin it so the
  // auto row (the next not-done lecture) takes over. Runs after every render;
  // it only ever writes once per completion (the map remembers done-ness).
  const prevDone = useRef<Map<string, boolean>>(new Map());
  useEffect(() => {
    const prev = prevDone.current;
    for (const id of lectureIds) if (!prev.has(id)) prev.set(id, isDone(id));
    if (manualId !== null && prev.get(manualId) === false && isDone(manualId)) {
      setManualId(null);
    }
    for (const id of [...prev.keys()]) if (!lectureIds.includes(id)) prev.delete(id);
  });

  const isExpanded = (id: string) => expandedId === id;

  const onToggle = (id: string) => {
    if (expandedId === id) {
      if (manualId === id) setManualId(null); // collapse the manual row -> auto takes over
      // tapping the auto row = no-op
    } else {
      setManualId(id); // expand a collapsed row (view only)
    }
  };

  return { expandedId, isExpanded, onToggle };
}
