// popup.js
document.addEventListener("DOMContentLoaded", () => {
  const statusText = document.getElementById("status");
  const statusDot = document.getElementById("statusDot");
  const connectBtn = document.getElementById("connectBtn");
  const disconnectBtn = document.getElementById("disconnectBtn");
  const syncBtn = document.getElementById("syncBtn");
  const list = document.getElementById("list");
  const pageTitle = document.getElementById("pageTitle");
  const pageLabel = document.getElementById("pageLabel");

  let items = [];

  function setStatus(t, c) {
    statusText.textContent = t;
    statusDot.style.background = c;
  }

  function safeMessage(tabId, msg) {
    return new Promise(res => {
      chrome.tabs.sendMessage(tabId, msg, r => {
        if (chrome.runtime.lastError) return res(null);
        res(r);
      });
    });
  }

  function renderDashboard(sessions) {
    list.innerHTML = "";
    syncBtn.style.display = "none";

    if (!sessions || !sessions.length) {
      list.textContent = "No sessions found for today.";
      return;
    }

    sessions.forEach(s => {
      const d = document.createElement("div");
      d.className = "session";
      d.innerHTML =
        `<div class="title">${s.title}</div>` +
        `<div class="meta">${s.timeText} · ${s.room || "-"}</div>`;
      list.appendChild(d);
    });
  }

  function renderTimetable(events) {
    list.innerHTML = "";
    items = events || [];
    syncBtn.style.display = "inline-block";
    syncBtn.disabled = true;

    if (!items.length) {
      list.textContent = "No timetable entries found.";
      return;
    }

    items.forEach((e, i) => {
      const d = document.createElement("div");
      d.className = "session";
      d.innerHTML =
        `<label>
          <input type="checkbox" data-idx="${i}">
          <div class="title">${e.subject}</div>
          <div class="meta">${e.date} · ${e.time} · ${e.room || "-"}</div>
        </label>`;
      list.appendChild(d);
    });

    list.querySelectorAll("input").forEach(cb =>
      cb.addEventListener("change", () => {
        syncBtn.disabled = !list.querySelector("input:checked");
      })
    );
  }

  /* ---------------- PAGE DETECTION ---------------- */

  setStatus("Detecting page…", "#999");

  chrome.tabs.query({ active: true, currentWindow: true }, async tabs => {
    const tab = tabs[0];
    if (!tab) return;

    const url = tab.url || "";

    if (url.includes("/student/home/dashboard")) {
      pageTitle.textContent = "Dashboard";
      pageLabel.textContent = "Today's sessions";

      const r = await safeMessage(tab.id, { action: "getDashboardSessions" });
      renderDashboard(r?.sessions);
      setStatus("Connected", "#2a9d3a");

    } else if (url.includes("/student/curriculum-scheduling")) {
      pageTitle.textContent = "Timetable";
      pageLabel.textContent = "Select classes to sync";

      const r = await safeMessage(tab.id, { action: "getTimetableEvents" });
      renderTimetable(r?.events);
      setStatus("Connected", "#2a9d3a");

    } else {
      pageTitle.textContent = "TimePort UPES";
      pageLabel.textContent = "Open Dashboard or Timetable";
      list.textContent = "";
      syncBtn.style.display = "none";
      setStatus("Unsupported page", "#c03");
    }
  });
});
