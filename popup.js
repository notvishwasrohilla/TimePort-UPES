let currentSessions = []; // Store scraped data here

document.addEventListener('DOMContentLoaded', () => {
  checkAuthStatus();
});

// --- Authentication Logic ---

function checkAuthStatus() {
  // Check if we have a cached token (interactive: false)
  chrome.identity.getAuthToken({ interactive: false }, (token) => {
    if (chrome.runtime.lastError || !token) {
      // Not signed in
      renderAuthState(false);
    } else {
      // Signed in
      renderAuthState(true);
      // Auto-scrape data since we are logged in
      triggerScrape();
    }
  });
}

document.getElementById('auth-btn').addEventListener('click', () => {
  chrome.identity.getAuthToken({ interactive: true }, (token) => {
    if (chrome.runtime.lastError) {
      updateStatus("Login failed: " + chrome.runtime.lastError.message);
      return;
    }
    renderAuthState(true);
    triggerScrape();
  });
});

document.getElementById('logout-btn').addEventListener('click', () => {
  chrome.identity.getAuthToken({ interactive: false }, (token) => {
    if (token) {
      chrome.identity.removeCachedAuthToken({ token: token }, () => {
        updateStatus("Logged out.");
        renderAuthState(false);
      });
    }
  });
});

// --- UI State Management ---

function renderAuthState(isSignedIn) {
  const authBtn = document.getElementById('auth-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const dataView = document.getElementById('data-view');

  if (isSignedIn) {
    authBtn.innerText = "✓ Signed In with Google";
    authBtn.disabled = true;
    logoutBtn.classList.remove('hidden');
    dataView.classList.remove('hidden');
    updateStatus("Ready to sync.");
  } else {
    authBtn.innerText = "Sign in with Google";
    authBtn.disabled = false;
    logoutBtn.classList.add('hidden');
    dataView.classList.add('hidden');
    updateStatus("Please sign in.");
  }
}

// --- Scraping & Preview Logic ---

async function triggerScrape() {
  updateStatus("Scanning dashboard...");
  
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab.url.includes("myupes-beta.upes.ac.in")) {
    updateStatus("⚠ Go to UPES Dashboard to sync.");
    return;
  }

  // Inject scraper
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js']
  }, () => {
    chrome.tabs.sendMessage(tab.id, { action: "SCRAPE" }, (response) => {
      if (!response || response.error) {
        updateStatus("⚠ Error: " + (response ? response.error : "Unknown"));
        return;
      }
      
      currentSessions = response.sessions || [];
      renderPreview(currentSessions);
    });
  });
}

function renderPreview(sessions) {
  const list = document.getElementById('session-list');
  const emptyMsg = document.getElementById('empty-msg');
  const syncBtn = document.getElementById('sync-btn');
  
  list.innerHTML = ''; // Clear old data

  if (sessions.length === 0) {
    list.style.display = 'none';
    emptyMsg.classList.remove('hidden');
    syncBtn.style.display = 'none';
    updateStatus("No classes found for today.");
    return;
  }

  // Show data
  list.style.display = 'block';
  emptyMsg.classList.add('hidden');
  syncBtn.style.display = 'block';

  sessions.forEach(session => {
    const div = document.createElement('div');
    div.className = 'session-item';
    
    // Format friendly time
    const startT = new Date(session.start).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    div.innerHTML = `
      <div class="session-time">${startT}</div>
      <div class="session-title">${session.summary}</div>
      <div class="session-loc">${session.location}</div>
    `;
    list.appendChild(div);
  });

  updateStatus(`Found ${sessions.length} classes.`);
}

// --- Sync Logic ---

document.getElementById('sync-btn').addEventListener('click', async () => {
  const btn = document.getElementById('sync-btn');
  btn.disabled = true;
  btn.innerText = "Syncing...";

  chrome.identity.getAuthToken({ interactive: false }, async (token) => {
    let successCount = 0;
    
    for (const event of currentSessions) {
      const resp = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          summary: event.summary,
          location: event.location,
          description: event.description,
          start: { dateTime: event.start },
          end: { dateTime: event.end }
        })
      });
      if (resp.ok) successCount++;
    }

    updateStatus(`Success! Added ${successCount} events.`);
    btn.innerText = "Sync Complete";
    setTimeout(() => {
        btn.disabled = false;
        btn.innerText = "Sync to Calendar";
    }, 3000);
  });
});

function updateStatus(msg) {
  document.getElementById('status-bar').innerText = msg;
}