document.addEventListener("DOMContentLoaded", () => {
  const sessionsListEl = document.getElementById("sessionsList");

  // This function runs in the context of the portal tab
  function extractSessions() {
    try {
      const sessionNodes = document.querySelectorAll(
        ".session-info-container ul li"
      );

      const sessions = [];
      sessionNodes.forEach((node) => {
        const title = node.querySelector("b")?.innerText.trim() || "Untitled";

        // ✅ Get only the raw time text (the firstChild of <p>)
        const timeEl = node.querySelector("p");
        let timeText = "";
        if (timeEl && timeEl.firstChild) {
          timeText = timeEl.firstChild.textContent.trim();
        }

        const link = node.querySelector("a")?.href || "";

        // Extract start/end times (split on '-')
        let start = "";
        let end = "";
        if (timeText.includes("-")) {
          const parts = timeText.split("-");
          start = parts[0].trim();
          end = parts[1]?.trim() || "";
        }

        sessions.push({
          title,
          time: timeText, // ✅ clean time, no injected buttons
          start,
          end,
          link,
        });
      });

      return sessions;
    } catch (err) {
      console.error("extractSessions error:", err);
      return [];
    }
  }

  // Ask Chrome for the active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];

    if (
      tab &&
      tab.url &&
      tab.url.startsWith("https://myupes-beta.upes.ac.in")
    ) {
      // Inject the extractor into the portal tab
      chrome.scripting.executeScript(
        {
          target: { tabId: tab.id },
          func: extractSessions,
        },
        (injectionResults) => {
          if (chrome.runtime.lastError) {
            console.error("Injection error:", chrome.runtime.lastError.message);
            sessionsListEl.innerHTML =
              '<div class="muted">Error: Unable to run on this page.</div>';
            return;
          }

          if (!injectionResults || !injectionResults[0].result.length) {
            sessionsListEl.innerHTML =
              '<div class="muted">No sessions found. Make sure you are on "Today\'s Sessions" tab.</div>';
            return;
          }

          const sessions = injectionResults[0].result;
          sessionsListEl.innerHTML = "";

          sessions.forEach((session) => {
            const item = document.createElement("div");
            item.className = "session-item";
            item.innerHTML = `
              <div class="session-title">${session.title}</div>
              <div class="session-time">${session.time}</div>
              <div class="session-actions">
                <a href="${session.link}" target="_blank">Join</a>
                <button class="add-to-calendar">➕ Add to Google Calendar</button>
              </div>
            `;

            // Calendar button click
            item
              .querySelector(".add-to-calendar")
              .addEventListener("click", () => {
                const gcalUrl = new URL(
                  "https://calendar.google.com/calendar/render"
                );
                gcalUrl.searchParams.set("action", "TEMPLATE");
                gcalUrl.searchParams.set("text", session.title);
                gcalUrl.searchParams.set(
                  "dates",
                  convertToGCalDate(session.start, session.end)
                );
                gcalUrl.searchParams.set(
                  "details",
                  `Class link: ${session.link}`
                );
                gcalUrl.searchParams.set("location", "UPES Portal");

                window.open(gcalUrl.toString(), "_blank");
              });

            sessionsListEl.appendChild(item);
          });
        }
      );
    } else {
      // Not on the portal tab
      sessionsListEl.innerHTML =
        '<div class="muted">Please open the myUPES portal on "Today\'s Sessions" tab.</div>';
    }
  });

  // Helper: Convert "08:00 AM" → Google Calendar time format
  function convertToGCalDate(startTime, endTime) {
    const today = new Date();
    const [startH, startM, startAP] = parseTime(startTime);
    const [endH, endM, endAP] = parseTime(endTime);

    const startDate = new Date(today);
    startDate.setHours(
      startAP === "PM" && startH < 12 ? startH + 12 : startH,
      startM,
      0
    );

    const endDate = new Date(today);
    endDate.setHours(
      endAP === "PM" && endH < 12 ? endH + 12 : endH,
      endM,
      0
    );

    return formatDateForGCal(startDate) + "/" + formatDateForGCal(endDate);
  }

  function parseTime(timeStr) {
    if (!timeStr) return [0, 0, "AM"];
    const match = timeStr.match(/(\d{1,2}):(\d{2})\s?(AM|PM)/i);
    if (!match) return [0, 0, "AM"];
    return [parseInt(match[1]), parseInt(match[2]), match[3].toUpperCase()];
  }

  function formatDateForGCal(date) {
    return date.toISOString().replace(/-|:|\.\d+/g, "");
  }
});
