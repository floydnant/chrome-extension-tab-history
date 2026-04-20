import { HistoryService } from "./history_service.js";

const historyService = new HistoryService();
globalThis.tabHistoryService = historyService;
globalThis.getTabHistoryDebugState = () => historyService.getDebugState();

console.log("[tab-history] service worker starting");
historyService.init()
	.then(() => {
		console.log("[tab-history] service worker initialized");

		if (globalThis.chrome?.commands?.getAll) {
			globalThis.chrome.commands.getAll((commands) => {
				if (globalThis.chrome.runtime?.lastError) {
					console.warn(
						"[tab-history] failed to enumerate commands",
						globalThis.chrome.runtime.lastError.message,
					);
					return;
				}

				console.log("[tab-history] registered commands", commands);
			});
		}
	})
	.catch((error) => {
		console.error("[tab-history] service worker failed to initialize", error);
	});