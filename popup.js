// popup.js - popup UI + OAuth (runs in popup context)
document.addEventListener('DOMContentLoaded', () => {
  const connectBtn = document.getElementById('connectBtn');
  const disconnectBtn = document.getElementById('disconnectBtn');
  const syncBtn = document.getElementById('syncBtn');
  const statusDiv = document.getElementById('status');
  const showLocalBtn = document.getElementById('showLocalBtn');
  const listDiv = document.getElementById('list');

  function setStatus(text) { statusDiv.textContent = text; }

  if (!connectBtn || !disconnectBtn || !syncBtn || !statusDiv) {
    console.error('popup: required DOM elements missing');
    return;
  }

  // Check chrome.identity presence
  const hasIdentity = !!(window.chrome && chrome.identity);
  console.debug('popup chrome.identity exists?', hasIdentity, chrome.identity);

  if (!hasIdentity) {
    setStatus('Error: chrome.identity unavailable. See console for steps.');
    connectBtn.disabled = true;
    disconnectBtn.style.display = 'none';
    syncBtn.disabled = true;
  }

  // Helpers
  async function getAuthToken(interactive = true) {
    return new Promise((resolve, reject) => {
      try {
        chrome.identity.getAuthToken({ interactive }, (token) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(token);
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  async function fetchUserInfo(token) {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Failed fetching userinfo: ' + res.status);
    return res.json();
  }

  async function revokeToken(token) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, {
      method: 'POST',
      headers: { 'Content-type': 'application/x-www-form-urlencoded' }
    });
    return new Promise((resolve) => {
      chrome.identity.removeCachedAuthToken({ token }, () => resolve());
    });
  }

  async function checkStatus() {
    if (!hasIdentity) {
      setStatus('chrome.identity unavailable');
      return;
    }
    try {
      const token = await getAuthToken(false);
      if (!token) throw new Error('no token');
      const user = await fetchUserInfo(token);
      setStatus(`Connected as ${user.email}`);
      connectBtn.disabled = true;
      disconnectBtn.style.display = 'inline-block';
      syncBtn.disabled = false;
    } catch (e) {
      setStatus('Not connected');
      connectBtn.disabled = false;
      disconnectBtn.style.display = 'none';
      syncBtn.disabled = true;
    }
  }

  connectBtn.addEventListener('click', async () => {
    if (!hasIdentity) return;
    setStatus('Opening Google sign-in...');
    connectBtn.disabled = true;
    try {
      const token = await getAuthToken(true);
      const user = await fetchUserInfo(token);
      chrome.storage.local.set({ oauth_token: token }, () => {});
      setStatus(`Connected as ${user.email}`);
      disconnectBtn.style.display = 'inline-block';
      syncBtn.disabled = false;
    } catch (err) {
      setStatus('Sign-in failed: ' + (err.message || err));
      connectBtn.disabled = false;
      console.error('Sign-in error:', err);
    }
  });

  disconnectBtn.addEventListener('click', async () => {
    setStatus('Signing out...');
    try {
      const token = await getAuthToken(false).catch(() => null);
      if (token) await revokeToken(token);
    } catch (e) {
      console.warn('Revoke token error', e);
    } finally {
      chrome.storage.local.remove('oauth_token', () => {});
      setStatus('Not connected');
      connectBtn.disabled = false;
      disconnectBtn.style.display = 'none';
      syncBtn.disabled = true;
    }
  });

  syncBtn.addEventListener('click', () => {
    setStatus('Sync coming in Phase 2');
  });

  // Show parsed timetable from content script
  showLocalBtn.addEventListener('click', async () => {
    listDiv.innerHTML = '';
    const [tab] = await new Promise(resolve => {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs));
    });
    if (!tab) {
      listDiv.textContent = 'No active tab';
      return;
    }
    chrome.tabs.sendMessage(tab.id, { action: 'getTimetable' }, (response) => {
      if (chrome.runtime.lastError) {
        listDiv.textContent = 'No timetable found (content script not injected or wrong page).';
        return;
      }
      const sessions = (response && response.sessions) || [];
      if (!sessions.length) {
        listDiv.textContent = 'No sessions found on this page.';
        return;
      }
      sessions.forEach(s => {
        const div = document.createElement('div');
        div.className = 'session';
        const title = document.createElement('div');
        title.className = 'title';
        title.textContent = s.title || '(no title)';
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = `${s.timeText || ''} • Room: ${s.room || s.roomRaw || '-'}`;
        div.appendChild(title);
        div.appendChild(meta);
        listDiv.appendChild(div);
      });
    });
  });

  // initialize
  checkStatus();
});
