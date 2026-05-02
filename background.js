// background.js — The v0.6 Watchman (The Trojan Horse Maneuver)

// 1. Import our hidden keys from config.js
importScripts('config.js');

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('checkTimetable', { periodInMinutes: 240 });
  console.log('TimePort: Watchman Alarm Set.');
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkTimetable') performSilentSync();
});

// THE TROJAN HORSE: This entire function gets beamed INSIDE the UPES tab.
async function trojanHorseFetch() {
    // 1. Crack the vault
    let raw = localStorage.getItem('qW0bzwe6hm4r') || sessionStorage.getItem('qW0bzwe6hm4r');
    let token = null;
    if (raw) {
        const matches = raw.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g);
        if (matches) token = matches[0];
    }

    if (!token) return { error: "No token found in page memory." };

    // 2. Format Today's Date
    const d = new Date();
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const todayStr = `${d.getDate().toString().padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;

    // 3. Construct Payload
    const payload = {
      "ActivityCode": "studentdashboard",
      "TimeTableContextDetails": {
        "SlotStartDate": todayStr,
        "SlotEndDate": todayStr,
        "StudentCode": "71efd45f-e26f-4a1d-8b30-2ca18ebf9e6e"
      }
    };

    // 4. Perform the Fetch from INSIDE the webpage
    try {
        const response = await fetch("https://myupes-beta.upes.ac.in/apigateway/api/timetable", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'x-applicationname': 'connectportal',
                'x-appsecret': 'ku7GUMtyT8er51rTfTc7HC',
                'x-requestfrom': 'web',
                'x-studentUniqueId': '71efd45f-e26f-4a1d-8b30-2ca18ebf9e6e'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) return { error: `Server rejected request: ${response.status}` };
        
        const data = await response.json();
        return { success: true, data: data }; // Send the data back to the extension!
    } catch (e) {
        return { error: e.message };
    }
}

// THE COMMANDER: This runs in the background and controls the Trojan Horse
async function performSilentSync() {
  console.log('TimePort: Initiating Trojan Horse maneuver...');

  try {
    const tabs = await chrome.tabs.query({ url: "https://myupes-beta.upes.ac.in/*" });
    if (tabs.length === 0) {
        console.warn('TimePort: No open UPES tab found to act as a host.');
        return; 
    }

    // Inject and execute the function inside the active tab
    const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        function: trojanHorseFetch,
    });
    
    const result = injectionResults[0].result;
    
    if (result.error) {
        console.error("TimePort: Trojan Horse failed -", result.error);
        return;
    }

    console.log('TimePort: Trojan Horse Success! Received Data:', result.data);

    if (result.data && result.data.length > 0) {
      const processedData = formatGatewayData(result.data);
      await chrome.storage.local.set({ lastScrapedData: processedData });
      console.log('TimePort: Data cached locally.');

      // --- THE SWARM PUSH ---
      const cohortId = processedData[0]?.cohort;
      if (cohortId) {
          console.log(`TimePort: Pushing schedule to Cloud Swarm for cohort ${cohortId}...`);
          await pushToSwarm(cohortId, processedData);
      } else {
          console.warn('TimePort: Could not identify Cohort ID. Swarm push aborted.');
      }
    } else {
      console.log('TimePort: Scrape successful, but no classes scheduled for today.');
    }

  } catch (err) {
    console.error('TimePort: Background Sync Error:', err);
  }
}

// THE CLOUD UPLINK: Pushes the local schedule to Supabase
async function pushToSwarm(cohortId, formattedSessions) {
  const endpoint = `${CONFIG.SUPABASE_URL}/rest/v1/timetables`;
  
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'apikey': CONFIG.SUPABASE_KEY,
        'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates' // Upsert: update if exists, insert if new
      },
      body: JSON.stringify({
        cohort_id: cohortId,
        schedule_data: formattedSessions,
        last_updated: new Date().toISOString()
      })
    });

    if (response.ok) {
      console.log("TimePort: 🚀 Swarm successfully updated in the Cloud!");
    } else {
      console.error("TimePort: Cloud update failed.", await response.text());
    }
  } catch (err) {
    console.error("TimePort: Network error while hitting Supabase", err);
  }
}

// Helper: Formats the raw JSON
function formatGatewayData(slots) {
  return slots.map(slot => ({
    source: "gateway",
    subject: slot.ModuleList && slot.ModuleList.length > 0 ? slot.ModuleList[0].ModuleName : "Unknown",
    time: `${slot.SlotStartTime} - ${slot.SlotEndTime}`,
    room: slot.FloorPlanDetails ? slot.FloorPlanDetails.VenueName : "N/A",
    faculty: slot.TeacherList && slot.TeacherList.length > 0 ? slot.TeacherList[0].Name : "N/A",
    type: (slot.FloorPlanDetails && slot.FloorPlanDetails.VenueCode === "MSTEAMS") ? "online" : "offline",
    link: (slot.FloorPlanDetails && slot.FloorPlanDetails.MeetingLink) ? slot.FloorPlanDetails.MeetingLink : null,
    cohort: slot.CohortList && slot.CohortList.length > 0 ? slot.CohortList[0].Code : null,
    date: slot.SlotDate
  }));
}