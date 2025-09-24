// content_script.js
(function(){

  // Utility: parse time string like "08:00 AM - 08:55 AM"
  function parseTimeRange(timeStr) {
    // normalize whitespace
    timeStr = timeStr.trim();
    const parts = timeStr.split('-').map(s => s.trim());
    if (parts.length !== 2) return null;
    return { start: parts[0], end: parts[1] }; // e.g. "08:00 AM"
  }

  // Convert a date (Date object with local date) and hh:mm AM/PM -> ISO string in UTC YYYYMMDDTHHMMSSZ
  function localDateTimeToUTCString(dateObj, hhmmAMPM) {
    // hhmmAMPM e.g. "08:00 AM"
    const m = hhmmAMPM.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) return null;
    let hour = parseInt(m[1], 10);
    const minute = parseInt(m[2], 10);
    const ampm = m[3].toUpperCase();
    if (ampm === 'PM' && hour !== 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;

    // create a new Date for the same local date with parsed hour/minute
    const local = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), hour, minute, 0, 0);
    // to UTC components
    const YYYY = local.getUTCFullYear();
    const MM = String(local.getUTCMonth() + 1).padStart(2, '0');
    const DD = String(local.getUTCDate()).padStart(2, '0');
    const hh = String(local.getUTCHours()).padStart(2, '0');
    const mm = String(local.getUTCMinutes()).padStart(2, '0');
    const ss = String(local.getUTCSeconds()).padStart(2, '0');

    return `${YYYY}${MM}${DD}T${hh}${mm}${ss}Z`;
  }

  // Build Google Calendar create-event URL with prefilled data
  function buildGoogleCalendarUrl({title, details, location, startISOutc, endISOutc}) {
    const base = 'https://calendar.google.com/calendar/u/0/r/eventedit';
    const params = new URLSearchParams();
    params.set('text', title || '');
    if (details) params.set('details', details);
    if (location) params.set('location', location);
    // Google expects dates param as start/end local-ish format if provided as "dates"
    // We'll set "dates" in UTC form: YYYYMMDDTHHMMSSZ/YYYYMMDDTHHMMSSZ
    params.set('dates', `${startISOutc}/${endISOutc}`);
    return `${base}?${params.toString()}`;
  }

  // Main parser: finds li.course-red-wrapper elements inside the "Today's Sessions" panel
  function findSessionsInDOM() {
    const nodes = Array.from(document.querySelectorAll('li.course-red-wrapper'));
    const today = new Date(); // uses user's local timezone (browser)
    const sessions = nodes.map(node => {
      const titleEl = node.querySelector('b');
      const title = titleEl ? titleEl.textContent.trim() : 'Untitled Session';

      // time string is inside a <p> (example shows " 08:00 AM - 08:55 AM ")
      const p = node.querySelector('p');
      const timeText = p ? p.textContent.trim() : '';
      const timeRange = parseTimeRange(timeText);

      // session link if any
      const linkEl = node.querySelector('a.session-link');
      const joinUrl = linkEl ? linkEl.href : '';

      // small description/span text (course code)
      const span = node.querySelector('span');
      const code = span ? span.textContent.trim() : '';

      // location classification: virtual vs classroom: check .venue-category or border-left color fallback
      // We'll put the joinUrl into location if present
      return {
        title,
        code,
        timeText,
        start: timeRange ? timeRange.start : null,
        end: timeRange ? timeRange.end : null,
        joinUrl
      };
    }).filter(s => s.title); // keep those with title
    return { sessions, date: today };
  }

  // Add a small "Add to Google Calendar" button near each session node
  function injectButtons() {
    const { sessions } = findSessionsInDOM();
    const nodes = Array.from(document.querySelectorAll('li.course-red-wrapper'));
    if (nodes.length === 0) return;

    nodes.forEach((node, idx) => {
      // Avoid injecting twice
      if (node.querySelector('.timeport-add-btn')) return;

      const sess = sessions[idx];
      const btn = document.createElement('button');
      btn.className = 'timeport-add-btn';
      btn.textContent = '➕ Add to Google Calendar';
      btn.style.cssText = `
        margin-left:8px;
        padding:6px 8px;
        font-size:12px;
        cursor:pointer;
        border-radius:4px;
        border: 1px solid #1a73e8;
        background: white;
        color: #1a73e8;
      `;

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        addSingleSessionToCalendar(sess);
      });

      // find where to append: either the <p> or node itself
      const p = node.querySelector('p');
      if (p) {
        p.appendChild(btn);
      } else {
        node.appendChild(btn);
      }
    });

    // Floating "Add all" button
    if (!document.querySelector('#timeport-add-all')) {
      const floatBtn = document.createElement('button');
      floatBtn.id = 'timeport-add-all';
      floatBtn.textContent = 'Add all today → Google Calendar';
      floatBtn.style.cssText = `
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        padding: 10px 14px;
        background: #0b63d5;
        color: white;
        font-weight: 600;
        border: none;
        border-radius: 8px;
        box-shadow: 0 6px 18px rgba(11,99,213,.2);
        cursor: pointer;
      `;
      floatBtn.addEventListener('click', () => {
        // send sessions to popup flow: we will open the extension popup page for bulk options
        // But since content scripts can't open extension popup, instead we open a tab with prefilled data via URL
        // We'll open a small chooser window: generate and open a multi-event flow by opening Google Calendar event edit for first event
        addAllSessionsToCalendar();
      });
      document.body.appendChild(floatBtn);
    }
  }

  // Create google calendar URL and open in new tab for a single session
  function addSingleSessionToCalendar(sess) {
    const today = new Date();
    if (!sess.start || !sess.end) {
      alert('Could not parse time for this session. Maybe the format is different.');
      return;
    }
    const startISO = localDateTimeToUTCString(today, sess.start);
    const endISO = localDateTimeToUTCString(today, sess.end);
    const details = `${sess.code || ''}\nJoin URL: ${sess.joinUrl || 'N/A'}`;
    const url = buildGoogleCalendarUrl({
      title: sess.title,
      details: details,
      location: sess.joinUrl || '',
      startISOutc: startISO,
      endISOutc: endISO
    });
    window.open(url, '_blank');
  }

  // For "Add all": we open separate Google Calendar tabs (one per session), with a small delay to avoid popup blockers
  function addAllSessionsToCalendar() {
    const { sessions, date } = findSessionsInDOM();
    if (!sessions || sessions.length === 0) {
      alert('No sessions found on this page.');
      return;
    }
    const confirmMsg = `Add ${sessions.length} session(s) from today to Google Calendar? Each will open in a new tab for confirmation.`;
    if (!confirm(confirmMsg)) return;

    sessions.forEach((sess, i) => {
      if (!sess.start || !sess.end) {
        console.warn('Skipping session with unparsable time:', sess);
        return;
      }
      const startISO = localDateTimeToUTCString(date, sess.start);
      const endISO = localDateTimeToUTCString(date, sess.end);
      const details = `${sess.code || ''}\nJoin URL: ${sess.joinUrl || 'N/A'}`;
      const url = buildGoogleCalendarUrl({
        title: sess.title,
        details: details,
        location: sess.joinUrl || '',
        startISOutc: startISO,
        endISOutc: endISO
      });

      // open with a small stagger to avoid being blocked
      setTimeout(() => window.open(url, '_blank'), i * 350);
    });
  }

  // Observe DOM for changes (single-page apps) and inject when timetable appears
  function watchForTimetable() {
    const observer = new MutationObserver((mutations) => {
      // small throttle: only run injectButtons once per mutation batch
      injectButtons();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // initial try
    setTimeout(injectButtons, 800);
  }

  // Kick off
  try {
    watchForTimetable();
  } catch (e) {
    console.error('TimePort content script error:', e);
  }
})();
