import test from "node:test";
import assert from "node:assert/strict";

import {
  createEmptyTimeline,
  findNavigationTarget,
  recordManualVisit,
} from "../background/history_state.js";

test("manual visits append and move cursor to the end", () => {
  const timeline = createEmptyTimeline();

  recordManualVisit(timeline, { tabId: 1, windowId: 1 });
  recordManualVisit(timeline, { tabId: 2, windowId: 1 });

  assert.deepEqual(timeline, {
    entries: [
      { tabId: 1, windowId: 1 },
      { tabId: 2, windowId: 1 },
    ],
    cursor: 1,
  });
});

test("consecutive duplicate manual visits are ignored", () => {
  const timeline = createEmptyTimeline();

  recordManualVisit(timeline, { tabId: 1, windowId: 1 });
  const changed = recordManualVisit(timeline, { tabId: 1, windowId: 1 });

  assert.equal(changed, false);
  assert.deepEqual(timeline, {
    entries: [{ tabId: 1, windowId: 1 }],
    cursor: 0,
  });
});

test("manual visit after moving back truncates forward history", () => {
  const timeline = createEmptyTimeline();

  recordManualVisit(timeline, { tabId: 1, windowId: 1 });
  recordManualVisit(timeline, { tabId: 2, windowId: 1 });
  recordManualVisit(timeline, { tabId: 3, windowId: 1 });
  timeline.cursor = 1;

  recordManualVisit(timeline, { tabId: 4, windowId: 1 });

  assert.deepEqual(timeline, {
    entries: [
      { tabId: 1, windowId: 1 },
      { tabId: 2, windowId: 1 },
      { tabId: 4, windowId: 1 },
    ],
    cursor: 2,
  });
});

test("back and forward resolve targets without appending new entries", () => {
  const timeline = createEmptyTimeline();
  const liveTabIds = new Set([1, 2, 3]);

  recordManualVisit(timeline, { tabId: 1, windowId: 1 });
  recordManualVisit(timeline, { tabId: 2, windowId: 1 });
  recordManualVisit(timeline, { tabId: 3, windowId: 1 });

  const backTarget = findNavigationTarget(timeline, "back", liveTabIds);
  timeline.cursor = backTarget.targetIndex;
  const forwardTarget = findNavigationTarget(timeline, "forward", liveTabIds);

  assert.deepEqual(backTarget.targetEntry, { tabId: 2, windowId: 1 });
  assert.deepEqual(forwardTarget.targetEntry, { tabId: 3, windowId: 1 });
  assert.equal(timeline.entries.length, 3);
});

test("invalid entries are skipped while scanning navigation history", () => {
  const timeline = {
    entries: [
      { tabId: 1, windowId: 1 },
      { tabId: 2, windowId: 1 },
      { tabId: 3, windowId: 1 },
    ],
    cursor: 2,
  };

  const result = findNavigationTarget(timeline, "back", new Set([1]));

  assert.deepEqual(result.targetEntry, { tabId: 1, windowId: 1 });
  assert.deepEqual(timeline, {
    entries: [
      { tabId: 1, windowId: 1 },
      { tabId: 3, windowId: 1 },
    ],
    cursor: 1,
  });
});
