// UPES TimePort – SPA-safe daily timetable scraper
(() => {
  const SEL = ".session-info-container ul li.course-red-wrapper";
  let last = "";
  let dead = false;

  function safeSend(msg) {
    try {
      if (chrome?.runtime?.id) {
        chrome.runtime.sendMessage(msg);
      }
    } catch (e) {
      dead = true;
    }
  }

  function scrape() {
    if (dead) return;

    const items = document.querySelectorAll(SEL);
    if (!items || !items.length) return;

    const sessions = Array.from(items).map(li => ({
      title: li.querySelector("b")?.textContent.trim() || "",
      courseLine: li.querySelector("span[style]")?.textContent.trim() || "",
      timeText: li.querySelector("p")?.textContent.trim() || "",
      room: li.querySelector(".session-venue-info b")
        ?.textContent.replace(/\(.*\)/, "")
        .trim() || ""
    }));

    const s = JSON.stringify(sessions);
    if (s !== last) {
      last = s;
      window.__UPES_TIMETABLE = sessions;
      safeSend({ action: "timetableUpdated" });
    }
  }

  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.action === "getTimetable") {
      scrape();
      sendResponse({ sessions: window.__UPES_TIMETABLE || [] });
    }
  });

  const obs = new MutationObserver(() => scrape());
  if (document.body) {
    obs.observe(document.body, { childList: true, subtree: true });
  }

  const poll = setInterval(() => {
    if (dead) clearInterval(poll);
    else scrape();
  }, 1200);

  setTimeout(scrape, 800);
})();
