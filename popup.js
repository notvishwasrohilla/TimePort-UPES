// popup.js — STEP 1 (UI + button visibility only)

document.addEventListener("DOMContentLoaded", () => {
  const statusText = document.getElementById("status");
  const statusDot = document.getElementById("statusDot");

  const connectBtn = document.getElementById("connectBtn");
  const disconnectBtn = document.getElementById("disconnectBtn");
  const syncBtn = document.getElementById("syncBtn");

  const list = document.getElementById("list");
  const pageTitle = document.getElementById("pageTitle");
  const pageLabel = document.getElementById("pageLabel");

  let pageMode = "unknown";
  let items = [];

  /* ---------------- helpers ---------------- */

  function setStatus(text, color) {
    statusText.textContent = text;
    statusDot.style.background = color;
  }

  function safeMessage(tabId, msg) {
    return new Promise(resolve => {
      chrome.tabs.sendMessage(tabId, msg, resp => {
        if (chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(resp);
        }
      });
    });
  }

  /* ---------------- renderers ---------------- */

  function renderDashboard(sessions) {
    list.innerHTML = "";
    items = sessions || [];

    syncBtn.style.display = "inline-block";
    syncBtn.disabled = !items.length;

    if (!items.length) {
      list.textContent = "No sessions found for today.";
      return;
    }

    items.forEach(s => {
      const d = document.createElement("div");
      d.className = "session";
      d.innerHTML = `
        <div class="title">${s.title}</div>
        <div class="meta">${s.timeText} · ${s.room || "-"}</div>
      `;
      list.appendChild(d);
    });
  }

  function renderTimetable(events) {
    list.innerHTML = "";
    items = events || [];

    syncBtn.style.display = "inline-block";
    syncBtn.disabled = !items.length;

    if (!items.length) {
      list.textContent = "No timetable entries found.";
      return;
    }

    items.forEach((e, i) => {
      const d = document.createElement("div");
      d.className = "session";
      d.innerHTML = `
        <label>
          <input type="checkbox" data-idx="${i}">
          <div class="title">${e.subject}</div>
          <div class="meta">${e.date || ""} · ${e.time} · ${e.room || "-"}</div>
        </label>
      `;
      list.appendChild(d);
    });
  }

  /* ---------------- auth UI (visual only for now) ---------------- */

  function initAuthUI() {
    chrome.runtime.sendMessage({ action: "get_token", interactive: false }, r => {
      if (r && r.success) {
        setStatus("Connected", "#2a9d3a");
        connectBtn.style.display = "none";
        disconnectBtn.style.display = "none";
      } else {
        setStatus("Not connected", "#c03");
        connectBtn.style.display = "inline-block";
        disconnectBtn.style.display = "none";
      }
    });
  }

  /* ---------------- page detection ---------------- */

  setStatus("Detecting page…", "#999");

  chrome.tabs.query({ active: true, currentWindow: true }, async tabs => {
    if (!tabs || !tabs.length) {
      setStatus("No active tab", "#c03");
      return;
    }

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
      pageTitle.textContent = "TimePort UPES";
      pageLabel.textContent = "Open Dashboard or Timetable";

      list.textContent = "";
      syncBtn.style.display = "none";
      setStatus("Unsupported page", "#c03");
    }
  });

  initAuthUI();

  /* ---------------- placeholder (no-op for now) ---------------- */

  syncBtn.onclick = () => {
    // Step 2 will implement actual syncing
    alert("Calendar sync will be implemented in the next step.");
  };
});
