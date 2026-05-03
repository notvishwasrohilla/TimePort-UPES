importScripts('config.js');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "trigger_sync" && message.data) {
        console.log("TimePort: Data received. Pushing to Cloud & Calendar...");
        
        Promise.all([
            pushToSupabase(message.cohort, message.data),
            syncToGoogleCalendar(message.data)
        ]).then(() => {
            sendResponse({ status: "Full Sync Complete" });
        });

        return true; 
    }
});

async function pushToSupabase(cohortId, scheduleData) {
    try {
        await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/timetables`, {
            method: 'POST',
            headers: {
                'apikey': CONFIG.SUPABASE_KEY,
                'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify({
                cohort_id: cohortId,
                schedule_data: scheduleData,
                last_updated: new Date().toISOString()
            })
        });
        console.log("TimePort: 🚀 Cloud Updated.");
    } catch (e) { console.error("Cloud Error", e); }
}

async function syncToGoogleCalendar(sessions) {
    chrome.identity.getAuthToken({ interactive: true }, async function(token) {
        if (chrome.runtime.lastError || !token) {
            console.error("Calendar Error: No Auth Token");
            return;
        }

        // --- PHASE 1: THE GHOST HUNTER (Purge missing classes) ---
        const todayStart = new Date();
        todayStart.setHours(0,0,0,0);
        const todayEnd = new Date();
        todayEnd.setHours(23,59,59,999);

        const purgeUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${todayStart.toISOString()}&timeMax=${todayEnd.toISOString()}&singleEvents=true`;
        
        try {
            const calResponse = await fetch(purgeUrl, { headers: { 'Authorization': 'Bearer ' + token } });
            const calData = await calResponse.json();
            
            // Only look at events created by TimePort
            const existingTimePortEvents = (calData.items || []).filter(evt => evt.description === 'Synced via TimePort');

            for (const evt of existingTimePortEvents) {
                // Check if this calendar event still exists in the fresh scrape
                const stillExists = sessions.some(s => s.subject.toLowerCase().trim() === evt.summary.toLowerCase().trim());
                
                if (!stillExists) {
                    console.log(`TimePort: 🗑️ Removing canceled class: ${evt.summary}`);
                    await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${evt.id}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': 'Bearer ' + token }
                    });
                }
            }
        } catch (err) {
            console.error("TimePort: Ghost Hunter failed to check old events", err);
        }

        // --- PHASE 2: THE BUILDER (Add new classes / Skip existing) ---
        for (const session of sessions) {
           const startISO = convertToISO(session.time.split(' - ')[0], session.date);
           const endISO = convertToISO(session.time.split(' - ')[1], session.date);
            // Broaden search by 1 min to ensure we catch slightly off-timed events
            const searchStart = new Date(new Date(startISO).getTime() - 60000).toISOString();
            const searchEnd = new Date(new Date(endISO).getTime() + 60000).toISOString();

            const searchUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${searchStart}&timeMax=${searchEnd}&singleEvents=true`;
            
            try {
                const searchResponse = await fetch(searchUrl, {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const searchResult = await searchResponse.json();

                const isDuplicate = searchResult.items && searchResult.items.some(event => 
                    event.summary.toLowerCase().trim() === session.subject.toLowerCase().trim()
                );

                if (isDuplicate) {
                    console.log(`TimePort: Skipping ${session.subject} (Already in Calendar)`);
                    continue; 
                }

                const event = {
                    'summary': session.subject,
                    'location': session.room,
                    'description': 'Synced via TimePort',
                    'start': { 'dateTime': startISO, 'timeZone': 'Asia/Kolkata' },
                    'end': { 'dateTime': endISO, 'timeZone': 'Asia/Kolkata' }
                };

                await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                    body: JSON.stringify(event)
                });
                console.log(`TimePort: 📅 Added ${session.subject} to Calendar.`);

            } catch (err) {
                console.error(`TimePort: Failed to sync ${session.subject}`, err);
            }
        }
        console.log("TimePort: Sync Cycle Complete.");
    });
}

function convertToISO(timeStr, exactDateStr = null) {
    const targetDate = exactDateStr ? new Date(exactDateStr) : new Date();

    // Look for 12-hour format (e.g., "01:00 PM")
    const ampmMatch = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
    // Look for 24-hour format (e.g., "13:00")
    const militaryMatch = timeStr.match(/(\d{1,2}):(\d{2})/);

    let hours = 0;
    let minutes = 0;

    if (ampmMatch) {
        hours = parseInt(ampmMatch[1], 10);
        minutes = parseInt(ampmMatch[2], 10);
        const ampm = ampmMatch[3].toUpperCase();

        if (ampm === 'PM' && hours < 12) hours += 12;
        if (ampm === 'AM' && hours === 12) hours = 0;
    } else if (militaryMatch) {
        hours = parseInt(militaryMatch[1], 10);
        minutes = parseInt(militaryMatch[2], 10);
    } else {
        // If it's completely unreadable, default to midnight
        return targetDate.toISOString(); 
    }

    targetDate.setHours(hours, minutes, 0, 0);
    return targetDate.toISOString();
}