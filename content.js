// content.js — The Inside Man (Universal Scraper Edition)
console.log("TimePort: Inside Man active.");

window.addEventListener('load', () => {
    // Wait 3 seconds because the Timetable grid takes slightly longer to load
    setTimeout(() => {
        const sessions = [];
        const isTimetable = window.location.href.includes("curriculum-scheduling") || document.querySelector("kendo-scheduler");

        if (isTimetable) {
            console.log("TimePort: Timetable Grid detected. Commencing deep scrape...");
            const events = document.querySelectorAll(".k-event");
            
            events.forEach(event => {
                const details = event.querySelector(".event-in-details");
                if (details) {
                    const subject = details.getAttribute("titlemodulename");
                    const time = details.getAttribute("titleitem"); // e.g., "10:00 AM - 11:00 AM"
                    let room = details.getAttribute("titlevenuename") || "N/A";
                    room = room.split('(')[0].trim(); // Clean up room name
                    
                    // Extract the exact date from the hidden aria-label
                    const aria = event.getAttribute("aria-label") || "";
                    const dateMatch = aria.match(/[A-Z][a-z]+day,\s[A-Z][a-z]+\s\d{1,2},\s\d{4}/); // Finds "Thursday, May 04, 2026"
                    const exactDate = dateMatch ? dateMatch[0] : null;

                    if (subject && time) {
                        sessions.push({ subject, time, room, date: exactDate });
                    }
                }
            });
        } else {
            console.log("TimePort: Dashboard detected. Scraping Today's Sessions...");
            const items = document.querySelectorAll("li.course-red-wrapper");
            
            items.forEach(item => {
                const subject = item.querySelector("b")?.innerText;
                const time = item.querySelector("p")?.childNodes[0]?.textContent?.trim();
                let room = item.querySelector(".session-venue-info b")?.innerText || "N/A";
                room = room.split('(')[0].trim();

                if (subject && time) {
                    sessions.push({ subject, time, room, date: null }); // null tells the background it's 'today'
                }
            });
        }

        if (sessions.length > 0) {
            console.log(`TimePort: Captured ${sessions.length} sessions. Beaming to Watchman...`);
            chrome.runtime.sendMessage({ 
                action: "trigger_sync", 
                data: sessions,
                cohort: "BT-CSE-SPZ-CSF-VI-B14" 
            });
        } else {
            console.log("TimePort: No sessions found on screen.");
        }
    }, 3000); 
});