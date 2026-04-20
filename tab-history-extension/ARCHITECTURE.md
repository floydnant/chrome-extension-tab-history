# Architecture

## State Model

The extension uses an explicit timeline with a movable cursor.

```js
{
  entries: [{ tabId, windowId }],
  cursor: number
}
```

Persisted state matches the active history mode:

```js
{
  historyMode: "global" | "per-window",
  globalTimeline: TimelineState,
  perWindowTimelines: { [windowId]: TimelineState }
}
```

## Invariants

- The cursor is authoritative.
- Manual visits append.
- Programmatic back and forward only move the cursor.
- Manual visits after moving back discard the forward branch.
- Consecutive duplicate entries are suppressed.
- Extension-triggered activations are consumed by an in-memory guard.

## Event Flow

1. The service worker registers listeners immediately.
2. Events that arrive before session-state hydration are queued.
3. Stored state is loaded from `chrome.storage.session`.
4. Stored history is pruned against currently live tabs.
5. Queued events replay in order.

The primary event sources are:

- `chrome.tabs.onActivated`
- `chrome.tabs.onRemoved`
- `chrome.tabs.onReplaced`
- `chrome.windows.onFocusChanged`
- `chrome.commands.onCommand`

## Navigation Guard

Back and forward commands create a short-lived pending navigation record before calling
`chrome.windows.update()` and `chrome.tabs.update()`.

When the matching activation event arrives, the guard consumes it so the activation is not recorded
as a manual visit. If a conflicting activation arrives instead, the pending record is cleared and
the activation is treated as manual.

## Mode Semantics

### Global mode

- All windows share one history timeline.
- Back and forward may move across windows.

### Per-window mode

- Each window maintains an independent timeline.
- Commands operate on the currently focused window only.
- Activations in one window do not affect another window's history.