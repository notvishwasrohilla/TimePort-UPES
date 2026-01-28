// content.js
function scrapeSchedule() {
  const sessions = [];
  
  // We target the list items inside the session container
  // Note: We use generic classes like .course-red-wrapper to avoid brittle ng-content attributes
  const items = document.querySelectorAll('.session-info-container li');

  if (!items.length) {
    return { error: "No session elements found. Make sure you are on the 'Today's Sessions' tab." };
  }

  items.forEach((li) => {
    try {
      // 1. Get Title (inside the <b> tag)
      const titleEl = li.querySelector('b');
      const title = titleEl ? titleEl.innerText.trim() : "Unknown Session";

      // 2. Get Time
      // The time is usually inside the <p> tag text content: " 01:00 PM - 01:55 PM "
      const pTag = li.querySelector('p');
      let startTime = "";
      let endTime = "";
      let location = "UPES Campus";
      let description = "";

      if (pTag) {
        // Extract time string (e.g. "01:00 PM - 01:55 PM")
        // We get the first text node of the p tag to avoid picking up the span text
        const timeText = pTag.childNodes[0].textContent.trim();
        const times = timeText.split('-');
        
        if (times.length === 2) {
            startTime = times[0].trim();
            endTime = times[1].trim();
        }

        // 3. Get Location / Link
        const linkEl = pTag.querySelector('a.session-link');
        const roomEl = pTag.querySelector('b'); // The bold tag inside the span

        if (linkEl) {
            location = linkEl.href; // It's an online class
            description = `Online Class Link: ${linkEl.href}`;
        } else if (roomEl) {
            location = `Room: ${roomEl.innerText.trim()}`; // It's a physical class
        }
      }

      // 4. Construct Date Objects for Google Calendar
      // We assume "Today's Sessions" implies the current date.
      const now = new Date();
      const dateString = now.toISOString().split('T')[0]; // YYYY-MM-DD

      sessions.push({
        summary: title,
        location: location,
        description: description,
        start: convertToISO(dateString, startTime),
        end: convertToISO(dateString, endTime)
      });

    } catch (e) {
      console.error("Error parsing a row", e);
    }
  });

  return { sessions };
}

// Helper to convert "2023-10-27" and "01:00 PM" into ISO format
function convertToISO(dateStr, timeStr) {
  // Combine date and time and parse
  const dateTimeStr = `${dateStr} ${timeStr}`;
  const dateObj = new Date(dateTimeStr);
  return dateObj.toISOString();
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "SCRAPE") {
    const result = scrapeSchedule();
    sendResponse(result);
  }
});