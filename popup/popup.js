const statusLine = document.querySelector("#statusLine");
const statusCard = document.querySelector("#statusCard");
const timelineList = document.querySelector("#timelineList");
const backButton = document.querySelector("#backButton");
const forwardButton = document.querySelector("#forwardButton");
const refreshButton = document.querySelector("#refreshButton");

const REQUEST_TIMEOUT_MS = 2000;
let currentViewState = null;
let focusedEntryIndex = null;

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

function getTimelineTriggers() {
  return [...timelineList.querySelectorAll(".timelineTrigger")];
}

function focusTimelineEntry({ preferredEntryIndex = null } = {}) {
  const triggers = getTimelineTriggers();
  if (!triggers.length) {
    return;
  }

  const targetTrigger =
    preferredEntryIndex == null
      ? triggers[0]
      : (triggers.find(
          (trigger) =>
            Number(trigger.dataset.entryIndex) === preferredEntryIndex,
        ) ?? triggers[0]);

  targetTrigger.focus({ preventScroll: true });
  focusedEntryIndex = Number(targetTrigger.dataset.entryIndex);
}

function moveTimelineFocus(step) {
  const triggers = getTimelineTriggers();
  if (!triggers.length) {
    return;
  }

  const activeTrigger = document.activeElement?.closest?.(".timelineTrigger");
  const currentIndex = activeTrigger ? triggers.indexOf(activeTrigger) : -1;
  const nextIndex =
    currentIndex === -1
      ? 0
      : Math.max(0, Math.min(currentIndex + step, triggers.length - 1));

  triggers[nextIndex].focus();
  focusedEntryIndex = Number(triggers[nextIndex].dataset.entryIndex);
}

function handleTimelineNavigationKey(event) {
  if (event.key === "ArrowDown" || event.key === "j") {
    event.preventDefault();
    moveTimelineFocus(1);
    return true;
  }

  if (event.key === "ArrowUp" || event.key === "k") {
    event.preventDefault();
    moveTimelineFocus(-1);
    return true;
  }

  if (event.key === "Home") {
    event.preventDefault();
    focusTimelineEntry({
      preferredEntryIndex: Number(getTimelineTriggers()[0]?.dataset.entryIndex),
    });
    return true;
  }

  if (event.key === "End") {
    event.preventDefault();
    const triggers = getTimelineTriggers();
    focusTimelineEntry({
      preferredEntryIndex: Number(triggers.at(-1)?.dataset.entryIndex),
    });
    return true;
  }

  return false;
}

function render(debugState) {
  const timeline = getActiveTimeline(debugState);
  const entries = timeline?.entries ?? [];
  const cursor = timeline?.cursor ?? -1;
  const nextFocusedEntryIndex = focusedEntryIndex ?? cursor;
  currentViewState = {
    historyMode: debugState.historyMode,
    windowId: getActiveWindowId(debugState),
  };

  statusCard.hidden = true;
  statusLine.textContent = "";

  backButton.disabled = cursor <= 0;
  forwardButton.disabled = cursor === -1 || cursor >= entries.length - 1;

  timelineList.replaceChildren();

  if (!entries.length) {
    focusedEntryIndex = null;
    const emptyState = document.createElement("li");
    emptyState.className = "emptyState";
    emptyState.textContent =
      "No history yet. Switch tabs manually, then try Back or Forward.";
    timelineList.append(emptyState);
    return;
  }

  const displayEntries = getDisplayEntries(entries);

  for (
    let displayIndex = 0;
    displayIndex < displayEntries.length;
    displayIndex += 1
  ) {
    const { entry, index } = displayEntries[displayIndex];
    const item = document.createElement("li");
    item.className = `timelineItem${index === cursor ? " current" : ""}`;

    const trigger = document.createElement("button");
    trigger.className = "timelineTrigger";
    trigger.type = "button";
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

  focusTimelineEntry({ preferredEntryIndex: nextFocusedEntryIndex });
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
  }
});

forwardButton.addEventListener("click", async () => {
  try {
    await request("go-forward");
  } catch (error) {
    showError(error);
  }
});

refreshButton.addEventListener("click", loadState);

timelineList.addEventListener("click", async (event) => {
  const trigger = event.target.closest(".timelineTrigger");
  if (!trigger) {
    return;
  }

  await activateTimelineEntry(Number(trigger.dataset.entryIndex));
});

timelineList.addEventListener("keydown", async (event) => {
  const trigger = event.target.closest(".timelineTrigger");
  if (!trigger) {
    return;
  }

  if (handleTimelineNavigationKey(event)) {
    return;
  }

  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    await activateTimelineEntry(Number(trigger.dataset.entryIndex));
  }
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

  const activeTrigger = document.activeElement?.closest?.(".timelineTrigger");
  if (
    !activeTrigger &&
    (event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "j" ||
      event.key === "k" ||
      event.key === "Home" ||
      event.key === "End")
  ) {
    if (handleTimelineNavigationKey(event)) {
      return;
    }
  }

  if (!activeTrigger) {
    return;
  }

  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    await activateTimelineEntry(Number(activeTrigger.dataset.entryIndex));
  }
});

loadState();
