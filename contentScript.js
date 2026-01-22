(() => {
  const DASHBOARD_PATH = "/student/home/dashboard";
  const SESSION_CONTAINER = ".session-info-container";
  const SESSION_ITEM = "li.course-red-wrapper";

  let poller = null;
  let lastHash = "";

  function isDashboard() {
    return location.pathname.includes(DASHBOARD_PATH);
  }

  function scrape() {
    if (!isDashboard()) return;

    const container = document.querySelector(SESSION_CONTAINER);
    if (!container) return;

    const items = Array.from(container.querySelectorAll(SESSION_ITEM));
    if (!items.length) return;

    const sessions = items.map(li => {
      const title = li.querySelector("b")?.textContent.trim() || "";
      const courseLine = li.querySelector("span[style]")?.textContent.trim() || "";
      const timeText = li.querySelector("p")?.childNodes[0]?.textContent.trim() || "";
      const room =
        li.querySelector(".session-venue-info b")
          ?.textContent.replace(/\(.*\)/, "")
          .trim() || "";

      return { title, courseLine, timeText, room };
    });

    const hash = JSON.stringify(sessions);
    if (hash !== lastHash) {
      lastHash = hash;
      window.__UPES_DASHBOARD_SESSIONS = sessions;
    }
  }

  function startPolling() {
    if (poller) return;

    poller = setInterval(scrape, 500);
  }

  function stopPolling() {
    if (poller) clearInterval(poller);
    poller = null;
    window.__UPES_DASHBOARD_SESSIONS = [];
    lastHash = "";
  }

  // SPA route watcher
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      if (isDashboard()) startPolling();
      else stopPolling();
    }
  }, 400);

  // Initial
  if (isDashboard()) startPolling();

  // Popup bridge
  chrome.runtime.onMessage.addListener((req, _, res) => {
    if (req.action === "getDashboardSessions") {
      res({ sessions: window.__UPES_DASHBOARD_SESSIONS || [] });
    }
  });
})();
