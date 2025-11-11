// popup.js — Phase 2 visual improvements + auto-reconnect + courseLine cleaning
document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const connectBtn = document.getElementById('connectBtn');
  const disconnectBtn = document.getElementById('disconnectBtn');
  const syncBtn = document.getElementById('syncBtn');
  const showLocalBtn = document.getElementById('showLocalBtn');
  const statusDiv = document.getElementById('status');
  const listDiv = document.getElementById('list');
  const resultDiv = document.getElementById('result');
  const statusDot = document.getElementById('statusDot');

  // Basic safety
  if (!connectBtn || !syncBtn || !statusDiv || !statusDot) {
    console.error('popup: missing elements');
    return;
  }

  // config
  const RECONNECT_INTERVAL_MS = 45_000; // check every 45s
  let reconnectTimer = null;
  let lastKnownGood = false;

  // tiny UI helpers
  function setStatus(text) { statusDiv.textContent = text; }
  function setIndicator(color) {
    statusDot.style.background = color;
  }
  function showResult(text, isError=false) {
    resultDiv.textContent = text;
    resultDiv.style.color = isError ? '#a00' : '#070';
  }

  // --- courseLine cleaning: keep only course code before first underscore and remove +N ---
  function cleanCourseLine(raw) {
    if (!raw) return '';
    // remove +number tags e.g. " +1"
    let t = raw.replace(/\+\d+/g, '').trim();
    // take part before first underscore (if present)
    const parts = t.split('_');
    if (parts.length > 0) {
      // if first part looks like a code (has hyphens), return that
      return parts[0].trim();
    }
    return t;
  }

  // --- auth helpers (same as before) ---
  async function getAuthToken(interactive = true) {
    return new Promise((resolve, reject) => {
      try {
        chrome.identity.getAuthToken({ interactive }, (token) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(token);
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  async function fetchUserInfo(token) {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Failed fetching userinfo: ' + res.status);
    return res.json();
  }

  async function revokeToken(token) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, {
      method: 'POST',
      headers: { 'Content-type': 'application/x-www-form-urlencoded' }
    });
    return new Promise((resolve) => {
      chrome.identity.removeCachedAuthToken({ token }, () => resolve());
    });
  }

  // parse time helpers (same)
  function parseTime12h(str) {
    const m = (str || '').trim().match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) return null;
    let hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const ampm = m[3].toUpperCase();
    if (ampm === 'AM' && hh === 12) hh = 0;
    if (ampm === 'PM' && hh !== 12) hh += 12;
    return { hours: hh, minutes: mm };
  }
  function buildISOForToday(timeStr) {
    const t = parseTime12h(timeStr);
    if (!t) return null;
    const now = new Date();
    const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), t.hours, t.minutes, 0, 0);
    return dt.toISOString();
  }

  // fetch timetable from content script
  async function getTimetableFromActiveTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || tabs.length === 0) {
          resolve({ sessions: [], error: 'no-active-tab' });
          return;
        }
        chrome.tabs.sendMessage(tabs[0].id, { action: 'getTimetable' }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ sessions: [], error: chrome.runtime.lastError.message });
          } else {
            resolve(response || { sessions: [] });
          }
        });
      });
    });
  }

  // create calendar event (same as before)
  async function createCalendarEvent(token, event) {
    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(event)
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Calendar insert failed (${res.status}): ${txt}`);
    }
    return res.json();
  }

  // --- connection & auto-reconnect logic ---
  async function checkConnectionAndUpdate() {
    // Non-interactive check
    try {
      const token = await getAuthToken(false);
      if (!token) throw new Error('no-token');
      // test token by fetching userinfo
      await fetchUserInfo(token);
      // ok
      lastKnownGood = true;
      setIndicator('var(--success)');
      setStatus('Connected');
      connectBtn.disabled = true;
      disconnectBtn.style.display = 'inline-block';
      syncBtn.disabled = false;
      showResult('Connection healthy');
      return true;
    } catch (err) {
      console.warn('Connection check failed:', err && err.message);
      lastKnownGood = false;
      setIndicator('var(--warning)');
      setStatus('Connection lost — reconnecting...');
      // try a quick interactive reauth to recover
      try {
        const token2 = await getAuthToken(true);
        if (token2) {
          await fetchUserInfo(token2);
          lastKnownGood = true;
          setIndicator('var(--success)');
          setStatus('Reconnected');
          connectBtn.disabled = true;
          disconnectBtn.style.display = 'inline-block';
          syncBtn.disabled = false;
          showResult('Reconnected automatically');
          return true;
        }
      } catch (reauthErr) {
        console.warn('Auto reauth failed:', reauthErr && reauthErr.message);
        setIndicator('#c03');
        setStatus('Not connected');
        connectBtn.disabled = false;
        disconnectBtn.style.display = 'none';
        syncBtn.disabled = true;
        showResult('Connection lost — please reconnect manually', true);
        return false;
      }
    }
  }

  function startReconnectPolling() {
    if (reconnectTimer) return;
    reconnectTimer = setInterval(() => {
      checkConnectionAndUpdate().catch(err => console.warn('poll err', err));
    }, RECONNECT_INTERVAL_MS);
  }
  function stopReconnectPolling() {
    if (reconnectTimer) { clearInterval(reconnectTimer); reconnectTimer = null; }
  }

  // --- sync flow (uses cleaned courseLine) ---
  async function syncTimetableToCalendar() {
    showResult('');
    setStatus('Preparing sync...');
    syncBtn.disabled = true;
    connectBtn.disabled = true;

    const { sessions, error } = await getTimetableFromActiveTab();
    if (error) {
      showResult('Error reading timetable: ' + error, true);
      syncBtn.disabled = false;
      connectBtn.disabled = false;
      return;
    }
    if (!sessions || sessions.length === 0) {
      showResult('No sessions found on this page.', true);
      syncBtn.disabled = false;
      connectBtn.disabled = false;
      return;
    }

    // get token (try non-interactive then interactive)
    let token;
    try {
      token = await getAuthToken(false);
      if (!token) token = await getAuthToken(true);
    } catch (e) {
      showResult('Auth failed: ' + (e.message || e), true);
      syncBtn.disabled = false;
      connectBtn.disabled = false;
      return;
    }

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
    let successes = 0, failures = 0;
    const results = [];

    for (let i = 0; i < sessions.length; ++i) {
      const s = sessions[i];

      // Clean the courseLine for description (keep only code)
      const cleanedCourseCode = cleanCourseLine(s.courseLine);

      const startISO = buildISOForToday(s.startTime || (s.timeText ? s.timeText.split('-')[0].trim() : ''));
      const endISO = buildISOForToday(s.endTime || (s.timeText ? s.timeText.split('-')[1].trim() : ''));

      if (!startISO || !endISO) {
        failures++;
        results.push({ session: s, error: 'invalid time format' });
        continue;
      }

      const event = {
        summary: s.title || 'Class',
        location: s.room || s.roomRaw || '',
        description: cleanedCourseCode || s.courseLine || '',
        start: { dateTime: startISO, timeZone: tz },
        end: { dateTime: endISO, timeZone: tz }
      };

      try {
        setStatus(`Creating event ${i+1}/${sessions.length}: ${event.summary}`);
        const created = await createCalendarEvent(token, event);
        successes++;
        results.push({ session: s, created });
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        const msg = (err && err.message) ? err.message : String(err);
        console.warn('Event create error:', msg);
        if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
          // try clearing cached token once
          try {
            await new Promise(res => chrome.identity.removeCachedAuthToken({ token }, res));
            token = await getAuthToken(true);
            const created = await createCalendarEvent(token, event);
            successes++;
            results.push({ session: s, created });
            continue;
          } catch (retryErr) {
            failures++;
            results.push({ session: s, error: retryErr.message || String(retryErr) });
            continue;
          }
        } else {
          failures++;
          results.push({ session: s, error: msg });
        }
      }
    }

    setStatus(`Sync complete — ${successes} created, ${failures} failed.`);
    showResult(`Sync complete — ${successes} created, ${failures} failed.`);
    syncBtn.disabled = false;
    connectBtn.disabled = false;

    // show results in list
    listDiv.innerHTML = '';
    results.forEach(r => {
      const d = document.createElement('div');
      d.className = 'session';
      const t = document.createElement('div');
      t.className = 'title';
      t.textContent = r.session ? (r.session.title || r.session.timeText) : '(unknown)';
      const sdiv = document.createElement('div');
      sdiv.className = 'meta';
      sdiv.textContent = r.created ? `Created: ${r.created.summary || r.created.id}` : `Error: ${r.error}`;
      d.appendChild(t);
      d.appendChild(sdiv);
      listDiv.appendChild(d);
    });

    // store last sync results for debugging
    chrome.storage.local.set({ last_sync_results: results }, () => {});
  }

  // --- UI handlers ---
  connectBtn.addEventListener('click', async () => {
    setStatus('Opening Google sign-in...');
    connectBtn.disabled = true;
    try {
      const token = await getAuthToken(true);
      const user = await fetchUserInfo(token);
      chrome.storage.local.set({ oauth_token: token }, () => {});
      setStatus(`Connected as ${user.email}`);
      setIndicator('var(--success)');
      disconnectBtn.style.display = 'inline-block';
      syncBtn.disabled = false;
      showResult('Connected');
    } catch (err) {
      setStatus('Sign-in failed: ' + (err.message || err));
      setIndicator('#c03');
      connectBtn.disabled = false;
      showResult('Sign-in failed', true);
      console.error('Sign-in error:', err);
    }
  });

  disconnectBtn.addEventListener('click', async () => {
    setStatus('Signing out...');
    try {
      const token = await getAuthToken(false).catch(() => null);
      if (token) await revokeToken(token);
    } catch (e) {
      console.warn('Revoke error', e);
    } finally {
      chrome.storage.local.remove('oauth_token', () => {});
      setStatus('Not connected');
      setIndicator('#c03');
      connectBtn.disabled = false;
      disconnectBtn.style.display = 'none';
      syncBtn.disabled = true;
      showResult('Signed out');
    }
  });

  syncBtn.addEventListener('click', async () => {
    await syncTimetableToCalendar();
  });

  showLocalBtn.addEventListener('click', async () => {
    // show timetable when user clicks; but we also call this automatically on init
    listDiv.innerHTML = '';
    const { sessions, error } = await getTimetableFromActiveTab();
    if (error) {
      listDiv.textContent = 'No timetable found (content script missing or wrong page).';
      return;
    }
    if (!sessions.length) {
      listDiv.textContent = 'No sessions found on this page.';
      return;
    }
    sessions.forEach(s => {
      const wrapper = document.createElement('div');
      wrapper.className = 'session';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = s.title || '(no title)';
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.innerHTML = `<span>${s.timeText || ''}</span><span>Room: ${s.room || s.roomRaw || '-'}</span>`;
      wrapper.appendChild(title);
      wrapper.appendChild(meta);
      listDiv.appendChild(wrapper);
    });
  });

  // --- initialize ---
  (async function init() {
    // set neutral dot while checking
    setIndicator('#999');
    setStatus('Checking connection...');
    // try to verify connection & update UI
    await checkConnectionAndUpdateSafe();
    // automatically populate timetable on open
    await showLocalBtn.click();
    // start reconnect polling
    startReconnectPolling();
  })();

  // wrapper safe check to avoid unhandled rejections
  async function checkConnectionAndUpdateSafe() {
    try {
      return await checkConnectionAndUpdate();
    } catch (e) {
      console.warn('checkConnection error', e);
      setIndicator('#c03');
      setStatus('Not connected');
      connectBtn.disabled = false;
      syncBtn.disabled = true;
      return false;
    }
  }

  // Expose internals for debugging (optional)
  window._timeport = {
    getTimetableFromActiveTab,
    syncTimetableToCalendar,
    checkConnectionAndUpdate: checkConnectionAndUpdateSafe
  };
});
