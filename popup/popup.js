const statusLine = document.querySelector("#statusLine");
const statusCard = document.querySelector("#statusCard");
const searchInput = document.querySelector("#searchInput");
const timelineList = document.querySelector("#timelineList");
const backButton = document.querySelector("#backButton");
const forwardButton = document.querySelector("#forwardButton");
const refreshButton = document.querySelector("#refreshButton");

const REQUEST_TIMEOUT_MS = 2000;
let lastDebugState = null;
let currentViewState = null;
let activeEntryIndex = null;
let searchQuery = "";
let lastRenderedEntries = [];

function formatEntryTitle(entry) {
  const title = entry.title?.trim();
  if (title) {
    return title;
  }
  return `Tab ${entry.tabId}`;
}

function getActiveTimeline(debugState) {
  if (debugState.historyMode === "global") {
    return debugState.state.globalTimeline;
  }

  const activeWindowEntry = Object.entries(
    debugState.state.perWindowTimelines,
  )[0];
  return activeWindowEntry?.[1] ?? { entries: [], cursor: -1 };
}

function getActiveWindowId(debugState) {
  if (debugState.historyMode === "global") {
    return null;
  }

  const activeWindowEntry = Object.entries(
    debugState.state.perWindowTimelines,
  )[0];
  return activeWindowEntry ? Number(activeWindowEntry[0]) : null;
}

function getDisplayEntries(entries) {
  return entries.map((entry, index) => ({ entry, index })).reverse();
}

function normalizeText(value) {
  return value?.toLowerCase?.() ?? "";
}

function getFilteredEntries(entries) {
  const normalizedQuery = normalizeText(searchQuery.trim());
  if (!normalizedQuery) {
    return getDisplayEntries(entries);
  }

  return getDisplayEntries(entries).filter(({ entry }) => {
    return normalizeText(formatEntryTitle(entry)).includes(normalizedQuery);
  });
}

function keepSearchFocused() {
  if (document.hasFocus() && document.activeElement !== searchInput) {
    searchInput.focus({ preventScroll: true });
  }
}

function ensureActiveEntry(preferredEntryIndex = null) {
  if (!lastRenderedEntries.length) {
    activeEntryIndex = null;
    return;
  }

  const matchingEntry = lastRenderedEntries.find(
    ({ index }) => index === preferredEntryIndex,
  );
  activeEntryIndex = matchingEntry?.index ?? lastRenderedEntries[0].index;
}

function syncActiveEntryIntoView() {
  const activeTrigger = timelineList.querySelector(
    `.timelineTrigger[data-entry-index="${activeEntryIndex}"]`,
  );
  activeTrigger?.scrollIntoView({ block: "nearest" });
}

function moveActiveEntry(step) {
  if (!lastRenderedEntries.length) {
    return;
  }

  const currentPosition = lastRenderedEntries.findIndex(
    ({ index }) => index === activeEntryIndex,
  );
  const nextPosition =
    currentPosition === -1
      ? 0
      : Math.max(
          0,
          Math.min(currentPosition + step, lastRenderedEntries.length - 1),
        );

  activeEntryIndex = lastRenderedEntries[nextPosition].index;
  syncActiveEntryIntoView();
}

function handleTimelineNavigationKey(event) {
  if (event.key === "ArrowDown" /*  || (event.key === "j") */) {
    event.preventDefault();
    moveActiveEntry(1);
    return true;
  }

  if (event.key === "ArrowUp" /*  || (event.key === "k") */) {
    event.preventDefault();
    moveActiveEntry(-1);
    return true;
  }

  if (event.key === "Home") {
    event.preventDefault();
    ensureActiveEntry(lastRenderedEntries[0]?.index ?? null);
    syncActiveEntryIntoView();
    return true;
  }

  if (event.key === "End") {
    event.preventDefault();
    ensureActiveEntry(lastRenderedEntries.at(-1)?.index ?? null);
    syncActiveEntryIntoView();
    return true;
  }

  return false;
}

function rerenderFromLastState() {
  if (!lastDebugState) {
    return;
  }

  render(lastDebugState);
}

function render(debugState) {
  lastDebugState = debugState;
  const timeline = getActiveTimeline(debugState);
  const entries = timeline?.entries ?? [];
  const cursor = timeline?.cursor ?? -1;
  const nextActiveEntryIndex = activeEntryIndex ?? cursor;
  currentViewState = {
    historyMode: debugState.historyMode,
    windowId: getActiveWindowId(debugState),
  };

  statusCard.hidden = true;
  statusLine.textContent = "";

  backButton.disabled = cursor <= 0;
  forwardButton.disabled = cursor === -1 || cursor >= entries.length - 1;

  timelineList.replaceChildren();
  lastRenderedEntries = getFilteredEntries(entries);
  ensureActiveEntry(nextActiveEntryIndex);

  if (!lastRenderedEntries.length) {
    activeEntryIndex = null;
    const emptyState = document.createElement("li");
    emptyState.className = "emptyState";
    emptyState.textContent = searchQuery.trim()
      ? "No matching tabs."
      : "No history yet. Switch tabs manually, then try Back or Forward.";
    timelineList.append(emptyState);
    keepSearchFocused();
    return;
  }

  for (
    let displayIndex = 0;
    displayIndex < lastRenderedEntries.length;
    displayIndex += 1
  ) {
    const { entry, index } = lastRenderedEntries[displayIndex];
    const item = document.createElement("li");
    item.className = `timelineItem${index === cursor ? " current" : ""}${index === activeEntryIndex ? " active" : ""}`;

    const trigger = document.createElement("button");
    trigger.className = "timelineTrigger";
    trigger.type = "button";
    trigger.tabIndex = -1;
    trigger.dataset.entryIndex = String(index);
    trigger.title = formatEntryTitle(entry);
    trigger.setAttribute("aria-label", `Activate ${formatEntryTitle(entry)}`);

    const favicon = document.createElement("img");
    favicon.className = "timelineFavicon";
    favicon.alt = "";
    favicon.src = entry.favIconUrl || "../icons/icon48.png";

    const title = document.createElement("span");
    title.textContent = formatEntryTitle(entry);

    trigger.append(favicon, title);
    item.append(trigger);
    timelineList.append(item);
  }

  syncActiveEntryIntoView();
  keepSearchFocused();
}

async function request(type, payload = {}) {
  const response = await Promise.race([
    chrome.runtime.sendMessage({ type, ...payload }),
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            "Background service worker did not respond within 2 seconds.",
          ),
        );
      }, REQUEST_TIMEOUT_MS);
    }),
  ]);

  if (!response?.ok) {
    throw new Error(response?.error ?? "Unknown popup error");
  }
  render(response.state);
}

function showError(error) {
  console.error("Popup request failed", error);
  statusCard.hidden = false;
  statusLine.textContent = error.message;
}

async function loadState() {
  try {
    await request("get-state");
  } catch (error) {
    showError(error);
  } finally {
    keepSearchFocused();
  }
}

async function activateTimelineEntry(entryIndex) {
  if (!currentViewState) {
    return;
  }

  try {
    await request("activate-entry", {
      entryIndex,
      historyMode: currentViewState.historyMode,
      windowId: currentViewState.windowId,
      source: "popup",
    });
    window.close();
  } catch (error) {
    showError(error);
  }
}

backButton.addEventListener("click", async () => {
  try {
    await request("go-back");
  } catch (error) {
    showError(error);
  } finally {
    keepSearchFocused();
  }
});

forwardButton.addEventListener("click", async () => {
  try {
    await request("go-forward");
  } catch (error) {
    showError(error);
  } finally {
    keepSearchFocused();
  }
});

refreshButton.addEventListener("click", async () => {
  await loadState();
  keepSearchFocused();
});

searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value;
  rerenderFromLastState();
});

searchInput.addEventListener("keydown", async (event) => {
  if (handleTimelineNavigationKey(event)) {
    rerenderFromLastState();
    return;
  }

  if (event.key === "Enter" && activeEntryIndex != null) {
    event.preventDefault();
    await activateTimelineEntry(activeEntryIndex);
  }
});

timelineList.addEventListener("click", async (event) => {
  const trigger = event.target.closest(".timelineTrigger");
  if (!trigger) {
    return;
  }

  activeEntryIndex = Number(trigger.dataset.entryIndex);
  await activateTimelineEntry(Number(trigger.dataset.entryIndex));
});

document.addEventListener("keydown", async (event) => {
  if (
    event.defaultPrevented ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  ) {
    return;
  }

  if (document.activeElement === searchInput) {
    return;
  }

  if (handleTimelineNavigationKey(event)) {
    rerenderFromLastState();
    return;
  }

  if (
    (event.key === "Enter" || event.key === " ") &&
    activeEntryIndex != null
  ) {
    event.preventDefault();
    await activateTimelineEntry(activeEntryIndex);
  }
});

window.addEventListener("focus", keepSearchFocused);

document.addEventListener("mousedown", (event) => {
  const clickedTimelineTrigger = event.target.closest(".timelineTrigger");
  if (!clickedTimelineTrigger) {
    return;
  }

  event.preventDefault();
});

loadState();

loadState();
