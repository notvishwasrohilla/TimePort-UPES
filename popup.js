// Configuration
const MAX_RETRIES = 15; 
const RETRY_INTERVAL = 1000; 

let attempts = 0;
let currentSchedule = []; // Store data globally for Sync

document.addEventListener('DOMContentLoaded', () => {
    startScrapingProcess();
    
    // Attach Sync Button Listener
    document.getElementById("syncBtn").addEventListener("click", handleSync);
});

async function startScrapingProcess() {
  const statusText = document.getElementById("status-text");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab) { statusText.textContent = "Error: No active tab."; return; }

  const attempt = () => {
      attempts++;
      chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: routerScrape,
      }, async (results) => { 
          const rawData = results && results[0] ? results[0].result : [];

          if (rawData && rawData.length > 0) {
              const processedData = await processMemory(rawData);
              
              currentSchedule = processedData; 
              displaySchedule(processedData);
          } else {
              if (attempts < MAX_RETRIES) {
                  statusText.textContent = `Waiting for schedule... (${attempts})`;
                  setTimeout(attempt, RETRY_INTERVAL);
              } else {
                  document.querySelector(".spinner").style.display = "none";
                  statusText.textContent = "Could not find schedule.";
              }
          }
      });
  };
  attempt();
}

/* =========================================
   GOOGLE CALENDAR SYNC
   ========================================= */
function handleSync() {
    const btn = document.getElementById("syncBtn");
    
    if (currentSchedule.length === 0) {
        alert("No classes to sync!");
        return;
    }

    btn.textContent = "⏳ Syncing...";
    btn.disabled = true;

    chrome.identity.getAuthToken({ interactive: true }, function(token) {
        if (chrome.runtime.lastError || !token) {
            alert("Login failed: " + JSON.stringify(chrome.runtime.lastError));
            btn.textContent = "📅 Sync to Google";
            btn.disabled = false;
            return;
        }

        let successCount = 0;
        let processedCount = 0;

        currentSchedule.forEach(session => {
            // Skip holidays or invalid times
            if (session.type === "holiday" || !session.time.includes("-")) {
                processedCount++;
                return;
            }

            const eventResource = createEventResource(session);
            if (!eventResource) {
                processedCount++;
                return;
            }

            fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(eventResource)
            })
            .then(response => {
                if (response.ok) successCount++;
            })
            .finally(() => {
                processedCount++;
                if (processedCount === currentSchedule.length) {
                    btn.textContent = "✅ Done!";
                    setTimeout(() => { 
                        btn.textContent = "📅 Sync to Google"; 
                        btn.disabled = false;
                    }, 3000);
                    alert(`Synced ${successCount} classes to Google Calendar!`);
                }
            });
        });
    });
}

function createEventResource(session) {
    let dateStr = session.date;
    
    // Handle "Today" case
    if (dateStr.includes("Today")) {
        const today = new Date();
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        dateStr = today.toLocaleDateString('en-GB', options); 
    }

    const cleanDateParts = dateStr.split(', ');
    const cleanDate = cleanDateParts.length > 1 ? cleanDateParts[1] : dateStr;

    const times = session.time.split(' - ');
    if (times.length < 2) return null;

    const startTime = convertToISO(cleanDate, times[0]);
    const endTime = convertToISO(cleanDate, times[1]);

    if (!startTime || !endTime) return null;

    // LOCATION LOGIC: Link for Online, Clean Room for Offline
    let locationField = session.room;
    if (session.type === "online" && session.link) {
        locationField = session.link;
    }

    return {
        'summary': session.subject,
        'location': locationField,
        'description': `Faculty: ${session.faculty || "N/A"}`, // Removed TimePort branding
        'start': {
            'dateTime': startTime,
            'timeZone': Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        'end': {
            'dateTime': endTime,
            'timeZone': Intl.DateTimeFormat().resolvedOptions().timeZone
        }
    };
}

function convertToISO(dateString, timeString) {
    const combinedString = `${dateString} ${timeString}`;
    const dateObj = new Date(combinedString);
    if (isNaN(dateObj.getTime())) return null;
    return dateObj.toISOString();
}

/* =========================================
   MEMORY SYSTEM & SCRAPERS
   ========================================= */
async function processMemory(sessions) {
    const storage = await chrome.storage.local.get(["facultyMap"]);
    let facultyMap = storage.facultyMap || {};
    let memoryUpdated = false;

    sessions.forEach(session => {
        if (session.source === "scheduler" && session.faculty && session.subject) {
            if (facultyMap[session.subject] !== session.faculty) {
                facultyMap[session.subject] = session.faculty;
                memoryUpdated = true;
            }
        }
        if (session.source === "dashboard" && session.subject) {
            if (facultyMap[session.subject]) session.faculty = facultyMap[session.subject];
        }
    });

    if (memoryUpdated) await chrome.storage.local.set({ facultyMap: facultyMap });
    return sessions;
}

function routerScrape() {
  const url = window.location.href;
  if (url.includes("curriculum-scheduling") || document.querySelector("kendo-scheduler")) {
    return scrapeScheduler();
  } else {
    return scrapeDashboard();
  }

  // Helper to clean room numbers: "11115(11115)" -> "11115"
  function cleanRoom(roomText) {
      if (!roomText) return "N/A";
      // Split by '(' and take the first part
      return roomText.split('(')[0].trim();
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
      const linkEl = item.querySelector("a");
      const realLink = linkEl ? linkEl.href : null;
      const isOnline = realLink ? true : false;
      
      if (subjectEl) {
        data.push({
          source: "dashboard",
          date: "Today's Sessions",
          subject: subjectEl.innerText,
          time: timeText,
          room: cleanRoom(roomEl ? roomEl.innerText : ""),
          faculty: null, 
          type: isOnline ? "online" : "offline",
          link: realLink
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
          room: cleanRoom(detailsDiv.getAttribute("titlevenuename")),
          type: type,
          link: null
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
              type: "holiday",
              link: null
           });
        }
      }
    });
    return data;
  }
}

function displaySchedule(sessions) {
  const container = document.getElementById("schedule-list");
  const statusContainer = document.getElementById("status-container");
  const titleElement = document.querySelector("h2");
  const syncBtn = document.getElementById("syncBtn");
  
  statusContainer.style.display = "none";
  syncBtn.style.display = "block"; 
  container.innerHTML = "";

  if (sessions.length === 0) {
    container.innerHTML = "<p style='text-align:center; padding:20px;'>No sessions found.</p>";
    return;
  }

  if (sessions[0].source === "dashboard") {
      titleElement.textContent = "Dashboard";
  } else {
      titleElement.textContent = "Time Table";
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
        if (session.link) {
            locationHtml = `<a href="${session.link}" target="_blank" class="join-btn">📹 JOIN CLASS</a>`;
        } else {
            locationHtml = `<a href="https://teams.microsoft.com/" target="_blank" class="join-btn">📹 JOIN TEAMS</a>`;
        }
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