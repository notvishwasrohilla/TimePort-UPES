// contentScript.js
(() => {
  let dashboardSessions = [];
  let timetableEvents = [];

  /* ---------------- HELPERS ---------------- */

  function isDashboard() {
    return location.pathname.includes("/student/home/dashboard");
  }

  function isTimetable() {
    return location.pathname.includes("/student/curriculum-scheduling");
  }

  function waitFor(selector, timeout = 20000) {
    return new Promise(resolve => {
      const start = Date.now();
      const t = setInterval(() => {
        const el = document.querySelector(selector);
        if (el) {
          clearInterval(t);
          resolve(el);
        }
        if (Date.now() - start > timeout) {
          clearInterval(t);
          resolve(null);
        }
      }, 500);
    });
  }

  /* ---------------- DASHBOARD SCRAPER ---------------- */

  async function scrapeDashboard() {
    const ul = await waitFor(".session-info-container ul");
    if (!ul) return;

    dashboardSessions = Array.from(
      ul.querySelectorAll("li.course-red-wrapper")
    ).map(li => ({
      title: li.querySelector("b")?.textContent.trim() || "",
      timeText: li.querySelector("p")?.childNodes[0]?.textContent.trim() || "",
      room: li.querySelector(".session-venue-info b")
        ?.textContent.replace(/\(.*\)/, "")
        .trim() || ""
    }));
  }

  /* ---------------- TIMETABLE SCRAPER (KENDO) ---------------- */

  async function scrapeTimetable() {
    const eventNode = await waitFor(".k-event .event-in-details");
    if (!eventNode) return;

    timetableEvents = [...document.querySelectorAll(
      ".k-event .event-in-details"
    )]
      .map(el => {
        const subject = el.getAttribute("titlemodulename");
        const time = el.getAttribute("titleitem");
        const room = el.getAttribute("titlevenuename");
        const faculty = el.getAttribute("titlefacultyname");

        const eventEl = el.closest(".k-event");
        const slot = eventEl?.closest("td[monthslot]");
        const date = slot?.getAttribute("title") || "";

        if (!subject || !time) return null;

        return {
          subject,
          time,
          room,
          faculty,
          date
        };
      })
      .filter(Boolean);
  }

  /* ---------------- INIT ---------------- */

  async function init() {
    if (isDashboard()) {
      await scrapeDashboard();
      setInterval(scrapeDashboard, 5 * 60 * 1000);
    }

    if (isTimetable()) {
      await scrapeTimetable();
      setInterval(scrapeTimetable, 5 * 60 * 1000);
    }
  }

  init();

  /* ---------------- MESSAGE BRIDGE ---------------- */

  chrome.runtime.onMessage.addListener((req, _, sendResponse) => {
    if (req.action === "getDashboardSessions") {
      if (!dashboardSessions.length) {
        scrapeDashboard().then(() =>
          sendResponse({ sessions: dashboardSessions })
        );
        return true;
      }
      sendResponse({ sessions: dashboardSessions });
    }

    if (req.action === "getTimetableEvents") {
      if (!timetableEvents.length) {
        scrapeTimetable().then(() =>
          sendResponse({ events: timetableEvents })
        );
        return true;
      }
      sendResponse({ events: timetableEvents });
    }
  });
})();
