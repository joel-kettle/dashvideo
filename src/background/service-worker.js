/* DashVideo - background service worker.

   Keeps almost no state: it forwards the browser-level keyboard commands to
   the content script and opens the options page after a fresh install. */

const COMMAND_ACTIONS = {
  'toggle-maximize': 'maximize',
  'speed-up': 'speedUp',
  'speed-down': 'speedDown'
};

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
}

chrome.commands.onCommand.addListener(async (command) => {
  const action = COMMAND_ACTIONS[command];
  if (!action) return;
  const tabId = await activeTabId();
  if (tabId == null) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'DV_DO', action });
  } catch (e) {
    /* No content script on this page (chrome:// pages, the web store, ...). */
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage().catch(() => {});
  }
});
