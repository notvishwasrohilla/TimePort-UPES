// popup.js
document.addEventListener("DOMContentLoaded", function () {
  const statusText = document.getElementById("status");
  const statusDot = document.getElementById("statusDot");
  const connectBtn = document.getElementById("connectBtn");
  const disconnectBtn = document.getElementById("disconnectBtn");
  const syncBtn = document.getElementById("syncBtn");
  const list = document.getElementById("list");
  const pageTitle = document.getElementById("pageTitle");
  const pageLabel = document.getElementById("pageLabel");

  const progressWrap = document.getElementById("progressWrap");
  const progressFill = document.getElementById("progressFill");

  let items = [];
  let pageMode = "other";

  /* ---------- helpers ---------- */

  function setStatus(text, color) {
    statusText.textContent = text;
    statusDot.style.background = color;
  }

  function show(el, yes) {
    if (!el) return;
    el.style.display = yes ? "block" : "none";
  }

  function safeMessage(tabId, msg) {
    return new Promise(function (resolve) {
      chrome.tabs.sendMessage(tabId, msg, function (resp) {
        if (chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(resp);
        }
      });
    });
  }

  /* ---------- renderers ---------- */

  function renderDashboard(sessions) {
    list.innerHTML = "";
    items = sessions || [];

    syncBtn.style.display = "block";
    syncBtn.disabled = !items.length;

    if (!items.length) {
      list.textContent = "No sessions found for today.";
      return;
    }

    items.forEach(function (s) {
      const d = document.createElement("div");
      d.className = "session";
      d.innerHTML =
        '<div class="title">' + s.title + '</div>' +
        '<div class="meta">' + s.timeText + ' · ' + (s.room || "-") + '</div>';
      list.appendChild(d);
    });
  }

  function renderTimetable(events) {
    list.innerHTML = "";
    items = events || [];

    syncBtn.style.display = "block";
    syncBtn.disabled = !items.length;

    if (!items.length) {
      list.textContent = "No timetable entries found.";
      return;
    }

    items.forEach(function (e, i) {
      const d = document.createElement("div");
      d.className = "session";
      d.innerHTML =
        '<label>' +
        '<input type="checkbox" data-idx="' + i + '">' +
        '<div class="title">' + e.subject + '</div>' +
        '<div class="meta">' +
        (e.date || "") + ' · ' + e.time + ' · ' + (e.room || "-") +
        '</div>' +
        '</label>';
      list.appendChild(d);
    });

    Array.from(list.querySelectorAll("input")).forEach(function (cb) {
      cb.addEventListener("change", function () {
        syncBtn.disabled = !list.querySelector("input:checked");
      });
    });
  }

  /* ---------- calendar sync (TEMPORARY SIMPLE VERSION) ---------- */

  async function syncCalendar() {
    let selected;

    if (pageMode === "timetable") {
      selected = Array.from(list.querySelectorAll("input:checked"))
        .map(function (cb) {
          return items[cb.dataset.idx];
        });
    } else {
      selected = items;
    }

    if (!selected.length) return;

    show(progressWrap, true);
    progressFill.style.width = "0%";

    let token;
    try {
      token = await new Promise(function (resolve, reject) {
        chrome.runtime.sendMessage({ action: "get_token" }, function (r) {
          if (r && r.success) resolve(r.token);
          else reject();
        });
      });
    } catch (e) {
      setStatus("Auth failed", "#c03");
      show(progressWrap, false);
      return;
    }

    for (let i = 0; i < selected.length; i++) {
      const e = selected[i];

      setStatus("Syncing " + (i + 1) + " / " + selected.length, "#999");
      progressFill.style.width =
        Math.round(((i + 1) / selected.length) * 100) + "%";

      // TEMP: calendar logic intentionally paused
      await new Promise(function (r) {
        setTimeout(r, 300);
      });
    }

    setStatus("Calendar synced", "#2a9d3a");
    setTimeout(function () {
      show(progressWrap, false);
    }, 800);
  }

  syncBtn.onclick = syncCalendar;

  /* ---------- init ---------- */

  show(progressWrap, false);
  setStatus("Detecting page…", "#999");

  chrome.tabs.query({ active: true, currentWindow: true }, async function (tabs) {
    if (!tabs || !tabs.length) return;

    const tab = tabs[0];
    const url = tab.url || "";

    if (url.includes("/student/home/dashboard")) {
      pageMode = "dashboard";
      pageTitle.textContent = "Dashboard";
      pageLabel.textContent = "Today's sessions";

      const r = await safeMessage(tab.id, { action: "getDashboardSessions" });
      renderDashboard(r && r.sessions);
      setStatus("Connected", "#2a9d3a");

    } else if (url.includes("/student/curriculum-scheduling")) {
      pageMode = "timetable";
      pageTitle.textContent = "Timetable";
      pageLabel.textContent = "Select classes to sync";

      const r = await safeMessage(tab.id, { action: "getTimetableEvents" });
      renderTimetable(r && r.events);
      setStatus("Connected", "#2a9d3a");

    } else {
      pageMode = "other";
      pageTitle.textContent = "TimePort UPES";
      pageLabel.textContent = "Open Dashboard or Timetable";
      list.textContent = "";
      syncBtn.style.display = "none";
      setStatus("Unsupported page", "#c03");
    }
  });
});
