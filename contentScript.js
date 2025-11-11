// contentScript.js - parse timetable sessions and keep them updated
(() => {
  function parseSessions() {
    const listItems = Array.from(document.querySelectorAll('.session-info-container ul li.course-red-wrapper'));
    const sessions = listItems.map(li => {
      const titleNode = li.querySelector('b');
      const codeNode = li.querySelector('span[style]');
      const p = li.querySelector('p');
      const roomNode = li.querySelector('.session-venue-info b');

      const title = titleNode ? titleNode.textContent.trim() : '';
      const courseLine = codeNode ? codeNode.textContent.trim() : '';

      // Time extraction
      let timeText = '';
      if (p) {
        timeText = (p.firstChild && p.firstChild.nodeType === Node.TEXT_NODE)
          ? p.firstChild.nodeValue.trim()
          : p.textContent.trim();
        timeText = timeText.replace(/\s+/g, ' ').trim();
      }

      let startTime = null, endTime = null;
      const timeMatch = timeText.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))\s*-\s*(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
      if (timeMatch) {
        startTime = timeMatch[1];
        endTime = timeMatch[2];
      }

      // Normalize room (e.g., "11118(11118)" -> "11118")
      let roomRaw = roomNode ? roomNode.textContent.trim() : '';
      let room = null;
      if (roomRaw) {
        const m = roomRaw.match(/^([^\s(]+)/);
        room = m ? m[1] : roomRaw;
        const digits = room.match(/\d+/);
        if (digits) room = digits[0];
      }

      return {
        title,
        courseLine,
        timeText,
        startTime,
        endTime,
        roomRaw,
        room
      };
    });
    return sessions;
  }

  window.__UPES_TIMETABLE = parseSessions();

  // Observe container to keep updated when page changes
  const container = document.querySelector('.session-info-container');
  if (container) {
    const obs = new MutationObserver(() => {
      window.__UPES_TIMETABLE = parseSessions();
      // for debugging:
      console.debug('UPES timetable updated', window.__UPES_TIMETABLE);
    });
    obs.observe(container, { childList: true, subtree: true, characterData: true });
  }

  // Respond to messages for immediate retrieval
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.action === 'getTimetable') {
      sendResponse({ sessions: window.__UPES_TIMETABLE || parseSessions() });
    }
  });

  console.debug('UPES content script loaded; initial sessions:', window.__UPES_TIMETABLE);
})();
