import test from "node:test";
import assert from "node:assert/strict";

import { HistoryService } from "../background/history_service.js";
import { NavigationGuard } from "../background/navigation_guard.js";
import { createChromeStubs } from "./test_chrome_stubs.js";

function createFakeClock() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(callback, _delay) {
      const id = nextId;
      nextId += 1;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    flush() {
      for (const [id, callback] of [...timers.entries()]) {
        timers.delete(id);
        callback();
      }
    },
  };
}

test("startup events are queued until storage hydration completes", async () => {
  const { chrome } = createChromeStubs([
    {
      id: 10,
      windowId: 1,
      active: true,
      title: "Inbox",
      favIconUrl: "https://mail.test/icon.png",
    },
  ]);
  let resolveGet;
  chrome.storage.session.get = () =>
    new Promise((resolve) => {
      resolveGet = resolve;
    });

  const service = new HistoryService({ chromeApi: chrome });
  const initPromise = service.init();

  await chrome.tabs.onActivated.dispatch({ tabId: 10, windowId: 1 });
  resolveGet({});
  await initPromise;

  assert.deepEqual(service.getStateSnapshot().globalTimeline, {
    entries: [
      {
        tabId: 10,
        windowId: 1,
        title: "Inbox",
        favIconUrl: "https://mail.test/icon.png",
      },
    ],
    cursor: 0,
  });
});

test("window focus records the active tab of the newly focused window", async () => {
  const { chrome } = createChromeStubs([
    {
      id: 1,
      windowId: 1,
      active: true,
      title: "Docs",
      favIconUrl: "https://docs.test/icon.png",
    },
    {
      id: 2,
      windowId: 2,
      active: true,
      title: "Calendar",
      favIconUrl: "https://calendar.test/icon.png",
    },
  ]);

  const service = new HistoryService({ chromeApi: chrome });
  await service.init();
  await chrome.windows.onFocusChanged.dispatch(2);

  assert.deepEqual(service.getStateSnapshot().globalTimeline, {
    entries: [
      {
        tabId: 2,
        windowId: 2,
        title: "Calendar",
        favIconUrl: "https://calendar.test/icon.png",
      },
    ],
    cursor: 0,
  });
});

test("extension-driven back navigation moves the cursor without appending", async () => {
  const { chrome, records, addTab } = createChromeStubs([
    {
      id: 1,
      windowId: 1,
      active: false,
      title: "Search",
      favIconUrl: "https://search.test/icon.png",
    },
    {
      id: 2,
      windowId: 1,
      active: true,
      title: "Mail",
      favIconUrl: "https://mail.test/icon.png",
    },
    {
      id: 3,
      windowId: 1,
      active: false,
      title: "Music",
      favIconUrl: "https://music.test/icon.png",
    },
  ]);

  const service = new HistoryService({
    chromeApi: chrome,
    navigationGuard: new NavigationGuard({ clock: createFakeClock() }),
  });
  await service.init();

  await chrome.tabs.onActivated.dispatch({ tabId: 1, windowId: 1 });
  await chrome.tabs.onActivated.dispatch({ tabId: 2, windowId: 1 });
  await chrome.commands.onCommand.dispatch("goBackInTabHistory");
  await chrome.tabs.onActivated.dispatch({ tabId: 1, windowId: 1 });

  addTab({
    id: 3,
    windowId: 1,
    active: false,
    title: "Music",
    favIconUrl: "https://music.test/icon.png",
  });
  await chrome.tabs.onActivated.dispatch({ tabId: 3, windowId: 1 });

  assert.deepEqual(records.tabUpdates, [
    { tabId: 1, updateProperties: { active: true } },
  ]);
  assert.deepEqual(service.getStateSnapshot().globalTimeline, {
    entries: [
      {
        tabId: 1,
        windowId: 1,
        title: "Search",
        favIconUrl: "https://search.test/icon.png",
      },
      {
        tabId: 3,
        windowId: 1,
        title: "Music",
        favIconUrl: "https://music.test/icon.png",
      },
    ],
    cursor: 1,
  });
});

test("stale tab ids are pruned on load", async () => {
  const { chrome } = createChromeStubs([
    {
      id: 1,
      windowId: 1,
      active: true,
      title: "Active",
      favIconUrl: "https://active.test/icon.png",
    },
  ]);
  chrome.storage.session.store = {
    tabHistoryState: {
      historyMode: "global",
      globalTimeline: {
        entries: [
          {
            tabId: 1,
            windowId: 1,
            title: "Active",
            favIconUrl: "https://active.test/icon.png",
          },
          {
            tabId: 99,
            windowId: 1,
            title: "Stale",
            favIconUrl: "https://stale.test/icon.png",
          },
        ],
        cursor: 1,
      },
      perWindowTimelines: {},
    },
  };

  const service = new HistoryService({ chromeApi: chrome });
  await service.init();

  assert.deepEqual(service.getStateSnapshot().globalTimeline, {
    entries: [
      {
        tabId: 1,
        windowId: 1,
        title: "Active",
        favIconUrl: "https://active.test/icon.png",
      },
    ],
    cursor: 0,
  });
});

test("per-window mode keeps histories isolated", async () => {
  const { chrome, records, setFocusedWindow } = createChromeStubs([
    {
      id: 1,
      windowId: 1,
      active: true,
      title: "Docs",
      favIconUrl: "https://docs.test/icon.png",
    },
    {
      id: 2,
      windowId: 1,
      active: false,
      title: "Mail",
      favIconUrl: "https://mail.test/icon.png",
    },
    {
      id: 3,
      windowId: 2,
      active: true,
      title: "Chat",
      favIconUrl: "https://chat.test/icon.png",
    },
  ]);

  const service = new HistoryService({
    chromeApi: chrome,
    historyMode: "per-window",
  });
  await service.init();

  await chrome.tabs.onActivated.dispatch({ tabId: 1, windowId: 1 });
  await chrome.windows.onFocusChanged.dispatch(2);
  await chrome.tabs.onActivated.dispatch({ tabId: 2, windowId: 1 });
  setFocusedWindow(1);
  await chrome.commands.onCommand.dispatch("goBackInTabHistory");

  assert.deepEqual(service.getStateSnapshot().perWindowTimelines, {
    1: {
      entries: [
        {
          tabId: 1,
          windowId: 1,
          title: "Docs",
          favIconUrl: "https://docs.test/icon.png",
        },
        {
          tabId: 2,
          windowId: 1,
          title: "Mail",
          favIconUrl: "https://mail.test/icon.png",
        },
      ],
      cursor: 0,
    },
    2: {
      entries: [
        {
          tabId: 3,
          windowId: 2,
          title: "Chat",
          favIconUrl: "https://chat.test/icon.png",
        },
      ],
      cursor: 0,
    },
  });
  assert.deepEqual(records.tabUpdates.at(-1), {
    tabId: 1,
    updateProperties: { active: true },
  });
});

test("reactivating the same tab refreshes stored metadata", async () => {
  const { chrome } = createChromeStubs([
    {
      id: 7,
      windowId: 1,
      active: true,
      title: "Old title",
      favIconUrl: "https://site.test/old.png",
    },
  ]);

  const service = new HistoryService({ chromeApi: chrome });
  await service.init();

  await chrome.tabs.onActivated.dispatch({ tabId: 7, windowId: 1 });
  chrome.tabs.update = async (tabId, updateProperties) => {
    if (updateProperties.active) {
      return {
        id: tabId,
        windowId: 1,
        active: true,
        title: "New title",
        favIconUrl: "https://site.test/new.png",
      };
    }
    throw new Error("Unexpected tab update");
  };
  chrome.tabs.get = async () => ({
    id: 7,
    windowId: 1,
    active: true,
    title: "New title",
    favIconUrl: "https://site.test/new.png",
  });

  await chrome.tabs.onActivated.dispatch({ tabId: 7, windowId: 1 });

  assert.deepEqual(service.getStateSnapshot().globalTimeline, {
    entries: [
      {
        tabId: 7,
        windowId: 1,
        title: "New title",
        favIconUrl: "https://site.test/new.png",
      },
    ],
    cursor: 0,
  });
});

test("runtime activation can focus a timeline entry directly", async () => {
  const { chrome, records } = createChromeStubs([
    {
      id: 1,
      windowId: 1,
      active: false,
      title: "Docs",
      favIconUrl: "https://docs.test/icon.png",
    },
    {
      id: 2,
      windowId: 1,
      active: true,
      title: "Mail",
      favIconUrl: "https://mail.test/icon.png",
    },
  ]);

  const service = new HistoryService({ chromeApi: chrome });
  await service.init();

  await chrome.tabs.onActivated.dispatch({ tabId: 1, windowId: 1 });
  await chrome.tabs.onActivated.dispatch({ tabId: 2, windowId: 1 });

  const response = await service.handleRuntimeMessage({
    type: "activate-entry",
    entryIndex: 0,
    historyMode: "global",
    source: "popup",
  });

  assert.equal(response.state.state.globalTimeline.cursor, 0);
  assert.deepEqual(records.windowUpdates.at(-1), {
    windowId: 1,
    updateProperties: { focused: true },
  });
  assert.deepEqual(records.tabUpdates.at(-1), {
    tabId: 1,
    updateProperties: { active: true },
  });
  assert.equal(service.getStateSnapshot().globalTimeline.cursor, 0);
});
