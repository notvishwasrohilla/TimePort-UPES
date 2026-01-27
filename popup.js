// popup.js
document.addEventListener("DOMContentLoaded", function () {
  const statusText = document.getElementById("status");
  const statusDot = document.getElementById("statusDot");
  const connectBtn = document.getElementById("connectBtn");
  const syncBtn = document.getElementById("syncBtn");
  const list = document.getElementById("list");
  const pageTitle = document.getElementById("pageTitle");
  const pageLabel = document.getElementById("pageLabel");

  const progressWrap = document.getElementById("progressWrap");
  const progressText = document.getElementById("progressText");
  const progressFill = document.getElementById("progressFill");

  let mode = "other";
  let items = [];

  /* ---------- helpers ---------- */

  function setStatus(text, color) {
    statusText.textContent = text;
    statusDot.style.background = color;
  }

  function getToken(interactive) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(
        { action: "get_token", interactive: !!interactive },
        function (res) {
          if (res && res.success) resolve(res.token);
          else reject();
        }
      );
    });
  }

  function parseTimeRange(str) {
    if (!str) return null;

    const m = str.match(
      /(\d{1,2}):(\d{2})\s*(AM|PM)?\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i
    );
    if (!m) return null;

    function to24(h, mi, ap) {
      h = Number(h);
      mi = Number(mi);
      if (ap) {
        ap = ap.toUpperCase();
        if (ap === "PM" && h !== 12) h += 12;
        if (ap === "AM" && h === 12) h = 0;
      }
      return { h: h, m: mi };
    }

    return {
      start: to24(m[1], m[2], m[3]),
      end: to24(m[4], m[5], m[6])
    };
  }

  async function getActiveTabData(action) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs.length) return null;

    return new Promise(function (resolve) {
      chrome.tabs.sendMessage(tabs[0].id, { action: action }, function (resp) {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(resp);
      });
    });
  }

  /* ---------- render ---------- */

  function renderDashboard(sessions) {
    list.innerHTML = "";
    items = [];

    syncBtn.disabled = false;
    syncBtn.style.display = "inline-block";

    if (!sessions || !sessions.length) {
      list.textContent = "No sessions found for today.";
      return;
    }

    sessions.forEach(function (s) {
      const d = document.createElement("div");
      d.className = "session";
      d.innerHTML =
        '<div class="title">' +
        s.title +
        "</div>" +
        '<div class="meta">' +
        s.timeText +
        " · " +
        (s.location ? s.location : "Online") +
        "</div>";
      list.appendChild(d);

      items.push({
        summary: s.title,
        time: s.timeText,
        date: s.date,
        location: s.location || ""
      });
    });
  }

  function renderTimetable(events) {
    list.innerHTML = "";
    items = events || [];

    syncBtn.disabled = false;
    syncBtn.style.display = "inline-block";

    if (!items.length) {
      list.textContent = "No timetable entries found.";
      return;
    }

    items.forEach(function (e, i) {
      const d = document.createElement("div");
      d.className = "session";
      d.innerHTML =
        '<label>' +
        '<input type="checkbox" data-idx="' +
        i +
        '">' +
        '<div class="title">' +
        e.subject +
        "</div>" +
        '<div class="meta">' +
        e.date +
        " · " +
        e.time +
        " · " +
        (e.location ? e.location : "Online") +
        "</div>" +
        "</label>";
      list.appendChild(d);
    });
  }

  /* ---------- calendar sync ---------- */

  async function syncCalendar() {
    const selected =
      mode === "timetable"
        ? Array.from(list.querySelectorAll("input:checked")).map(function (cb) {
            return items[cb.dataset.idx];
          })
        : items;

    if (!selected.length) return;

    progressWrap.style.display = "block";
    progressFill.style.width = "0%";
    progressText.textContent = "";

    let token;
    try {
      token = await getToken(false);
    } catch {
      setStatus("Auth failed", "#c03");
      return;
    }

    for (let i = 0; i < selected.length; i++) {
      const e = selected[i];
      progressText.textContent =
        "Syncing " + (i + 1) + " / " + selected.length;
      progressFill.style.width =
        ((i + 1) / selected.length) * 100 + "%";

      const tr = parseTimeRange(e.time);
      if (!tr) continue;

      const d = new Date(e.date);
      const start = new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
        tr.start.h,
        tr.start.m
      );
      const end = new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
        tr.end.h,
        tr.end.m
      );

      await fetch(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            summary: e.summary || e.subject,
            location: e.location || "",
            start: {
              dateTime: start.toISOString(),
              timeZone: "Asia/Kolkata"
            },
            end: {
              dateTime: end.toISOString(),
              timeZone: "Asia/Kolkata"
            }
          })
        }
      );
    }

    progressText.textContent = "Calendar synced";
    setStatus("Connected", "#2a9d3a");
  }

  /* ---------- wiring ---------- */

  connectBtn.onclick = async function () {
    setStatus("Connecting…", "#999");
    try {
      await getToken(true);
      setStatus("Connected", "#2a9d3a");
    } catch {
      setStatus("Auth failed", "#c03");
    }
  };

  syncBtn.onclick = syncCalendar;

  /* ---------- init ---------- */

  (async function init() {
    try {
      await getToken(false);
      setStatus("Connected", "#2a9d3a");
    } catch {
      setStatus("Not connected", "#c03");
    }

    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    const url = tabs[0] && tabs[0].url ? tabs[0].url : "";

    if (url.includes("/student/home/dashboard")) {
      mode = "dashboard";
      pageTitle.textContent = "Dashboard";
      pageLabel.textContent = "Today's sessions";
      const r = await getActiveTabData("getDashboardSessions");
      renderDashboard(r && r.sessions);
    } else if (url.includes("/student/curriculum-scheduling")) {
      mode = "timetable";
      pageTitle.textContent = "Timetable";
      pageLabel.textContent = "Select classes to sync";
      const r = await getActiveTabData("getTimetableEvents");
      renderTimetable(r && r.events);
    } else {
      pageTitle.textContent = "TimePort UPES";
      pageLabel.textContent = "Open Dashboard or Timetable";
      syncBtn.style.display = "none";
    }
  })();
});
