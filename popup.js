document.getElementById("scrapeBtn").addEventListener("click", async () => {
  const status = document.getElementById("status");
  status.textContent = "Analyzing page structure...";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: routerScrape,
  }, (results) => {
    if (results && results[0] && results[0].result) {
      displaySchedule(results[0].result);
      status.textContent = `Loaded ${results[0].result.length} sessions`;
    } else {
      status.textContent = "No schedule data found.";
    }
  });
});

/* =========================================
   THE SCRAPER ROUTER
   ========================================= */
function routerScrape() {
  const url = window.location.href;
  
  // Decide which scraper to use
  if (url.includes("curriculum-scheduling") || document.querySelector("kendo-scheduler")) {
    return scrapeScheduler();
  } else {
    return scrapeDashboard();
  }

  // --- METHOD A: DASHBOARD ---
  function scrapeDashboard() {
    const sessionItems = document.querySelectorAll("li.course-red-wrapper");
    const data = [];

    sessionItems.forEach((item) => {
      const subjectEl = item.querySelector("b");
      const pTag = item.querySelector("p");
      const timeText = pTag ? pTag.childNodes[0].textContent.trim() : "";
      const roomEl = item.querySelector(".session-venue-info b");
      
      if (subjectEl) {
        data.push({
          source: "dashboard",
          date: "Today's Sessions",
          subject: subjectEl.innerText,
          time: timeText,
          room: roomEl ? roomEl.innerText : "N/A",
          faculty: "See Scheduler for info", 
          type: "offline"
        });
      }
    });
    return data;
  }

  // --- METHOD B: SCHEDULER (FIXED) ---
  function scrapeScheduler() {
    const events = document.querySelectorAll(".k-event");
    const data = [];

    events.forEach(event => {
      // 1. Get Date
      const ariaLabel = event.getAttribute("aria-label") || "";
      const dateParts = ariaLabel.split(','); 
      const dateString = dateParts.length >= 2 ? (dateParts[0] + "," + dateParts[1]) : "Upcoming";

      // 2. Detect Type by Color
      const style = event.getAttribute("style") || "";
      let type = "offline"; 
      if (style.includes("228, 96, 151")) type = "online";
      if (style.includes("76, 175, 80")) type = "holiday";

      // 3. Get Details (The Fix)
      const detailsDiv = event.querySelector(".event-in-details");
      
      // Check if we have the specific attribute that classes have
      const subjectAttr = detailsDiv ? detailsDiv.getAttribute("titlemodulename") : null;

      if (subjectAttr) {
        // SCENARIO 1: It is a standard class (has attributes)
        data.push({
          source: "scheduler",
          date: dateString.trim(),
          subject: subjectAttr,
          faculty: detailsDiv.getAttribute("titlefacultyname"),
          time: detailsDiv.getAttribute("titleitem"),
          room: detailsDiv.getAttribute("titlevenuename"),
          type: type
        });
      } else {
        // SCENARIO 2: It is a Holiday or weird event (No attributes, just text)
        const titleSpan = event.querySelector(".event-title");
        if (titleSpan) {
           data.push({
              source: "scheduler",
              date: dateString.trim(),
              subject: titleSpan.innerText, // "Republic Day"
              faculty: "",
              time: "All Day",
              room: "",
              type: "holiday"
           });
        }
      }
    });
    
    return data;
  }
}

/* =========================================
   DISPLAY LOGIC
   ========================================= */
function displaySchedule(sessions) {
  const container = document.getElementById("schedule-list");
  container.innerHTML = "";

  if (sessions.length === 0) {
    container.innerHTML = "<p style='text-align:center; padding:20px;'>No sessions found.</p>";
    return;
  }

  let lastDate = "";

  sessions.forEach(session => {
    if (session.date !== lastDate) {
      const dateHeader = document.createElement("div");
      dateHeader.className = "date-header";
      dateHeader.textContent = session.date;
      container.appendChild(dateHeader);
      lastDate = session.date;
    }

    let cardClass = "card-offline";
    if (session.type === "online") cardClass = "card-online";
    if (session.type === "holiday") cardClass = "card-holiday";

    let locationHtml = `<span class="room-badge">📍 ${session.room}</span>`;
    
    if (session.type === "online") {
      locationHtml = `<a href="https://teams.microsoft.com/" target="_blank" class="join-btn">📹 JOIN CLASS</a>`;
    } else if (session.type === "holiday") {
      // Holiday specific display
      locationHtml = `<span style="font-size:12px; color:#4CAF50; font-weight:bold;">🎉 Holiday</span>`;
    }

    const div = document.createElement("div");
    div.className = `session-card ${cardClass}`;
    
    // Improved inner HTML to handle missing faculty/time gracefully
    div.innerHTML = `
      <span class="subject">${session.subject}</span>
      ${session.faculty ? `<span class="faculty">👤 ${session.faculty}</span>` : ""}
      <div class="details">
        <span class="time">${session.time !== "All Day" ? "⏰ " + session.time : ""}</span>
        ${locationHtml}
      </div>
    `;
    container.appendChild(div);
  });
}