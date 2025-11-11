// background.js — minimal service worker for TimePort UPES
self.addEventListener('install', () => {
  console.log('TimePort UPES service worker installed');
});

self.addEventListener('activate', () => {
  console.log('TimePort UPES service worker active');
});

// Optional: handle messages if needed in future (kept simple now)
chrome.runtime.onMessage && chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === 'ping') {
    sendResponse({ pong: true });
  }
});
