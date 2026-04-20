function createEvent() {
  const listeners = [];
  return {
    addListener(listener) {
      listeners.push(listener);
    },
    async dispatch(...args) {
      for (const listener of listeners) {
        await listener(...args);
      }
    },
  };
}

function cloneTab(tab) {
  return { ...tab };
}

export function createChromeStubs(initialTabs = []) {
  const tabsById = new Map(initialTabs.map((tab) => [tab.id, cloneTab(tab)]));
  const focusedWindow = {
    id: initialTabs.find((tab) => tab.active)?.windowId ?? initialTabs[0]?.windowId ?? 1,
  };

  const records = {
    storageSets: [],
    tabUpdates: [],
    windowUpdates: [],
  };

  const storageArea = {
    store: {},
    async get(key) {
      if (key == null) {
        return structuredClone(this.store);
      }
      if (typeof key === "string") {
        return { [key]: structuredClone(this.store[key]) };
      }
      const result = {};
      for (const item of key) {
        result[item] = structuredClone(this.store[item]);
      }
      return result;
    },
    async set(value) {
      Object.assign(this.store, structuredClone(value));
      records.storageSets.push(structuredClone(value));
    },
  };

  const chrome = {
    runtime: {
      onMessage: createEvent(),
      async sendMessage(message) {
        let response;
        await chrome.runtime.onMessage.dispatch(
          message,
          {},
          (value) => {
            response = value;
          },
        );
        return response;
      },
    },
    tabs: {
      onActivated: createEvent(),
      onRemoved: createEvent(),
      onReplaced: createEvent(),
      async query(queryInfo = {}) {
        let tabs = [...tabsById.values()].map(cloneTab);
        if (queryInfo.windowId != null) {
          tabs = tabs.filter((tab) => tab.windowId === queryInfo.windowId);
        }
        if (queryInfo.active) {
          tabs = tabs.filter((tab) => tab.active);
        }
        if (queryInfo.lastFocusedWindow) {
          tabs = tabs.filter((tab) => tab.windowId === focusedWindow.id);
        }
        return tabs;
      },
      async get(tabId) {
        if (!tabsById.has(tabId)) {
          throw new Error(`Unknown tab: ${tabId}`);
        }
        return cloneTab(tabsById.get(tabId));
      },
      async update(tabId, updateProperties) {
        if (!tabsById.has(tabId)) {
          throw new Error(`Unknown tab: ${tabId}`);
        }

        const targetTab = tabsById.get(tabId);
        if (updateProperties.active) {
          for (const tab of tabsById.values()) {
            if (tab.windowId === targetTab.windowId) {
              tab.active = false;
            }
          }
          targetTab.active = true;
          focusedWindow.id = targetTab.windowId;
        }

        Object.assign(targetTab, updateProperties);
        records.tabUpdates.push({ tabId, updateProperties: structuredClone(updateProperties) });
        return cloneTab(targetTab);
      },
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: createEvent(),
      async update(windowId, updateProperties) {
        if (updateProperties.focused) {
          focusedWindow.id = windowId;
        }
        records.windowUpdates.push({ windowId, updateProperties: structuredClone(updateProperties) });
        return { id: windowId, focused: !!updateProperties.focused };
      },
    },
    commands: {
      onCommand: createEvent(),
    },
    storage: {
      session: storageArea,
    },
  };

  return {
    chrome,
    records,
    setFocusedWindow(windowId) {
      focusedWindow.id = windowId;
    },
    setTabs(tabs) {
      tabsById.clear();
      for (const tab of tabs) {
        tabsById.set(tab.id, cloneTab(tab));
      }
    },
    addTab(tab) {
      tabsById.set(tab.id, cloneTab(tab));
    },
  };
}