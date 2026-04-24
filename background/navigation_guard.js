import { NAVIGATION_GUARD_TIMEOUT_MS } from "./config.js";

export class NavigationGuard {
  constructor({
    timeoutMs = NAVIGATION_GUARD_TIMEOUT_MS,
    clock = globalThis,
  } = {}) {
    this.timeoutMs = timeoutMs;
    this.clock = clock;
    this.pendingNavigation = null;
    this.timeoutId = null;
  }

  expectNavigation(pendingNavigation) {
    this.clear();
    this.pendingNavigation = { ...pendingNavigation };
    this.timeoutId = this.clock.setTimeout(() => {
      this.clear();
    }, this.timeoutMs);
  }

  hasPending() {
    return this.pendingNavigation != null;
  }

  consumeIfMatches(entry) {
    if (!this.pendingNavigation) {
      return false;
    }

    if (
      this.pendingNavigation.tabId === entry.tabId &&
      this.pendingNavigation.windowId === entry.windowId
    ) {
      this.clear();
      return true;
    }

    return false;
  }

  clear() {
    if (this.timeoutId != null) {
      this.clock.clearTimeout(this.timeoutId);
    }
    this.pendingNavigation = null;
    this.timeoutId = null;
  }
}
