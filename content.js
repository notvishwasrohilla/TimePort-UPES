console.log("TimePort: Inside Man is active (API mode).");

let lastPayloadString = "";
let latestSessions = null;
let currentCohort = null;

// -------------------------------------------------------------------------
// Inject the page-world listener that captures the timetable API response.
// content.js runs in an isolated world and can't see the app's fetch/XHR,
// so inject.js does the capture and posts the trimmed payload back to us.
// -------------------------------------------------------------------------

function injectSniffer() {
    try {
        const s = document.createElement('script');
        s.src = chrome.runtime.getURL('inject.js');
        s.onload = () => s.remove();
        (document.head || document.documentElement).appendChild(s);
    } catch (e) {
        console.warn("TimePort: injection failed", e.message);
    }
}
injectSniffer();

// -------------------------------------------------------------------------
// Cohort resolution.
// The payload lists a cohort per session as "BT-CSE-SPZ-CSF-VII-B14_<mod>";
// inject.js already strips the "_<mod>" suffix. Shared lectures list several
// cohorts, but the student's own batch is the ONE present in every session —
// so we intersect across all sessions rather than guessing.
// -------------------------------------------------------------------------

function resolveCohort(sessions) {
    if (!sessions.length) return null;

    // Start from the first session's cohorts, keep only those seen everywhere.
    let common = new Set(sessions[0].cohorts || []);
    for (const s of sessions) {
        const here = new Set(s.cohorts || []);
        common = new Set([...common].filter((c) => here.has(c)));
        if (common.size === 0) break;
    }

    if (common.size === 1) return [...common][0];

    // Fallback: the cohort appearing in the most sessions.
    const tally = {};
    for (const s of sessions) {
        for (const c of s.cohorts || []) tally[c] = (tally[c] || 0) + 1;
    }
    const ranked = Object.keys(tally).sort((a, b) => tally[b] - tally[a]);
    return ranked[0] || null;
}

// -------------------------------------------------------------------------
// Receive the payload from inject.js
// -------------------------------------------------------------------------

window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__timeport !== true || !Array.isArray(d.sessions)) return;

    handleSessions(d.sessions, { auto: true });
});

function handleSessions(sessions, opts = {}) {
    latestSessions = sessions;
    currentCohort = resolveCohort(sessions);

    const payloadString = JSON.stringify(sessions);
    const changed = payloadString !== lastPayloadString;

    if (!currentCohort) {
        console.warn("TimePort: cohort could not be resolved — cloud push will be skipped.");
    } else {
        console.log(`TimePort: cohort ${currentCohort}, ${sessions.length} sessions.`);
    }

    if (sessions.length > 0 && (changed || opts.force)) {
        try {
            chrome.runtime.sendMessage({
                action: "trigger_sync",
                data: sessions,
                cohort: currentCohort || "UNKNOWN_COHORT"
            });
            lastPayloadString = payloadString;
        } catch (err) {
            // Extension reloaded — the old content script is orphaned.
            console.warn("TimePort: extension context gone.", err.message);
        }
    }
}

// -------------------------------------------------------------------------
// Force Sync from the popup.
// The page may have already fetched the timetable (and we cached it), so a
// force sync replays the last payload. If we've never seen one, tell the
// popup so it can ask the user to open the Time Table tab.
// -------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "force_scan") {
        if (latestSessions && latestSessions.length) {
            handleSessions(latestSessions, { force: true });
            sendResponse({ status: "scanned", count: latestSessions.length });
        } else {
            sendResponse({ status: "no_data", count: 0 });
        }
    }
    return true;
});
