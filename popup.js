document.addEventListener("DOMContentLoaded", () => {
  const statusText = document.getElementById("status");
  const statusDot = document.getElementById("statusDot");
  const connectBtn = document.getElementById("connectBtn");
  const disconnectBtn = document.getElementById("disconnectBtn");
  const list = document.getElementById("list");
  const pageTitle = document.getElementById("pageTitle");
  const pageLabel = document.getElementById("pageLabel");

  function setStatus(text, color) {
    statusText.textContent = text;
    statusDot.style.background = color;
  }

  function show(el, visible) {
    if (!el) return;
    el.style.display = visible ? "inline-block" : "none";
  }

  function getToken(interactive) {
    return new Promise((res, rej) => {
      chrome.runtime.sendMessage(
        { action: "get_token", interactive },
        r => (!r || !r.success) ? rej() : res(r.token)
      );
    });
  }

  function detectPageFromUrl(url) {
    if (url.includes("/student/home/dashboard")) return "dashboard";
    if (url.includes("/student/curriculum-scheduling")) return "timetable";
    return "other";
  }

  async function tryGetDashboardSessions(tabId) {
    return new Promise(resolve => {
      chrome.tabs.sendMessage(
        tabId,
        { action: "getDashboardSessions" },
        r => {
          if (chrome.runtime.lastError) return resolve([]);
          resolve(r?.sessions || []);
        }
      );
    });
  }

  function renderSessions(sessions) {
    list.innerHTML = "";
    if (!sessions.length) {
      list.textContent = "No sessions found.";
      return;
    }

    sessions.forEach(s => {
      const d = document.createElement("div");
      d.className = "session";
      d.innerHTML = `
        <div class="title">${s.title}</div>
        <div class="meta">
          <span>${s.timeText}</span>
          <span>Room: ${s.room || "-"}</span>
        </div>
      `;
      list.appendChild(d);
    });
  }

  async function initAuth() {
    try {
      await getToken(false);
      setStatus("Connected", "#2a9d3a");
      show(connectBtn, false);
      show(disconnectBtn, true);
    } catch {
      setStatus("Not connected", "#c03");
      show(connectBtn, true);
      show(disconnectBtn, false);
    }
  }

  async function initPage() {
    chrome.tabs.query({ active: true, currentWindow: true }, async tabs => {
      if (!tabs.length) return;

      const tab = tabs[0];
      const mode = detectPageFromUrl(tab.url || "");

      if (mode === "dashboard") {
        pageTitle.textContent = "Dashboard";
        pageLabel.textContent = "UPES · Today’s Sessions";

        const sessions = await tryGetDashboardSessions(tab.id);
        renderSessions(sessions);
      }
      else if (mode === "timetable") {
        pageTitle.textContent = "Timetable";
        pageLabel.textContent = "UPES · Monthly Timetable";
        list.textContent = "Timetable scraping will be added next.";
      }
      else {
        pageTitle.textContent = "TimePort UPES";
        pageLabel.textContent = "Open Dashboard or Timetable page";
        list.textContent = "";
      }
    });
  }

  connectBtn.onclick = async () => {
    setStatus("Connecting…", "#999");
    try {
      await getToken(true);
      initAuth();
    } catch {
      setStatus("Auth failed", "#c03");
    }
  };

  disconnectBtn.onclick = async () => {
    try {
      const t = await getToken(false);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${t}`, { method: "POST" });
      chrome.identity.removeCachedAuthToken({ token: t });
    } catch {}
    initAuth();
  };

  initAuth();
  initPage();
});
