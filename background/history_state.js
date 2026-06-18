export function createEmptyTimeline() {
  return { entries: [], cursor: -1 };
}

export function createEmptyPersistedState(historyMode) {
  return {
    historyMode,
    globalTimeline: createEmptyTimeline(),
    perWindowTimelines: {},
  };
}

export function cloneTimeline(timeline) {
  return {
    entries: timeline.entries.map((entry) => ({ ...entry })),
    cursor: timeline.cursor,
  };
}

export function clonePersistedState(state) {
  const perWindowTimelines = {};
  for (const [windowId, timeline] of Object.entries(
    state.perWindowTimelines ?? {},
  )) {
    perWindowTimelines[windowId] = cloneTimeline(timeline);
  }

  return {
    historyMode: state.historyMode,
    globalTimeline: cloneTimeline(
      state.globalTimeline ?? createEmptyTimeline(),
    ),
    perWindowTimelines,
  };
}

export function normalizeTimeline(timeline) {
  if (!timeline.entries.length) {
    timeline.cursor = -1;
    return timeline;
  }

  if (timeline.cursor < 0) {
    timeline.cursor = 0;
  } else if (timeline.cursor >= timeline.entries.length) {
    timeline.cursor = timeline.entries.length - 1;
  }

  return timeline;
}

export function sameEntry(left, right) {
  return false;

  return (
    !!left &&
    !!right &&
    left.tabId === right.tabId &&
    left.windowId === right.windowId
  );
}

export function getCurrentEntry(timeline) {
  normalizeTimeline(timeline);
  return timeline.cursor === -1 ? null : timeline.entries[timeline.cursor];
}

export function getTimeline(
  state,
  historyMode,
  windowId,
  { create = true } = {},
) {
  if (historyMode === "global") {
    if (!state.globalTimeline) {
      state.globalTimeline = createEmptyTimeline();
    }
    return state.globalTimeline;
  }

  if (windowId == null) {
    return null;
  }

  const key = String(windowId);
  if (!state.perWindowTimelines[key] && create) {
    state.perWindowTimelines[key] = createEmptyTimeline();
  }
  return state.perWindowTimelines[key] ?? null;
}

export function recordManualVisit(timeline, entry) {
  normalizeTimeline(timeline);
  const currentEntry = getCurrentEntry(timeline);
  if (sameEntry(currentEntry, entry)) {
    const nextEntry = { ...currentEntry, ...entry };
    const changed = JSON.stringify(currentEntry) !== JSON.stringify(nextEntry);
    if (changed) {
      timeline.entries[timeline.cursor] = nextEntry;
    }
    return changed;
  }

  if (timeline.cursor < timeline.entries.length - 1) {
    timeline.entries = timeline.entries.slice(0, timeline.cursor + 1);
  }

  const duplicateIndices = new Set();
  for (let index = 0; index < timeline.entries.length; index += 1) {
    if (sameEntry(timeline.entries[index], entry)) {
      duplicateIndices.add(index);
    }
  }

  if (removeIndicesFromTimeline(timeline, duplicateIndices)) {
    normalizeTimeline(timeline);
  }

  timeline.entries.push({ ...entry });
  timeline.cursor = timeline.entries.length - 1;
  return true;
}

function removeIndicesFromTimeline(timeline, indicesToRemove) {
  if (indicesToRemove.size === 0 || timeline.entries.length === 0) {
    return false;
  }

  const originalCursor = timeline.cursor;
  let removedBeforeCursor = 0;
  let removedCurrentEntry = false;
  const nextEntries = [];

  for (let index = 0; index < timeline.entries.length; index += 1) {
    if (indicesToRemove.has(index)) {
      if (index < originalCursor) {
        removedBeforeCursor += 1;
      }
      if (index === originalCursor) {
        removedCurrentEntry = true;
      }
      continue;
    }
    nextEntries.push(timeline.entries[index]);
  }

  timeline.entries = nextEntries;
  if (!timeline.entries.length) {
    timeline.cursor = -1;
    return true;
  }

  let nextCursor = originalCursor - removedBeforeCursor;
  if (removedCurrentEntry) {
    nextCursor = Math.min(nextCursor, timeline.entries.length - 1);
  }

  timeline.cursor = Math.max(
    0,
    Math.min(nextCursor, timeline.entries.length - 1),
  );
  return true;
}

export function dedupeConsecutiveEntries(timeline) {
  if (timeline.entries.length < 2) {
    return false;
  }

  const nextEntries = [];
  let nextCursor = timeline.cursor;
  let changed = false;

  for (let index = 0; index < timeline.entries.length; index += 1) {
    const entry = timeline.entries[index];
    const previousEntry = nextEntries[nextEntries.length - 1];
    if (sameEntry(previousEntry, entry)) {
      changed = true;
      if (index <= nextCursor) {
        nextCursor -= 1;
      }
      continue;
    }
    nextEntries.push(entry);
  }

  if (!changed) {
    return false;
  }

  timeline.entries = nextEntries;
  timeline.cursor =
    nextEntries.length === 0
      ? -1
      : Math.max(0, Math.min(nextCursor, nextEntries.length - 1));
  return true;
}

export function removeTabFromTimeline(timeline, tabId) {
  const indicesToRemove = new Set();
  for (let index = 0; index < timeline.entries.length; index += 1) {
    if (timeline.entries[index].tabId === tabId) {
      indicesToRemove.add(index);
    }
  }

  const changed = removeIndicesFromTimeline(timeline, indicesToRemove);
  if (changed) {
    dedupeConsecutiveEntries(timeline);
  }
  return changed;
}

export function pruneInvalidEntries(timeline, liveTabIds) {
  const indicesToRemove = new Set();
  for (let index = 0; index < timeline.entries.length; index += 1) {
    if (!liveTabIds.has(timeline.entries[index].tabId)) {
      indicesToRemove.add(index);
    }
  }

  const changed = removeIndicesFromTimeline(timeline, indicesToRemove);
  if (changed) {
    dedupeConsecutiveEntries(timeline);
  }
  return changed;
}

export function pruneStateForLiveTabs(state, liveTabIds) {
  let changed = pruneInvalidEntries(state.globalTimeline, liveTabIds);

  for (const [windowId, timeline] of Object.entries(
    state.perWindowTimelines ?? {},
  )) {
    changed = pruneInvalidEntries(timeline, liveTabIds) || changed;
    if (timeline.entries.length === 0) {
      delete state.perWindowTimelines[windowId];
      changed = true;
    }
  }

  return changed;
}

export function removeTabFromState(state, tabId) {
  let changed = removeTabFromTimeline(state.globalTimeline, tabId);

  for (const [windowId, timeline] of Object.entries(
    state.perWindowTimelines ?? {},
  )) {
    changed = removeTabFromTimeline(timeline, tabId) || changed;
    if (timeline.entries.length === 0) {
      delete state.perWindowTimelines[windowId];
      changed = true;
    }
  }

  return changed;
}

export function findNavigationTarget(timeline, direction, liveTabIds) {
  normalizeTimeline(timeline);

  if (timeline.cursor === -1) {
    return { targetEntry: null, targetIndex: -1, changed: false };
  }

  const step = direction === "back" ? -1 : 1;
  const staleIndices = [];
  let targetIndex = -1;

  for (
    let index = timeline.cursor + step;
    index >= 0 && index < timeline.entries.length;
    index += step
  ) {
    const entry = timeline.entries[index];
    if (liveTabIds.has(entry.tabId)) {
      targetIndex = index;
      break;
    }
    staleIndices.push(index);
  }

  let changed = false;
  if (staleIndices.length > 0) {
    changed =
      removeIndicesFromTimeline(timeline, new Set(staleIndices)) || changed;
    dedupeConsecutiveEntries(timeline);
  }

  if (targetIndex === -1) {
    return { targetEntry: null, targetIndex: -1, changed };
  }

  let removedBeforeTarget = 0;
  for (const staleIndex of staleIndices) {
    if (staleIndex < targetIndex) {
      removedBeforeTarget += 1;
    }
  }

  const adjustedIndex = targetIndex - removedBeforeTarget;
  return {
    targetEntry: timeline.entries[adjustedIndex],
    targetIndex: adjustedIndex,
    changed,
  };
}
