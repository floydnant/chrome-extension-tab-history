(function () {
  const SHORTCUTS = [
    {
      type: "go-back",
      description: "Ctrl+-",
      matches(event) {
        return (
          event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.shiftKey &&
          event.code === "Minus"
        );
      },
    },
    {
      type: "go-forward",
      description: "Ctrl+Shift+-",
      matches(event) {
        return (
          event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          event.shiftKey &&
          event.code === "Minus"
        );
      },
    },
  ];

  function isEditableElement(element) {
    if (!element || !(element instanceof Element)) {
      return false;
    }

    if (element.isContentEditable) {
      return true;
    }

    return (
      element.closest(
        'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]',
      ) != null
    );
  }

  function shouldIgnoreEvent(event) {
    if (event.defaultPrevented || event.repeat || event.isComposing) {
      return true;
    }

    return isEditableElement(event.target);
  }

  async function handleKeydown(event) {
    if (shouldIgnoreEvent(event)) {
      return;
    }

    const shortcut = SHORTCUTS.find((candidate) => candidate.matches(event));
    if (!shortcut) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    try {
      await chrome.runtime.sendMessage({
        type: shortcut.type,
        source: "content-script-shortcut",
      });
    } catch (error) {
      console.error(
        "[tab-history] content shortcut failed",
        shortcut.description,
        error,
      );
    }
  }

  globalThis.addEventListener("keydown", handleKeydown, true);
})();
