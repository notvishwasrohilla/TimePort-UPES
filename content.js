// content.js — The Inside Man (Auto-Cohort Edition)
console.log("TimePort: Inside Man is active and scanning...");

let lastScrapedData = ""; 
let currentCohort = "UNKNOWN_COHORT";

// --- NEW: THE COHORT DETECTOR ---
function detectCohort() {
    // Looks for the standard UPES batch format anywhere on the page
    // Pattern matches: [Letters]-[Letters]-[Letters]-[Letters]-[RomanNumerals]-[Letters/Numbers]
    const pageText = document.body.innerText;
    const batchRegex = /\b[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+-[IVX]+-[A-Z0-9]+\b/i;
    const match = pageText.match(batchRegex);

    if (match) {
        return match[0].toUpperCase(); // Ensure it's perfectly formatted
    }
    
    return null; // Return null if we can't find it
}

function scanForSchedule() {
    const sessions = [];
    const isTimetable = document.querySelector("kendo-scheduler") !== null;

    // Try to find the cohort. If we can't find it, use a safe fallback so the script doesn't crash.
    const detectedCohort = detectCohort();
    if (detectedCohort) {
        currentCohort = detectedCohort;
    } else if (currentCohort === "UNKNOWN_COHORT") {
        console.warn("TimePort Debug: Could not find Cohort string on this page. Using fallback.");
        currentCohort = "BT-CSE-SPZ-CSF-VI-B14"; // Safe fallback just in case
    }

    if (isTimetable) {
        const events = document.querySelectorAll(".k-event");
        
        events.forEach((event, index) => {
            const details = event.querySelector(".event-in-details");
            if (details) {
                const subject = details.getAttribute("titlemodulename");
                const time = details.getAttribute("titleitem"); 
                let room = details.getAttribute("titlevenuename") || "N/A";
                room = room.split('(')[0].trim(); 
                
                const aria = event.getAttribute("aria-label") || "";
                const ariaParts = aria.split(','); 
                const exactDate = ariaParts.length > 1 ? ariaParts[1].trim() : null; 

                if (subject && time && time.includes("-") && exactDate) {
                    sessions.push({ subject, time, room, date: exactDate });
                }
            }
        });
    } else {
        const items = document.querySelectorAll("li.course-red-wrapper");
        items.forEach(item => {
            const subject = item.querySelector("b")?.innerText;
            const time = item.querySelector("p")?.childNodes[0]?.textContent?.trim();
            let room = item.querySelector(".session-venue-info b")?.innerText || "N/A";
            room = room.split('(')[0].trim();

            if (subject && time && time.includes("-")) {
                sessions.push({ subject, time, room, date: null }); 
            }
        });
    }

    const currentDataString = JSON.stringify(sessions);

    if (sessions.length > 0 && currentDataString !== lastScrapedData) {
        console.log(`TimePort: Captured ${sessions.length} sessions from ${isTimetable ? 'Timetable' : 'Dashboard'}.`);
        console.log(`TimePort: Cohort locked as [${currentCohort}]. Beaming to Watchman...`);
        
        chrome.runtime.sendMessage({ 
            action: "trigger_sync", 
            data: sessions,
            cohort: currentCohort // <-- DYNAMIC INJECTION
        });
        lastScrapedData = currentDataString; 
    }
}

// Run the scanner every 3 seconds
setInterval(scanForSchedule, 3000);