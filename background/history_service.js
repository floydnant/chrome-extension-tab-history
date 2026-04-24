import {
  COMMAND_GO_BACK,
  COMMAND_GO_FORWARD,
  WINDOW_HISTORY_MODE,
} from "./config.js";
import {
  clonePersistedState,
  createEmptyPersistedState,
  findNavigationTarget,
  getTimeline,
  recordManualVisit,
  pruneStateForLiveTabs,
  removeTabFromState,
} from "./history_state.js";
import { NavigationGuard } from "./navigation_guard.js";
import { SessionStateStorage } from "./storage.js";

export class HistoryService {
  constructor({
    chromeApi = globalThis.chrome,
    historyMode = WINDOW_HISTORY_MODE,
    storage = null,
    navigationGuard = null,
  } = {}) {
    this.chrome = chromeApi;
    this.historyMode = historyMode;
    this.storage = storage ?? new SessionStateStorage(chromeApi);
    this.navigationGuard = navigationGuard ?? new NavigationGuard();
    this.state = createEmptyPersistedState(historyMode);
    this.loaded = false;
    this.initPromise = null;
    this.queuedActions = [];
    this.actionChain = Promise.resolve();
    this.lastCommand = null;
    this.listenersRegistered = false;

    this.registerListeners();
  }

  async init() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = this.loadState();
    await this.initPromise;
  }

  registerListeners() {
    if (this.listenersRegistered) {
      return;
    }
    this.listenersRegistered = true;

    this.chrome.tabs.onActivated.addListener((activeInfo) => {
      return this.enqueueAction({ type: "tab-activated", activeInfo });
    });

    this.chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      return this.enqueueAction({
        type: "tab-updated",
        tabId,
        changeInfo,
        tab,
      });
    });

    this.chrome.tabs.onRemoved.addListener((tabId) => {
      return this.enqueueAction({ type: "tab-removed", tabId });
    });

    this.chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
      return this.enqueueAction({
        type: "tab-replaced",
        addedTabId,
        removedTabId,
      });
    });

    this.chrome.windows.onFocusChanged.addListener((windowId) => {
      return this.enqueueAction({ type: "window-focused", windowId });
    });

    this.chrome.commands.onCommand.addListener((command) => {
      return this.enqueueAction({ type: "command", command });
    });

    this.chrome.runtime.onMessage.addListener(
      (message, _sender, sendResponse) => {
        if (!message?.type) {
          return false;
        }

        this.enqueueAction({ type: "runtime-message", message })
          .then((result) => sendResponse({ ok: true, ...result }))
          .catch((error) =>
            sendResponse({ ok: false, error: error?.message ?? String(error) }),
          );
        return true;
      },
    );
  }

  async loadState() {
    const [storedState, liveTabs] = await Promise.all([
      this.storage.load(),
      this.chrome.tabs.query({}),
    ]);

    if (storedState) {
      this.state = {
        ...createEmptyPersistedState(this.historyMode),
        ...storedState,
        historyMode: this.historyMode,
        globalTimeline:
          storedState.globalTimeline ??
          createEmptyPersistedState(this.historyMode).globalTimeline,
        perWindowTimelines: storedState.perWindowTimelines ?? {},
      };
    }

    const liveTabIds = new Set(liveTabs.map((tab) => tab.id));
    const changed = pruneStateForLiveTabs(this.state, liveTabIds);

    this.loaded = true;

    if (changed) {
      await this.persistState();
    }

    while (this.queuedActions.length > 0) {
      const action = this.queuedActions.shift();
      await this.handleAction(action);
    }
  }

  enqueueAction(action) {
    if (!this.loaded) {
      this.queuedActions.push(action);
      return Promise.resolve();
    }

    this.actionChain = this.actionChain.then(() => this.handleAction(action));
    return this.actionChain;
  }

  async handleAction(action) {
    switch (action.type) {
      case "tab-activated":
        await this.handleActivation({
          tabId: action.activeInfo.tabId,
          windowId: action.activeInfo.windowId,
        });
        break;
      case "tab-updated":
        await this.handleTabUpdated(
          action.tabId,
          action.changeInfo,
          action.tab,
        );
        break;
      case "tab-removed":
        await this.handleTabRemoved(action.tabId);
        break;
      case "tab-replaced":
        await this.handleTabReplaced(action.addedTabId, action.removedTabId);
        break;
      case "window-focused":
        await this.handleWindowFocused(action.windowId);
        break;
      case "command":
        await this.handleCommand(action.command, { source: "command-api" });
        break;
      case "runtime-message":
        return await this.handleRuntimeMessage(action.message);
      default:
        throw new Error(`Unexpected action type: ${action.type}`);
    }
  }

  async handleRuntimeMessage(message) {
    switch (message.type) {
      case "get-state":
        return { state: this.getDebugState() };
      case "go-back":
        await this.handleCommand(COMMAND_GO_BACK, {
          source: message.source ?? "runtime-message",
        });
        return { state: this.getDebugState() };
      case "go-forward":
        await this.handleCommand(COMMAND_GO_FORWARD, {
          source: message.source ?? "runtime-message",
        });
        return { state: this.getDebugState() };
      case "activate-entry":
        await this.handleEntryActivation(message.entryIndex, {
          historyMode: message.historyMode,
          windowId: message.windowId,
          source: message.source ?? "runtime-message",
        });
        return { state: this.getDebugState() };
      default:
        return { state: this.getDebugState() };
    }
  }

  async handleActivation(entry) {
    const timelineEntry = await this.createTimelineEntry(entry);
    if (this.navigationGuard.consumeIfMatches(entry)) {
      return false;
    }

    if (this.navigationGuard.hasPending()) {
      this.navigationGuard.clear();
    }

    const timeline = getTimeline(
      this.state,
      this.historyMode,
      timelineEntry.windowId,
    );
    if (!timeline) {
      return false;
    }

    const changed = recordManualVisit(timeline, timelineEntry);
    if (changed) {
      await this.persistState();
    }
    return changed;
  }

  async handleWindowFocused(windowId) {
    if (windowId === this.chrome.windows.WINDOW_ID_NONE) {
      return false;
    }

    const tabs = await this.chrome.tabs.query({ windowId, active: true });
    if (!tabs[0]) {
      return false;
    }

    return await this.handleActivation(tabs[0]);
  }

  async handleTabUpdated(tabId, changeInfo, tab) {
    const metadataChanged =
      changeInfo?.status === "complete" ||
      Object.prototype.hasOwnProperty.call(changeInfo ?? {}, "title") ||
      Object.prototype.hasOwnProperty.call(changeInfo ?? {}, "favIconUrl");

    if (!metadataChanged) {
      return false;
    }

    const timelineEntry = await this.createTimelineEntry(
      tab ?? { tabId, windowId: changeInfo?.windowId },
    );
    if (timelineEntry.tabId == null || timelineEntry.windowId == null) {
      return false;
    }

    const changed = this.refreshTabMetadata(timelineEntry);
    if (changed) {
      await this.persistState();
    }
    return changed;
  }

  async handleTabRemoved(tabId) {
    const changed = removeTabFromState(this.state, tabId);
    if (changed) {
      await this.persistState();
    }
    return changed;
  }

  async handleTabReplaced(addedTabId, removedTabId) {
    let changed = removeTabFromState(this.state, removedTabId);

    let addedTab = null;
    try {
      addedTab = await this.chrome.tabs.get(addedTabId);
    } catch {
      addedTab = null;
    }

    if (addedTab?.active) {
      changed =
        (await this.handleActivation({
          tabId: addedTab.id,
          windowId: addedTab.windowId,
        })) || changed;
    } else if (changed) {
      await this.persistState();
    }

    return changed;
  }

  async handleCommand(command, { source = "unknown" } = {}) {
    this.lastCommand = {
      command,
      source,
      status: "received",
      timestamp: new Date().toISOString(),
    };
    console.log("[tab-history] command received", this.lastCommand);

    if (command !== COMMAND_GO_BACK && command !== COMMAND_GO_FORWARD) {
      this.lastCommand.status = "ignored-unknown-command";
      return false;
    }

    const currentTab = await this.getCurrentFocusedTab();
    if (!currentTab) {
      this.lastCommand.status = "no-current-tab";
      return false;
    }

    const direction = command === COMMAND_GO_BACK ? "back" : "forward";
    const timeline = getTimeline(
      this.state,
      this.historyMode,
      currentTab.windowId,
      { create: false },
    );
    if (!timeline) {
      this.lastCommand.status = "no-timeline";
      this.lastCommand.windowId = currentTab.windowId;
      return false;
    }

    const liveTabs = await this.chrome.tabs.query({});
    const liveTabIds = new Set(liveTabs.map((tab) => tab.id));
    const { targetEntry, targetIndex, changed } = findNavigationTarget(
      timeline,
      direction,
      liveTabIds,
    );

    if (changed) {
      await this.persistState();
    }

    if (!targetEntry || targetIndex === timeline.cursor) {
      this.lastCommand.status = targetEntry ? "cursor-noop" : "no-target-entry";
      this.lastCommand.windowId = currentTab.windowId;
      return false;
    }

    const previousCursor = timeline.cursor;
    timeline.cursor = targetIndex;
    this.navigationGuard.expectNavigation({ ...targetEntry, direction });

    try {
      await this.focusAndActivateEntry(targetEntry);
      await this.persistState();
      this.lastCommand = {
        ...this.lastCommand,
        status: "navigated",
        windowId: currentTab.windowId,
        targetEntry: { ...targetEntry },
      };
      console.log("[tab-history] command navigated", this.lastCommand);
      return true;
    } catch {
      this.navigationGuard.clear();
      timeline.cursor = previousCursor;
      removeTabFromState(this.state, targetEntry.tabId);
      await this.persistState();
      this.lastCommand = {
        ...this.lastCommand,
        status: "navigation-failed",
        windowId: currentTab.windowId,
        targetEntry: { ...targetEntry },
      };
      console.warn("[tab-history] command navigation failed", this.lastCommand);
      return false;
    }
  }

  async handleEntryActivation(
    entryIndex,
    { historyMode, windowId, source = "unknown" } = {},
  ) {
    this.lastCommand = {
      command: "activate-entry",
      source,
      status: "received",
      timestamp: new Date().toISOString(),
      entryIndex,
    };

    const timeline = getTimeline(
      this.state,
      historyMode ?? this.historyMode,
      historyMode === "per-window" ? windowId : undefined,
      { create: false },
    );

    if (!timeline || timeline.cursor === -1) {
      this.lastCommand.status = "no-timeline";
      return false;
    }

    if (
      !Number.isInteger(entryIndex) ||
      entryIndex < 0 ||
      entryIndex >= timeline.entries.length
    ) {
      this.lastCommand.status = "invalid-entry-index";
      return false;
    }

    const targetEntry = timeline.entries[entryIndex];
    const previousCursor = timeline.cursor;
    timeline.cursor = entryIndex;
    this.navigationGuard.expectNavigation({
      ...targetEntry,
      direction: entryIndex < previousCursor ? "back" : "forward",
    });

    try {
      await this.focusAndActivateEntry(targetEntry);
      await this.persistState();
      this.lastCommand = {
        ...this.lastCommand,
        status: "navigated",
        targetEntry: { ...targetEntry },
      };
      return true;
    } catch {
      this.navigationGuard.clear();
      timeline.cursor = previousCursor;
      this.lastCommand = {
        ...this.lastCommand,
        status: "navigation-failed",
        targetEntry: { ...targetEntry },
      };
      return false;
    }
  }

  async focusAndActivateEntry(entry) {
    await this.chrome.windows.update(entry.windowId, { focused: true });
    await this.chrome.tabs.update(entry.tabId, { active: true });
  }

  async createTimelineEntry(entry) {
    let tab = null;

    if (entry?.id != null && entry?.windowId != null) {
      tab = entry;
    } else if (entry?.tabId != null) {
      try {
        tab = await this.chrome.tabs.get(entry.tabId);
      } catch {
        tab = null;
      }
    }

    return {
      tabId: tab?.id ?? entry.tabId,
      windowId: tab?.windowId ?? entry.windowId,
      title: tab?.title ?? entry.title ?? "Untitled tab",
      favIconUrl: tab?.favIconUrl ?? entry.favIconUrl ?? null,
    };
  }

  refreshTabMetadata(entry) {
    let changed = false;
    const timelines = [
      this.state.globalTimeline,
      ...Object.values(this.state.perWindowTimelines ?? {}),
    ];

    for (const timeline of timelines) {
      if (!timeline?.entries?.length) {
        continue;
      }

      for (let index = 0; index < timeline.entries.length; index += 1) {
        const currentEntry = timeline.entries[index];
        if (currentEntry.tabId !== entry.tabId) {
          continue;
        }

        const nextEntry = {
          ...currentEntry,
          title: entry.title ?? currentEntry.title,
          favIconUrl: entry.favIconUrl ?? currentEntry.favIconUrl ?? null,
        };

        const entryChanged =
          currentEntry.title !== nextEntry.title ||
          currentEntry.favIconUrl !== nextEntry.favIconUrl;

        if (entryChanged) {
          timeline.entries[index] = nextEntry;
          changed = true;
        }
      }
    }

    return changed;
  }

  async getCurrentFocusedTab() {
    const tabs = await this.chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    return tabs[0] ?? null;
  }

  async persistState() {
    return await this.storage.save(clonePersistedState(this.state));
  }

  getStateSnapshot() {
    return clonePersistedState(this.state);
  }

  getDebugState() {
    return {
      loaded: this.loaded,
      historyMode: this.historyMode,
      pendingNavigation: this.navigationGuard.pendingNavigation,
      lastCommand: this.lastCommand,
      state: this.getStateSnapshot(),
    };
  }
}
