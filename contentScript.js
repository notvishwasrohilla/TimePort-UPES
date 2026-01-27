// contentScript.js
(() => {
  console.log("[TimePort] content script loaded");

  let dashboardSessions = [];
  let timetableEvents = [];

  const DASHBOARD_PATH = "/student/home/dashboard";
  const TIMETABLE_PATH = "/student/curriculum-scheduling";

  function isDashboard() {
    return location.pathname.includes(DASHBOARD_PATH);
  }

  function isTimetable() {
    return location.pathname.includes(TIMETABLE_PATH);
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  }

  function waitFor(selector, timeout = 20000) {
    return new Promise(resolve => {
      const start = Date.now();
      const timer = setInterval(() => {
        const el = document.querySelector(selector);
        if (el) {
          clearInterval(timer);
          resolve(el);
        }
        if (Date.now() - start > timeout) {
          clearInterval(timer);
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
    ).map(li => {
      const title =
        li.querySelector("b")?.textContent.trim() || "";

      const timeText =
        li.querySelector("p")?.childNodes[0]?.textContent.trim() || "";

      const roomEl = li.querySelector(".session-venue-info b");
      const linkEl = li.querySelector(".session-venue-info a");

      let locationText = "";
      let locationLink = "";

      if (linkEl) {
        locationText = "Online";
        locationLink = linkEl.href;
      } else if (roomEl) {
        locationText = roomEl.textContent
          .replace(/\(.*\)/, "")
          .trim();
      }

      return {
        title,
        timeText,
        date: todayISO(),
        locationText,
        locationLink
      };
    });

    console.log("[TimePort] Dashboard sessions:", dashboardSessions.length);
  }

  /* ---------------- TIMETABLE SCRAPER ---------------- */

  async function scrapeTimetable() {
    const ul = await waitFor(".session-info-container ul");
    if (!ul) return;

    timetableEvents = Array.from(
      ul.querySelectorAll("li.course-red-wrapper")
    ).map(li => {
      const subject =
        li.querySelector("b")?.textContent.trim() || "";

      const time =
        li.querySelector("p")?.childNodes[0]?.textContent.trim() || "";

      const roomEl = li.querySelector(".session-venue-info b");
      const linkEl = li.querySelector(".session-venue-info a");

      let locationText = "";
      let locationLink = "";

      if (linkEl) {
        locationText = "Online";
        locationLink = linkEl.href;
      } else if (roomEl) {
        locationText = roomEl.textContent
          .replace(/\(.*\)/, "")
          .trim();
      }

      // Best-effort date (Angular does not expose cleanly)
      const dateText =
        document.querySelector(".k-tabstrip .k-active")?.textContent.trim() ||
        "";

      return {
        subject,
        time,
        date: dateText,
        locationText,
        locationLink
      };
    });

    console.log("[TimePort] Timetable events:", timetableEvents.length);
  }

  /* ---------------- BOOTSTRAP ---------------- */

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
      sendResponse({ sessions: dashboardSessions });
    }

    if (req.action === "getTimetableEvents") {
      sendResponse({ events: timetableEvents });
    }
  });
})();
