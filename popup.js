document.addEventListener("DOMContentLoaded", () => {
  const statusText = document.getElementById("status");
  const statusDot = document.getElementById("statusDot");
  const connectBtn = document.getElementById("connectBtn");

  function setStatus(text, color) {
    statusText.textContent = text;
    statusDot.style.background = color;
  }

  connectBtn.onclick = async () => {
    setStatus("Connecting…", "#999");

    chrome.runtime.sendMessage(
      { action: "get_token" },
      response => {
        if (chrome.runtime.lastError) {
          setStatus("Auth failed", "#c03");
          console.error(chrome.runtime.lastError);
          return;
        }

        if (!response || !response.success) {
          setStatus("Auth failed", "#c03");
          console.error(response?.error);
          return;
        }

        setStatus("Connected", "#2a9d3a");
      }
    );
  };

  setStatus("Not connected", "#c03");
});
