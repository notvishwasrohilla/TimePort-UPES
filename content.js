// content.js — The Inside Man (Brute-Force Edition)
console.log("TimePort: Inside Man is active and scanning...");

let lastScrapedData = ""; 

function scanForSchedule() {
    const sessions = [];
    const isTimetable = document.querySelector("kendo-scheduler") !== null;

    if (isTimetable) {
        const events = document.querySelectorAll(".k-event");
        
        events.forEach((event, index) => {
            const details = event.querySelector(".event-in-details");
            if (details) {
                const subject = details.getAttribute("titlemodulename");
                const time = details.getAttribute("titleitem"); 
                let room = details.getAttribute("titlevenuename") || "N/A";
                room = room.split('(')[0].trim(); 
                
                // BRUTE FORCE: Split by comma and grab the second chunk (the date)
                const aria = event.getAttribute("aria-label") || "";
                const ariaParts = aria.split(','); 
                const exactDate = ariaParts.length > 1 ? ariaParts[1].trim() : null; // Gets "27 April 2026"

                // Check if we have the minimum required data
                if (subject && time && time.includes("-") && exactDate) {
                    sessions.push({ subject, time, room, date: exactDate });
                } else {
                    // X-RAY DEBUG: Tell us exactly what is missing
                    console.log(`TimePort Debug: Skipped an event. Subject: ${subject}, Time: ${time}, Date: ${exactDate}`);
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
        console.log(`TimePort: Captured ${sessions.length} sessions from ${isTimetable ? 'Timetable' : 'Dashboard'}. Beaming to Watchman...`);
        chrome.runtime.sendMessage({ 
            action: "trigger_sync", 
            data: sessions,
            cohort: "BT-CSE-SPZ-CSF-VI-B14" 
        });
        lastScrapedData = currentDataString; 
    }
}

// Run the scanner every 3 seconds
setInterval(scanForSchedule, 3000);