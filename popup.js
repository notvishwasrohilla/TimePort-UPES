document.getElementById('auth-btn').addEventListener('click', () => {
  // 1. Trigger Google Sign In
  chrome.identity.getAuthToken({ interactive: true }, function(token) {
    if (chrome.runtime.lastError) {
      updateStatus("Auth failed: " + chrome.runtime.lastError.message);
      return;
    }
    // If successful, show the scrape button
    document.getElementById('auth-section').classList.add('hidden');
    document.getElementById('sync-section').classList.remove('hidden');
    updateStatus("Signed in! Ready to sync.");
    
    // Save token globally or pass it down
    window.googleAuthToken = token;
  });
});

document.getElementById('scrape-btn').addEventListener('click', async () => {
  updateStatus("Scraping data...");
  
  // Get the current active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab.url.includes("myupes-beta.upes.ac.in")) {
    updateStatus("Error: Please go to the UPES Dashboard first.");
    return;
  }

  // Inject script and scrape
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js']
  }, () => {
    // Send message to content script to run the scrape function
    chrome.tabs.sendMessage(tab.id, { action: "SCRAPE" }, async (response) => {
      if (!response || response.error) {
        updateStatus(response ? response.error : "Scraping failed.");
        return;
      }

      const sessions = response.sessions;
      if (sessions.length === 0) {
        updateStatus("No sessions found on dashboard.");
        return;
      }

      updateStatus(`Found ${sessions.length} sessions. Uploading...`);
      await pushToCalendar(sessions);
    });
  });
});

async function pushToCalendar(events) {
  const token = window.googleAuthToken;
  let successCount = 0;

  for (const event of events) {
    try {
      const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          summary: event.summary,
          location: event.location,
          description: event.description,
          start: {
            dateTime: event.start,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
          },
          end: {
            dateTime: event.end,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
          }
        })
      });

      if (response.ok) successCount++;
    } catch (error) {
      console.error("Error uploading event", error);
    }
  }
  
  updateStatus(`Done! Added ${successCount} events to your calendar.`);
}

function updateStatus(msg) {
  document.getElementById('status').innerText = msg;
}