// popup.js
document.addEventListener('DOMContentLoaded', async () => {
  const sessionsListEl = document.getElementById('sessions-list');
  const addSelectedBtn = document.getElementById('add-selected');
  const addAllBtn = document.getElementById('add-all');

  // Injected function to run inside page to return session objects (same logic as content script)
  const extractSessionsFn = () => {
    function parseTimeRange(timeStr) {
      timeStr = (timeStr || '').trim();
      const parts = timeStr.split('-').map(s => s.trim());
      if (parts.length !== 2) return null;
      return { start: parts[0], end: parts[1] };
    }

    function gather() {
      const nodes = Array.from(document.querySelectorAll('li.course-red-wrapper'));
      const today = new Date();
      return nodes.map(node => {
        const titleEl = node.querySelector('b');
        const title = titleEl ? titleEl.textContent.trim() : 'Untitled Session';
        const p = node.querySelector('p');
        const timeText = p ? p.textContent.trim() : '';
        const timeRange = parseTimeRange(timeText);
        const linkEl = node.querySelector('a.session-link');
        const joinUrl = linkEl ? linkEl.href : '';
        const span = node.querySelector('span');
        const code = span ? span.textContent.trim() : '';
        return { title, code, timeText, start: timeRange ? timeRange.start : null, end: timeRange ? timeRange.end : null, joinUrl };
      });
    }
    return gather();
  };

  // Execute in active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    sessionsListEl.textContent = 'No active tab.';
    return;
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractSessionsFn
    });

    const sessions = (results && results[0] && results[0].result) || [];
    if (!sessions || sessions.length === 0) {
      sessionsListEl.innerHTML = '<div class="muted">No sessions found on this page. Make sure you are viewing the "Today\'s Sessions" tab on the portal.</div>';
      addSelectedBtn.disabled = true;
      addAllBtn.disabled = true;
      return;
    }

    // render checkboxes
    sessionsListEl.innerHTML = '';
    sessions.forEach((s, i) => {
      const div = document.createElement('div');
      div.className = 'session-item';
      div.innerHTML = `
        <input type="checkbox" data-idx="${i}" id="s_${i}" checked />
        <div style="flex:1">
          <div class="session-title">${escapeHtml(s.title)}</div>
          <div class="session-meta">${escapeHtml(s.timeText || '')} ${s.joinUrl ? ' • <a target="_blank" href="'+escapeAttr(s.joinUrl)+'">Join</a>' : ''}</div>
        </div>
      `;
      sessionsListEl.appendChild(div);
    });

    // helper to escape
    function escapeHtml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function escapeAttr(s){ return (s||'').replace(/"/g, '&quot;'); }

    // Build calendar URL function (same as content script but client-side)
    function localDateTimeToUTCString(dateObj, hhmmAMPM) {
      const m = hhmmAMPM.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (!m) return null;
      let hour = parseInt(m[1], 10);
      const minute = parseInt(m[2], 10);
      const ampm = m[3].toUpperCase();
      if (ampm === 'PM' && hour !== 12) hour += 12;
      if (ampm === 'AM' && hour === 12) hour = 0;
      const local = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), hour, minute, 0, 0);
      const YYYY = local.getUTCFullYear();
      const MM = String(local.getUTCMonth() + 1).padStart(2, '0');
      const DD = String(local.getUTCDate()).padStart(2, '0');
      const hh = String(local.getUTCHours()).padStart(2, '0');
      const mm = String(local.getUTCMinutes()).padStart(2, '0');
      const ss = String(local.getUTCSeconds()).padStart(2, '0');
      return `${YYYY}${MM}${DD}T${hh}${mm}${ss}Z`;
    }
    function buildGoogleCalendarUrl({title, details, location, startISOutc, endISOutc}) {
      const base = 'https://calendar.google.com/calendar/u/0/r/eventedit';
      const params = new URLSearchParams();
      params.set('text', title || '');
      if (details) params.set('details', details);
      if (location) params.set('location', location);
      params.set('dates', `${startISOutc}/${endISOutc}`);
      return `${base}?${params.toString()}`;
    }

    // add selected
    addSelectedBtn.addEventListener('click', async () => {
      const checkboxes = Array.from(document.querySelectorAll('#sessions-list input[type=checkbox]'));
      const chosenIdx = checkboxes.filter(cb => cb.checked).map(cb => parseInt(cb.dataset.idx,10));
      if (chosenIdx.length === 0) { alert('Select at least one session.'); return; }
      // we will open a tab per selected event
      chosenIdx.forEach((idx, i) => {
        const s = sessions[idx];
        if (!s.start || !s.end) {
          console.warn('Skipping unparsable time', s);
          return;
        }
        const startISO = localDateTimeToUTCString(new Date(), s.start);
        const endISO = localDateTimeToUTCString(new Date(), s.end);
        const details = `${s.code || ''}\nJoin URL: ${s.joinUrl || 'N/A'}`;
        const url = buildGoogleCalendarUrl({title: s.title, details, location: s.joinUrl || '', startISOutc: startISO, endISOutc: endISO});
        window.open(url, '_blank');
      });
    });

    addAllBtn.addEventListener('click', () => {
      sessions.forEach((s, i) => {
        if (!s.start || !s.end) return;
        const startISO = localDateTimeToUTCString(new Date(), s.start);
        const endISO = localDateTimeToUTCString(new Date(), s.end);
        const details = `${s.code || ''}\nJoin URL: ${s.joinUrl || 'N/A'}`;
        const url = buildGoogleCalendarUrl({title: s.title, details, location: s.joinUrl || '', startISOutc: startISO, endISOutc: endISO});
        setTimeout(() => window.open(url, '_blank'), i * 300);
      });
    });

  } catch (err) {
    sessionsListEl.innerHTML = '<div class="muted">Error extracting sessions. Make sure the portal is open in the active tab and you are on the "Today\'s Sessions" tab.</div>';
    console.error('popup error:', err);
  }
});
