// Configuration
const MAX_RETRIES = 15; 
const RETRY_INTERVAL = 1000; 

let attempts = 0;
let currentSchedule = []; 

document.addEventListener('DOMContentLoaded', () => {
    startScrapingProcess();
    
    document.getElementById("syncBtn").addEventListener("click", handleSync);
    document.getElementById("signOutBtn").addEventListener("click", handleSignOut);
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
              statusText.textContent = "Analyzing duplicates...";
              let processedData = await processMemory(rawData);
              processedData = await checkDuplicateEvents(processedData);

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
   DUPLICATE DETECTION
   ========================================= */
async function checkDuplicateEvents(sessions) {
    return new Promise((resolve) => {
        chrome.identity.getAuthToken({ interactive: false }, async function(token) {
            if (chrome.runtime.lastError || !token) { resolve(sessions); return; }

            document.getElementById("signOutBtn").style.display = "block";

            let minTime = null;
            let maxTime = null;

            sessions.forEach(session => {
                if (session.type === "holiday") return;
                const resource = createEventResource(session);
                if (resource) {
                    session.startTimeMs = new Date(resource.start.dateTime).getTime();
                    session.endTimeMs = new Date(resource.end.dateTime).getTime();
                    if (!minTime || session.startTimeMs < minTime) minTime = session.startTimeMs;
                    if (!maxTime || session.endTimeMs > maxTime) maxTime = session.endTimeMs;
                }
            });

            if (!minTime || !maxTime) { resolve(sessions); return; }

            const minIso = new Date(minTime).toISOString();
            const maxIso = new Date(maxTime).toISOString();

            try {
                const response = await fetch(
                    `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${minIso}&timeMax=${maxIso}&singleEvents=true&maxResults=2500`, 
                    { headers: { 'Authorization': 'Bearer ' + token } }
                );
                
                if (!response.ok) { resolve(sessions); return; }
                
                const data = await response.json();
                const existingEvents = data.items || [];
                const existingMap = new Set();
                
                existingEvents.forEach(evt => {
                    if (evt.start && evt.start.dateTime) {
                        const evtStartMs = new Date(evt.start.dateTime).getTime();
                        const key = `${evt.summary.trim()}_${evtStartMs}`;
                        existingMap.add(key);
                    }
                });

                sessions.forEach(session => {
                    if (session.startTimeMs) {
                        const myKey = `${session.subject.trim()}_${session.startTimeMs}`;
                        if (existingMap.has(myKey)) session.isSynced = true;
                    }
                });

                resolve(sessions);
            } catch (e) {
                console.error("Error checking duplicates", e);
                resolve(sessions);
            }
        });
    });
}

function handleSignOut() {
    chrome.identity.getAuthToken({ interactive: false }, function(token) {
        if (token) {
            chrome.identity.removeCachedAuthToken({ token: token }, function() {
                alert("Signed out!");
                document.getElementById("signOutBtn").style.display = "none";
                location.reload(); 
            });
        }
    });
}

/* =========================================
   SYNC LOGIC (With Icons)
   ========================================= */
async function handleSync() {
    const btn = document.getElementById("syncBtn");
    
    const checkboxes = document.querySelectorAll(".sync-checkbox:checked");
    if (checkboxes.length === 0) {
        alert("Please select at least one class to sync.");
        return;
    }

    const indicesToSync = Array.from(checkboxes).map(cb => parseInt(cb.getAttribute("data-index")));
    
    btn.disabled = true;
    // Replace icon with Hourglass and use white filter
    btn.innerHTML = `<img src="icons/Hourglass.svg" class="icon icon-white"> Syncing...`;
    
    document.getElementById("schedule-list").style.opacity = "0.5"; 
    const progContainer = document.getElementById("progress-container");
    const progBar = document.getElementById("prog-bar");
    const progTitle = document.getElementById("prog-title");
    const progDetail = document.getElementById("prog-detail");
    
    progContainer.style.display = "block";
    
    chrome.identity.getAuthToken({ interactive: true }, async function(token) {
        if (chrome.runtime.lastError || !token) {
            alert("Login required.");
            resetUI();
            return;
        }

        document.getElementById("signOutBtn").style.display = "block";
        
        let successCount = 0;
        const total = indicesToSync.length;

        for (let i = 0; i < total; i++) {
            const index = indicesToSync[i];
            const session = currentSchedule[index];
            
            const percentage = Math.round(((i) / total) * 100);
            progBar.style.width = `${percentage}%`;
            progTitle.textContent = `Syncing ${i + 1}/${total}`;
            progDetail.textContent = `${session.subject}`;

            const eventResource = createEventResource(session);

            try {
                const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + token,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(eventResource)
                });

                if (response.ok) {
                    successCount++;
                    session.isSynced = true; 
                } 
            } catch (err) {
                console.error("Network error", err);
            }
            
            await new Promise(r => setTimeout(r, 200)); 
        }

        progBar.style.width = "100%";
        progTitle.textContent = "Completed!";
        progDetail.textContent = `Successfully synced ${successCount} classes.`;
        
        setTimeout(() => {
            alert(`Sync Complete! ${successCount} classes added.`);
            resetUI();
            displaySchedule(currentSchedule); 
        }, 800);
    });

    function resetUI() {
        btn.disabled = false;
        // Reset button icon to Calendar with white filter
        btn.innerHTML = `<img src="icons/Calender.svg" class="icon icon-white"> Sync Selected`;
        document.getElementById("schedule-list").style.opacity = "1";
        progContainer.style.display = "none";
        progBar.style.width = "0%";
    }
}

/* =========================================
   HELPERS & DISPLAY (With Icons)
   ========================================= */
function createEventResource(session) {
    let dateStr = session.date;
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

    let locationField = session.room;
    if (session.type === "online" && session.link) locationField = session.link;

    return {
        'summary': session.subject,
        'location': locationField,
        'description': `Faculty: ${session.faculty || "N/A"}`,
        'start': { 'dateTime': startTime },
        'end': { 'dateTime': endTime }
    };
}

function convertToISO(dateString, timeString) {
    const combinedString = `${dateString} ${timeString}`;
    const dateObj = new Date(combinedString);
    if (isNaN(dateObj.getTime())) return null;
    return dateObj.toISOString();
}

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

function displaySchedule(sessions) {
  const container = document.getElementById("schedule-list");
  const statusContainer = document.getElementById("status-container");
  const titleElement = document.querySelector("h2");
  const syncBtn = document.getElementById("syncBtn");
  
  statusContainer.style.display = "none";
  syncBtn.style.display = "flex"; 
  container.innerHTML = "";

  if (sessions.length === 0) {
    container.innerHTML = "<p style='text-align:center; padding:20px;'>No sessions found.</p>";
    return;
  }

  if (sessions[0].source === "dashboard") titleElement.textContent = "Dashboard";
  else titleElement.textContent = "Time Table";

  let lastDate = "";

  sessions.forEach((session, index) => {
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

    // Location / Button HTML with colored classes
    let locationHtml = `<span class="room-badge"><img src="icons/Location.svg" class="icon icon-location"> ${session.room}</span>`;
    
    if (session.type === "online") {
        locationHtml = session.link 
            ? `<a href="${session.link}" target="_blank" class="join-btn"><img src="icons/VideoCam.svg" class="icon icon-white"> JOIN CLASS</a>` 
            : `<a href="https://teams.microsoft.com/" target="_blank" class="join-btn"><img src="icons/VideoCam.svg" class="icon icon-white"> JOIN TEAMS</a>`;
    } else if (session.type === "holiday") {
      locationHtml = `<span style="font-size:12px; color:#4CAF50; font-weight:bold;"><img src="icons/Holiday.svg" class="icon icon-holiday"> Holiday</span>`;
    }

    // Checkbox or Synced Badge
    let actionHtml = "";
    if (session.type === "holiday") {
        actionHtml = ""; 
    } else if (session.isSynced) {
        // Use 'icon-check' to color the checkmark green
        actionHtml = `<div class="synced-badge"><img src="icons/Checkbox Checked.svg" class="icon icon-check"> Synced</div>`;
    } else {
        // Standard input (colored by CSS filter)
        actionHtml = `<input type="checkbox" class="sync-checkbox" data-index="${index}" checked>`;
    }

    const div = document.createElement("div");
    div.className = `session-card ${cardClass}`;
    div.innerHTML = `
      ${actionHtml ? `<div style="margin-right:10px;">${actionHtml}</div>` : ""}
      <div class="card-content">
        <span class="subject">${session.subject}</span>
        ${session.faculty ? `<span class="faculty"><img src="icons/Person.svg" class="icon icon-faculty"> ${session.faculty}</span>` : ""}
        <div class="details">
          <span class="time">${session.time !== "All Day" ? `<img src="icons/Alarm.svg" class="icon icon-time"> ` + session.time : ""}</span>
          ${locationHtml}
        </div>
      </div>
    `;
    container.appendChild(div);
  });
}

function routerScrape() {
  const url = window.location.href;
  if (url.includes("curriculum-scheduling") || document.querySelector("kendo-scheduler")) {
    return scrapeScheduler();
  } else {
    return scrapeDashboard();
  }
  function cleanRoom(t) { return t ? t.split('(')[0].trim() : "N/A"; }
  function scrapeDashboard() {
    const items = document.querySelectorAll("li.course-red-wrapper");
    if (items.length === 0) return [];
    const data = [];
    items.forEach(item => {
      const sub = item.querySelector("b");
      const time = item.querySelector("p") ? item.querySelector("p").childNodes[0].textContent.trim() : "";
      const room = item.querySelector(".session-venue-info b");
      const link = item.querySelector("a") ? item.querySelector("a").href : null;
      if (sub) data.push({
          source: "dashboard", date: "Today's Sessions", subject: sub.innerText,
          time: time, room: cleanRoom(room ? room.innerText : ""), faculty: null, 
          type: link ? "online" : "offline", link: link
      });
    });
    return data;
  }
  function scrapeScheduler() {
    const events = document.querySelectorAll(".k-event");
    if (events.length === 0) return [];
    const data = [];
    events.forEach(event => {
      const aria = event.getAttribute("aria-label") || "";
      const dParts = aria.split(','); 
      const dStr = dParts.length >= 2 ? (dParts[0] + "," + dParts[1]) : "Upcoming";
      const style = event.getAttribute("style") || "";
      let type = "offline"; 
      if (style.includes("228, 96, 151")) type = "online";
      if (style.includes("76, 175, 80")) type = "holiday";
      const details = event.querySelector(".event-in-details");
      const subAttr = details ? details.getAttribute("titlemodulename") : null;
      if (subAttr) {
        data.push({
          source: "scheduler", date: dStr.trim(), subject: subAttr,
          faculty: details.getAttribute("titlefacultyname"), time: details.getAttribute("titleitem"),
          room: cleanRoom(details.getAttribute("titlevenuename")), type: type, link: null
        });
      } else {
        const title = event.querySelector(".event-title");
        if (title) data.push({
              source: "scheduler", date: dStr.trim(), subject: title.innerText,
              faculty: "", time: "All Day", room: "", type: "holiday", link: null
           });
      }
    });
    return data;
  }
}