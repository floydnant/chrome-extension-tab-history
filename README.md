# Tab History Navigation

This is a standalone Manifest V3 Chrome extension that provides browser-tab back and forward
navigation using an explicit cursor-based history model.

## Behavior

- Manual tab activations append a new history entry.
- Back and forward move a cursor through existing history entries.
- Back and forward never append new entries.
- Manual activation after moving back truncates the forward branch before appending.
- Invalid tab references are pruned on load and skipped during navigation.
- Cross-window navigation is supported in global mode.

## Feature Flag

History scope is controlled by a hardcoded flag in [background/config.js](./background/config.js):

```js
export const WINDOW_HISTORY_MODE = "global";
```

Supported values:

- `global`
- `per-window`

## Files

- [background/history_state.js](./background/history_state.js): Pure timeline state helpers.
- [background/navigation_guard.js](./background/navigation_guard.js): Suppresses extension-driven
  activations.
- [background/storage.js](./background/storage.js): Session-storage persistence wrapper.
- [background/history_service.js](./background/history_service.js): Event wiring and command
  execution.
- [background/main.js](./background/main.js): Service worker entrypoint.
- [ARCHITECTURE.md](./ARCHITECTURE.md): State model and event-flow notes.

## Running Tests

From this directory:

```sh
npm test
```

## Loading The Extension

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Choose Load unpacked.
4. Select this folder.
5. Reload the extension whenever you change the manifest or content-script files.

## Shortcut Setup

You do not need to assign shortcuts in `chrome://extensions/shortcuts` for the main workflow anymore.

The primary built-in shortcuts are handled by the page content script:

- `Ctrl+-`: go back in tab history
- `Ctrl+Shift+-`: go forward in tab history

These work on normal web pages where the content script can run.

The Chrome commands page is now optional and acts only as a fallback path. You can still assign
shortcuts there for:

- `goBackInTabHistory`
- `goForwardInTabHistory`

but the extension no longer depends on that UI for its main shortcuts.

## Basic Usage

This extension now has a toolbar popup for inspection and manual testing. It also responds to tab and
window activation events, to Chrome extension commands, and to custom page-level shortcuts on normal
web pages.

To verify it is working:

1. Load the extension.
2. Click the extension icon once. The popup should open and show the current session timeline.
3. Switch tabs manually a few times, for example `A -> B -> C`.
4. On a normal web page, press `Ctrl+-` to go back.
5. Press `Ctrl+Shift+-` to go forward.
6. Open the popup again and confirm the `Last command` line updates.

The popup is also a full fallback control surface:

- `Back`: move backward through tab history
- `Forward`: move forward through tab history
- `Refresh`: reload the displayed debug state and timeline

You can also use the popup's `Back`, `Forward`, and `Refresh` buttons to test the extension without
relying on keyboard shortcuts.

On pages where content scripts do not run, such as `chrome://` pages and the extensions UI, use the
popup buttons instead.

If you load the extension and press a shortcut before switching tabs, nothing will happen because the
history is empty.

## Service Worker Notes

On the Manage Extension page, `Inspect views service worker (Inactive)` is expected for a Manifest V3
extension. Chrome stops the service worker when idle and starts it again automatically when an extension
event occurs.

You do not need to manually start it. These events should wake it automatically:

- a tab activation
- a window focus change
- one of the assigned extension shortcuts
- opening the extension popup

If you switch tabs or use a shortcut, the worker should briefly wake, handle the event, and then become
inactive again.

## Troubleshooting

- Make sure you are testing on a normal web page where the content script can run.
- The primary hardcoded shortcuts are `Ctrl+-` for back and `Ctrl+Shift+-` for forward.
- Make sure the shortcut is not already claimed by Chrome, macOS, or another extension.
- Click inside a normal browser tab before testing the shortcut so Chrome receives the key event.
- Build some history first by manually switching tabs. Back and forward are no-ops on an empty history.
- Browser restart clears the recorded history. This extension uses `chrome.storage.session`, so history
  survives MV3 service worker unloads during the same browser session, but not a full browser restart.
- Re-focusing the same window and same active tab will not create a new history entry, so repeated
  presses may appear to do nothing if there was no real tab change.
- `chrome://extensions/shortcuts` is now optional for normal page usage. It only applies to the Chrome
  commands API path, which is kept as a secondary fallback.

## Notes

- The implementation does not use `chrome.tabs.Tab.lastAccessed`.
- State is persisted in `chrome.storage.session` so history survives MV3 service worker unloads
  within the same browser session.
- Tests use Node's built-in test runner; there is no Deno dependency.
