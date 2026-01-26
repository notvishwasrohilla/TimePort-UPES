// contentScript.js
(() => {
  let dashboardSessions = [];
  let timetableEvents = [];

  /* ---------------- PAGE HELPERS ---------------- */

  function isDashboard() {
    return location.pathname.includes("/student/home/dashboard");
  }

  function isTimetable() {
    return location.pathname.includes("/student/curriculum-scheduling");
  }

  function scrapeListItems() {
    const ul = document.querySelector(".session-info-container ul");
    if (!ul) return null;

    const items = Array.from(
      ul.querySelectorAll("li.course-red-wrapper")
    );

    if (!items.length) return null;

    return items.map(li => {
      const subject =
        li.querySelector("b")?.textContent.trim() || "";

      const time =
        li.querySelector("p")?.childNodes[0]?.textContent.trim() || "";

      const room =
        li.querySelector(".session-venue-info b")
          ?.textContent.replace(/\(.*\)/, "")
          .trim() || null;

      const linkEl = li.querySelector(".session-venue-info a");
      const link = linkEl ? linkEl.href : null;

      const color =
        li.style.borderLeft ||
        getComputedStyle(li).borderLeftColor ||
        "";

      return {
        subject,
        time,
        room,
        link,
        isOnline: !!link,
        color
      };
    });
  }

  /* ---------------- DASHBOARD ---------------- */

  function pollDashboard() {
    const data = scrapeListItems();
    if (data) {
      dashboardSessions = data;
    }
  }

  /* ---------------- TIMETABLE ---------------- */

  function pollTimetable() {
    const data = scrapeListItems();
    if (!data) return;

    const dateLabel =
      document.querySelector(".k-tabstrip .k-item.k-active .k-link")
        ?.textContent.trim() || "";

    timetableEvents = data.map(e => ({
      ...e,
      date: dateLabel
    }));
  }

  /* ---------------- INIT ---------------- */

  function init() {
    if (isDashboard()) {
      // aggressive polling for Angular
      setInterval(pollDashboard, 1000);
    }

    if (isTimetable()) {
      setInterval(pollTimetable, 1000);
    }
  }

  init();

  /* ---------------- MESSAGE BRIDGE ---------------- */

  chrome.runtime.onMessage.addListener((req, _, sendResponse) => {
    if (req.action === "getDashboardSessions") {
      sendResponse({ sessions: dashboardSessions });
    }

    if (req.action === "getTimetableEvents") {
      sendResponse({ events: timetableEvents });
    }
  });
})();
