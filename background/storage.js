import { HISTORY_STORAGE_KEY } from "./config.js";

export class SessionStateStorage {
  constructor(chromeApi = globalThis.chrome, storageKey = HISTORY_STORAGE_KEY) {
    this.chrome = chromeApi;
    this.storageKey = storageKey;
    this.lastSerializedState = null;
  }

  async load() {
    const data = await this.chrome.storage.session.get(this.storageKey);
    const state = data[this.storageKey] ?? null;
    this.lastSerializedState = state == null ? null : JSON.stringify(state);
    return state;
  }

  async save(state) {
    const serializedState = JSON.stringify(state);
    if (serializedState === this.lastSerializedState) {
      return false;
    }

    await this.chrome.storage.session.set({ [this.storageKey]: state });
    this.lastSerializedState = serializedState;
    return true;
  }
}
