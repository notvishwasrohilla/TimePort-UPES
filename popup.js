document.addEventListener('DOMContentLoaded', function() {
  // Find the active tab to inject the content script
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      files: ['content.js']
    }, (injectionResults) => {
      // The result is an array, we want the result from the first (and only) injected script
      const timetableData = injectionResults[0].result;
      const container = document.getElementById('timetable-container');
      const messageEl = document.getElementById('message');

      if (!timetableData || timetableData.length === 0) {
        messageEl.textContent = "Couldn't find a timetable on this page.";
        return;
      }
      
      // Clear the "Loading..." message
      container.innerHTML = '';

      // Create and append a div for each session
      timetableData.forEach(session => {
        const sessionDiv = document.createElement('div');
        sessionDiv.className = 'session';

        const nameDiv = document.createElement('div');
        nameDiv.className = 'session-name';
        nameDiv.textContent = session.name;

        const timeDiv = document.createElement('div');
        timeDiv.className = 'session-time';
        timeDiv.textContent = session.time;

        sessionDiv.appendChild(nameDiv);
        sessionDiv.appendChild(timeDiv);
        container.appendChild(sessionDiv);
      });
    });
  });
});
