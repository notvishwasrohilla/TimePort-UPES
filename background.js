// background.js — The v0.5 Watchman Engine (The Token Heist)

const UPES_BASE_URL = "https://myupes-beta.upes.ac.in/";
const TIMETABLE_API = "https://myupes-beta.upes.ac.in/apigateway/api/timetable";

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('checkTimetable', { periodInMinutes: 240 });
  console.log('TimePort: Watchman Alarm Set.');
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkTimetable') {
    performSilentSync();
  }
});

// The "Heist" Function: We now know exactly what the vault is called.
function stealTokensFromPage() {
    return localStorage.getItem('qW0bzwe6hm4r') || sessionStorage.getItem('qW0bzwe6hm4r');
}

async function performSilentSync() {
  console.log('TimePort: Starting background sync check...');

  // 1. Get the Cookies
  const cookies = await chrome.cookies.getAll({ url: UPES_BASE_URL });
  if (cookies.length === 0) {
    console.warn('TimePort: No active session cookies. User must log in.');
    return;
  }
  const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  try {
    // 2. Execute the Token Heist
    const tabs = await chrome.tabs.query({ url: "https://myupes-beta.upes.ac.in/*" });
    if (tabs.length === 0) {
        console.warn('TimePort: No open UPES tab found to steal the Bearer token. Cannot perform background sync right now.');
        return; 
    }

    const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        function: stealTokensFromPage,
    });
    
    let bearerToken = injectionResults[0].result;
    
    if (!bearerToken) {
        console.error("TimePort: Token heist failed. The key 'qW0bzwe6hm4r' was empty.");
        return;
    }

    // 3. Format Today's Date
    const getTodayFormatted = () => {
      const d = new Date();
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const day = d.getDate().toString().padStart(2, '0');
      return `${day}-${months[d.getMonth()]}-${d.getFullYear()}`;
    };
    const todayStr = getTodayFormatted();

    // 4. Construct the Payload
    const requestPayload = {
      "ActivityCode": "studentdashboard",
      "TimeTableContextDetails": {
        "SlotStartDate": todayStr,
        "SlotEndDate": todayStr,
        "StudentCode": "71efd45f-e26f-4a1d-8b30-2ca18ebf9e6e"
      }
    };

    // 5. The Final, Perfected Fetch Request
    const response = await fetch(TIMETABLE_API, {
      method: 'POST',
      headers: {
        'Cookie': cookieString,
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bearerToken}`,
        'x-applicationname': 'connectportal',
        'x-appsecret': 'ku7GUMtyT8er51rTfTc7HC',
        'x-requestfrom': 'web',
        'x-studentUniqueId': '71efd45f-e26f-4a1d-8b30-2ca18ebf9e6e'
      },
      body: JSON.stringify(requestPayload) 
    });

    if (!response.ok) throw new Error(`Portal request failed: ${response.status}`);

    const rawData = await response.json();
    console.log('TimePort: Successfully retrieved background data.', rawData);

    if (rawData && rawData.length > 0) {
      const processedData = formatGatewayData(rawData);
      await chrome.storage.local.set({ lastScrapedData: processedData });
      console.log('TimePort: Data cached locally.');
    }

  } catch (err) {
    console.error('TimePort: Background Sync Error:', err);
  }
}

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