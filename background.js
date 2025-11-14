chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "get_token") {
    chrome.identity.getAuthToken({ interactive: true }, token => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, token });
      }
    });
    return true;
  }
});
