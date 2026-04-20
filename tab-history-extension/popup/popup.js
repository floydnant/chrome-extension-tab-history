const statusLine = document.querySelector("#statusLine");
const modeLine = document.querySelector("#modeLine");
const pendingLine = document.querySelector("#pendingLine");
const commandLine = document.querySelector("#commandLine");
const countLine = document.querySelector("#countLine");
const timelineList = document.querySelector("#timelineList");
const shortcutList = document.querySelector("#shortcutList");
const backButton = document.querySelector("#backButton");
const forwardButton = document.querySelector("#forwardButton");
const refreshButton = document.querySelector("#refreshButton");

const REQUEST_TIMEOUT_MS = 2000;

function getActiveTimeline(debugState) {
  if (debugState.historyMode === "global") {
    return debugState.state.globalTimeline;
  }

  const activeWindowEntry = Object.entries(debugState.state.perWindowTimelines)[0];
  return activeWindowEntry?.[1] ?? { entries: [], cursor: -1 };
}

function render(debugState) {
  const timeline = getActiveTimeline(debugState);
  const entries = timeline?.entries ?? [];
  const cursor = timeline?.cursor ?? -1;

  statusLine.textContent = debugState.loaded
    ? "Service worker responded."
    : "Service worker is still loading.";
  modeLine.textContent = `Mode: ${debugState.historyMode}`;
  pendingLine.textContent = debugState.pendingNavigation
    ? `Pending navigation: tab ${debugState.pendingNavigation.tabId} in window ${debugState.pendingNavigation.windowId}`
    : "Pending navigation: none";
  commandLine.textContent = debugState.lastCommand
    ? `Last command: ${debugState.lastCommand.command} via ${debugState.lastCommand.source} → ${debugState.lastCommand.status}`
    : "Last command: none received yet";
  countLine.textContent = `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`;

  backButton.disabled = cursor <= 0;
  forwardButton.disabled = cursor === -1 || cursor >= entries.length - 1;

  timelineList.replaceChildren();

  if (!entries.length) {
    const emptyState = document.createElement("li");
    emptyState.className = "emptyState";
    emptyState.textContent = "No history yet. Switch tabs manually, then try Back or Forward.";
    timelineList.append(emptyState);
    return;
  }

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const item = document.createElement("li");
    item.className = `timelineItem${index === cursor ? " current" : ""}`;

    const title = document.createElement("strong");
    title.textContent = index === cursor
      ? `Current: tab ${entry.tabId}`
      : `Tab ${entry.tabId}`;

    const subtitle = document.createElement("span");
    subtitle.className = "meta";
    subtitle.textContent = `Window ${entry.windowId} · index ${index}`;

    item.append(title, subtitle);
    timelineList.append(item);
  }
}

function renderShortcuts(commands) {
  for (const command of commands) {
    if (!command.name || command.name === "_execute_action") {
      continue;
    }

    const item = document.createElement("li");
    item.className = "shortcutItem";

    const name = document.createElement("strong");
    name.className = "shortcutName";
    name.textContent = command.name;

    const value = document.createElement("span");
    value.className = "meta";
    value.textContent = command.shortcut || "No shortcut assigned";

    item.append(name, value);
    shortcutList.append(item);
  }
}

function renderCustomShortcuts() {
  const customShortcuts = [
    { name: "Page shortcut back", shortcut: "Ctrl+-" },
    { name: "Page shortcut forward", shortcut: "Ctrl+Shift+-" },
  ];

  for (const command of customShortcuts) {
    const item = document.createElement("li");
    item.className = "shortcutItem";

    const name = document.createElement("strong");
    name.className = "shortcutName";
    name.textContent = command.name;

    const value = document.createElement("span");
    value.className = "meta";
    value.textContent = `${command.shortcut} on normal web pages`;

    item.append(name, value);
    shortcutList.append(item);
  }
}

async function getCommands() {
  return await new Promise((resolve, reject) => {
    chrome.commands.getAll((commands) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(commands);
    });
  });
}

async function request(type) {
  const response = await Promise.race([
    chrome.runtime.sendMessage({ type }),
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error("Background service worker did not respond within 2 seconds."));
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
  statusLine.textContent = error.message;
  modeLine.textContent = "Open chrome://extensions, then inspect the service worker or Errors link.";
  pendingLine.textContent = "If the worker is inactive, click Refresh or switch tabs to wake it.";
}

async function loadState() {
  try {
    shortcutList.replaceChildren();
    const [_, commands] = await Promise.all([
      request("get-state"),
      getCommands(),
    ]);
    renderCustomShortcuts();
    renderShortcuts(commands);
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

loadState();