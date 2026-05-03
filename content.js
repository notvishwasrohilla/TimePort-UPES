// content.js — The Inside Man (Scraper Edition)
console.log("TimePort: Inside Man active.");

window.addEventListener('load', () => {
    // Give the portal a second to render the sessions
    setTimeout(() => {
        const sessions = [];
        const items = document.querySelectorAll("li.course-red-wrapper");

        items.forEach(item => {
            const subject = item.querySelector("b")?.innerText;
            const time = item.querySelector("p")?.childNodes[0]?.textContent?.trim();
            const room = item.querySelector(".session-venue-info b")?.innerText;
            
            if (subject) {
                sessions.push({ subject, time, room });
            }
        });

        if (sessions.length > 0) {
            console.log("TimePort: Found sessions on page. Sending to Watchman...");
            chrome.runtime.sendMessage({ 
                action: "trigger_sync", 
                data: sessions,
                cohort: "BT-CSE-SPZ-CSF-VI-B14" // Your cohort from the dashboard
            });
        }
    }, 2000); 
});