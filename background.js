// background.js

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action !== "get_token") return;

  const interactive = !!request.interactive;

  chrome.identity.getAuthToken({ interactive }, token => {
    if (chrome.runtime.lastError || !token) {
      sendResponse({
        success: false,
        error: chrome.runtime.lastError?.message || "Auth failed"
      });
      return;
    }

    sendResponse({
      success: true,
      token
    });
  });

  // Required for async response
  return true;
});
