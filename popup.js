document.addEventListener("DOMContentLoaded", () => {

  const pageTitle = document.getElementById("pageTitle");
  const modeDashboard = document.getElementById("modeDashboard");
  const modeTimetable = document.getElementById("modeTimetable");

  const list = document.getElementById("list");
  const statusText = document.getElementById("status");
  const statusDot = document.getElementById("statusDot");

  /* -------------------- helpers -------------------- */

  function setStatus(text, color = "#666") {
    statusText.textContent = text;
    statusDot.style.background = color;
  }

  function clearModes() {
    modeDashboard.classList.remove("active");
    modeTimetable.classList.remove("active");
  }

  /* -------------------- PAGE DETECTION -------------------- */

  function detectPageFromUrl(url) {
    if (url.includes("/student/home/dashboard")) return "dashboard";
    if (url.includes("/student/curriculum-scheduling")) return "timetable";
    return "unknown";
  }

  function applyPageMode(mode) {
    clearModes();

    if (mode === "dashboard") {
      pageTitle.textContent = "Dashboard";
      modeDashboard.classList.add("active");
      setStatus("Dashboard detected", "#2a9d3a");
    }
    else if (mode === "timetable") {
      pageTitle.textContent = "Timetable";
      modeTimetable.classList.add("active");
      setStatus("Timetable detected", "#2a9d3a");
    }
    else {
      pageTitle.textContent = "TimePort UPES";
      setStatus("Unsupported page", "#c03");
    }
  }

  function detectAndApplyPage() {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (!tabs.length) return;
      const url = tabs[0].url || "";
      const mode = detectPageFromUrl(url);
      applyPageMode(mode);
    });
  }

  /* -------------------- TIMETABLE FETCH -------------------- */

  function getTimetable() {
    return new Promise(res => {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (!tabs.length) return res({ sessions: [] });

        chrome.tabs.sendMessage(
          tabs[0].id,
          { action: "getTimetable" },
          resp => {
            if (chrome.runtime.lastError) {
              return res({ sessions: [] });
            }
            res(resp || { sessions: [] });
          }
        );
      });
    });
  }

  function render(sessions) {
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
          <span>${s.timeText || ""}</span>
          <span>Room: ${s.room || "-"}</span>
        </div>
      `;
      list.appendChild(d);
    });
  }

  /* -------------------- INIT -------------------- */

  (async function init() {
    detectAndApplyPage();
    const { sessions } = await getTimetable();
    render(sessions);
  })();

  /* -------------------- LIVE UPDATES -------------------- */

  chrome.runtime.onMessage.addListener(msg => {
    if (msg.action === "timetableUpdated") {
      getTimetable().then(r => render(r.sessions));
    }
  });

});
