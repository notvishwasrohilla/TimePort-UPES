// Configuration
const MAX_RETRIES = 15; 
const RETRY_INTERVAL = 1000; 

let attempts = 0;

document.addEventListener('DOMContentLoaded', () => {
    startScrapingProcess();
});

async function startScrapingProcess() {
  const statusText = document.getElementById("status-text");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab) {
      statusText.textContent = "Error: No active tab.";
      return;
  }

  const attempt = () => {
      attempts++;
      chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: routerScrape,
      }, async (results) => { // Made async to handle storage
          
          const rawData = results && results[0] ? results[0].result : [];

          if (rawData && rawData.length > 0) {
              // DATA FOUND: Process it through our "Memory System"
              const processedData = await processMemory(rawData);
              
              displaySchedule(processedData);
          } else {
              // RETRY LOGIC
              if (attempts < MAX_RETRIES) {
                  statusText.textContent = `Waiting for schedule... (${attempts})`;
                  setTimeout(attempt, RETRY_INTERVAL);
              } else {
                  document.querySelector(".spinner").style.display = "none";
                  statusText.textContent = "Could not find schedule. Is the page loaded?";
              }
          }
      });
  };

  attempt();
}

/* =========================================
   MEMORY SYSTEM (The Brain)
   ========================================= */
async function processMemory(sessions) {
    // 1. Get existing memory from storage
    const storage = await chrome.storage.local.get(["facultyMap"]);
    let facultyMap = storage.facultyMap || {};
    let memoryUpdated = false;

    // 2. Loop through sessions to either LEARN or APPLY knowledge
    sessions.forEach(session => {
        
        // CASE A: We are on Scheduler (Data has faculty info)
        // We act as a "Teacher" -> We teach the memory
        if (session.source === "scheduler" && session.faculty && session.subject) {
            if (facultyMap[session.subject] !== session.faculty) {
                facultyMap[session.subject] = session.faculty;
                memoryUpdated = true;
            }
        }

        // CASE B: We are on Dashboard (Data lacks faculty info)
        // We act as a "Student" -> We ask memory for help
        if (session.source === "dashboard" && session.subject) {
            if (facultyMap[session.subject]) {
                // Found it in memory! Update the empty field.
                session.faculty = facultyMap[session.subject];
            }
        }
    });

    // 3. If we learned something new, save it back to storage
    if (memoryUpdated) {
        await chrome.storage.local.set({ facultyMap: facultyMap });
        console.log("TimePort Memory Updated:", facultyMap);
    }

    return sessions;
}

/* =========================================
   THE SCRAPER ROUTER
   ========================================= */
function routerScrape() {
  const url = window.location.href;
  
  if (url.includes("curriculum-scheduling") || document.querySelector("kendo-scheduler")) {
    return scrapeScheduler();
  } else {
    return scrapeDashboard();
  }

  function scrapeDashboard() {
    const sessionItems = document.querySelectorAll("li.course-red-wrapper");
    if (sessionItems.length === 0) return [];

    const data = [];
    sessionItems.forEach((item) => {
      const subjectEl = item.querySelector("b");
      const pTag = item.querySelector("p");
      const timeText = pTag ? pTag.childNodes[0].textContent.trim() : "";
      const roomEl = item.querySelector(".session-venue-info b");
      
      if (subjectEl) {
        data.push({
          source: "dashboard", // Tagging source is crucial for memory logic
          date: "Today's Sessions",
          subject: subjectEl.innerText,
          time: timeText,
          room: roomEl ? roomEl.innerText : "N/A",
          faculty: null, // Start as null, let Memory fill it later
          type: "offline"
        });
      }
    });
    return data;
  }

  function scrapeScheduler() {
    const events = document.querySelectorAll(".k-event");
    if (events.length === 0) return [];

    const data = [];
    events.forEach(event => {
      const ariaLabel = event.getAttribute("aria-label") || "";
      const dateParts = ariaLabel.split(','); 
      const dateString = dateParts.length >= 2 ? (dateParts[0] + "," + dateParts[1]) : "Upcoming";

      const style = event.getAttribute("style") || "";
      let type = "offline"; 
      if (style.includes("228, 96, 151")) type = "online";
      if (style.includes("76, 175, 80")) type = "holiday";

      const detailsDiv = event.querySelector(".event-in-details");
      const subjectAttr = detailsDiv ? detailsDiv.getAttribute("titlemodulename") : null;

      if (subjectAttr) {
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
        const titleSpan = event.querySelector(".event-title");
        if (titleSpan) {
           data.push({
              source: "scheduler",
              date: dateString.trim(),
              subject: titleSpan.innerText,
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
  const statusContainer = document.getElementById("status-container");
  
  statusContainer.style.display = "none";
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
      locationHtml = `<span style="font-size:12px; color:#4CAF50; font-weight:bold;">🎉 Holiday</span>`;
    }

    const div = document.createElement("div");
    div.className = `session-card ${cardClass}`;
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