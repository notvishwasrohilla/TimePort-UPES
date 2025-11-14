document.addEventListener("DOMContentLoaded", () => {
  const connectBtn = document.getElementById("connectBtn"),
        syncBtn = document.getElementById("syncBtn"),
        disconnectBtn = document.getElementById("disconnectBtn"),
        statusDot = document.getElementById("statusDot"),
        statusText = document.getElementById("status"),
        list = document.getElementById("list"),
        result = document.getElementById("result"),
        progressContainer = document.getElementById("progressContainer"),
        progressBar = document.getElementById("progressBar");

  const setStatus = (t, c = "#666") => { statusText.textContent = t; statusDot.style.background = c; };
  const show = (el, vis) => el.style.display = vis ? "inline-block" : "none";

  // Progress helpers
  function showProgress() {
    progressContainer.style.display = "block";
    progressBar.style.width = "0%";
  }
  function setProgress(percent) {
    progressBar.style.width = Math.max(0, Math.min(100, percent)) + "%";
  }
  function hideProgress() {
    // small delay so final width animation is visible
    setTimeout(() => {
      progressBar.style.width = "0%";
      progressContainer.style.display = "none";
    }, 300);
  }

  // OAuth helpers (bridge to background)
  async function getToken(interactive = true) {
    return new Promise((res, rej) => {
      chrome.runtime.sendMessage({ action: "get_token" }, r => {
        if (!r || !r.success) rej(new Error(r ? r.error : "no token"));
        else res(r.token);
      });
    });
  }
  async function getUser(token) {
    const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${token}` }});
    return await r.json();
  }
  async function revoke(token) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, { method: "POST" });
    chrome.identity.removeCachedAuthToken({ token });
  }

  // Timetable retrieval
  async function getTimetable() {
    return new Promise(r => {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (!tabs.length) return r({ sessions: [], error: "no tab" });
        chrome.tabs.sendMessage(tabs[0].id, { action: "getTimetable" }, resp => {
          r(resp || { sessions: [] });
        });
      });
    });
  }

  // Render sessions in popup
  function render(sessions) {
    list.innerHTML = "";
    if (!sessions.length) { list.textContent = "No sessions found."; return; }
    sessions.forEach(s => {
      const d = document.createElement("div");
      d.className = "session";
      d.innerHTML = `<div class="title">${s.title}</div>
                     <div class="meta"><span>${s.timeText || ""}</span><span>Room: ${s.room || "-"}</span></div>`;
      list.appendChild(d);
    });
  }

  // Time parsing helper
  function parseTime(str) {
    const m = str.match(/(\d+):(\d+)\s*(AM|PM)/i);
    let h = +m[1]; const mi = +m[2]; const ampm = m[3].toUpperCase();
    if (ampm === "PM" && h !== 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    return { h, mi };
  }

  // Sync with progress bar
  async function syncCalendar() {
    result.textContent = "";
    setStatus("Preparing sync...", "#999");
    const { sessions } = await getTimetable();
    if (!sessions || !sessions.length) {
      setStatus("No sessions found", "#c03");
      return;
    }

    // show progress bar and prepare
    showProgress();
    show(connectBtn, false); // hide connect while syncing
    let token;
    try { token = await getToken(false); if(!token) throw new Error("interactive required"); }
    catch { try { token = await getToken(true); } catch (e) { setStatus("Auth failed", "#c03"); hideProgress(); return; } }

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
    let created = 0, failed = 0;
    const total = sessions.length;

    for (let i = 0; i < total; ++i) {
      const s = sessions[i];
      // update progress visually (attempted item)
      setProgress(Math.round(((i) / total) * 100));
      const match = (s.timeText || "").match(/(\d{1,2}:\d{2}\s*(?:AM|PM))\s*-\s*(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
      if (!match) { failed++; continue; }
      const [_, st, et] = match;
      const ns = new Date(), a = parseTime(st), b = parseTime(et);
      const start = new Date(ns.getFullYear(), ns.getMonth(), ns.getDate(), a.h, a.mi);
      const end = new Date(ns.getFullYear(), ns.getMonth(), ns.getDate(), b.h, b.mi);

      const ev = {
        summary: s.title,
        location: s.room || "",
        description: (s.courseLine || "").split("_")[0],
        start: { dateTime: start.toISOString(), timeZone: tz },
        end: { dateTime: end.toISOString(), timeZone: tz }
      };

      // show in status which event we are creating
      setStatus(`Creating event ${i + 1}/${total}: ${ev.summary}`, "#006097");

      try {
        const resp = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(ev)
        });
        if (resp.ok) created++; else failed++;
      } catch (e) {
        failed++;
      }

      // update progress to include current item completion
      setProgress(Math.round(((i + 1) / total) * 100));
      // polite small delay so UX is smoother
      await new Promise(r => setTimeout(r, 220));
    }

    // final summary and cleanup
    const msg = `Sync complete — ${created} created, ${failed} failed.`;
    result.textContent = msg;
    setStatus("Connected", "#2a9d3a");
    // briefly show full bar then hide
    setProgress(100);
    await new Promise(r => setTimeout(r, 350));
    hideProgress();
  }

  // UI wiring
  connectBtn.onclick = async () => {
    setStatus("Connecting…", "#999"); connectBtn.disabled = true;
    try {
      const t = await getToken(true);
      const u = await getUser(t);
      setStatus(`Connected as ${u.email}`, "#2a9d3a");
      show(connectBtn, false); show(disconnectBtn, true); syncBtn.disabled = false;
    } catch (e) {
      setStatus("Auth failed", "#c03"); connectBtn.disabled = false;
    }
  };

  disconnectBtn.onclick = async () => {
    try { const t = await getToken(false); await revoke(t); } catch (e) { /* ignore */ }
    show(connectBtn, true); show(disconnectBtn, false); syncBtn.disabled = true;
    setStatus("Disconnected", "#c03");
  };

  syncBtn.onclick = syncCalendar;

  // init: show sessions and connection state
  (async function init() {
    const { sessions } = await getTimetable();
    render(sessions);
    try {
      const t = await getToken(false);
      if (t) {
        setStatus("Connected", "#2a9d3a");
        show(connectBtn, false);
        show(disconnectBtn, true);
        syncBtn.disabled = false;
      }
    } catch (e) {
      setStatus("Not connected", "#c03");
      show(connectBtn, true);
    }
  })();

  // live updates: refresh list when content script notifies
  chrome.runtime.onMessage.addListener(m => {
    if (m.action === "timetableUpdated") getTimetable().then(r => render(r.sessions));
  });

});
