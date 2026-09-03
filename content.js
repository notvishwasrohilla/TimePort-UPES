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

// A cohort must appear in at least this share of sessions to be believed.
// Strict intersection doesn't work: shared open electives carry their own
// cohort naming ("SLOT 2-EXPLO-..."), so no single code appears in literally
// every session. The student's own batch is still the overwhelming majority.
const COHORT_MIN_SHARE = 0.6;

// Guards against resolving from a partial payload. The portal fires this
// endpoint more than once — a small "today" response and the full range —
// and a 3-session sample is not enough to identify a batch.
const COHORT_MIN_SESSIONS = 10;

function resolveCohort(sessions) {
    if (sessions.length < COHORT_MIN_SESSIONS) {
        console.warn(
            `TimePort: only ${sessions.length} sessions so far — waiting for a fuller payload ` +
            `before resolving the cohort.`
        );
        return null;
    }

    const tally = {};
    for (const s of sessions) {
        // Count each code once per session, not once per occurrence.
        for (const c of new Set(s.cohorts || [])) tally[c] = (tally[c] || 0) + 1;
    }

    const ranked = Object.keys(tally).sort((a, b) => tally[b] - tally[a]);
    const top = ranked[0];
    if (!top) return null;

    const share = tally[top] / sessions.length;
    if (share < COHORT_MIN_SHARE) {
        console.warn(
            `TimePort: no clear cohort — best is ${top} at ${(share * 100).toFixed(0)}% ` +
            `of ${sessions.length} sessions. Cloud push will be skipped.`
        );
        return null;
    }

    return top;
}

// -------------------------------------------------------------------------
// Receive the payload from inject.js
// -------------------------------------------------------------------------

// Sessions accumulate across responses. The portal fires the endpoint several
// times (today's view, then the full range, then again when you change month),
// and a later partial response must not clobber a fuller earlier one.
const sessionsById = new Map();

window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__timeport !== true || !Array.isArray(d.sessions)) return;

    const before = sessionsById.size;
    for (const s of d.sessions) {
        // Fall back to a composite key if the API ever omits Id.
        const key = s.id != null ? String(s.id) : `${s.date}|${s.start}|${s.subject}`;
        sessionsById.set(key, s);
    }

    console.log(
        `TimePort: payload of ${d.sessions.length} sessions ` +
        `(known: ${before} -> ${sessionsById.size}).`
    );

    handleSessions([...sessionsById.values()], { auto: true });
});

function handleSessions(sessions, opts = {}) {
    // Shape guard. If this ever fires, the payload isn't the API shape and
    // something upstream changed — better to say so here than to let the
    // background report 158 identical "unparseable date" failures.
    const malformed = sessions.filter((s) => !s.date || !s.start || !s.end);
    if (malformed.length) {
        console.error(
            `TimePort: ${malformed.length}/${sessions.length} sessions are missing date/start/end. ` +
            `Sample: ${JSON.stringify(malformed[0])}`
        );
    }

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
        if (sessionsById.size) {
            const all = [...sessionsById.values()];
            handleSessions(all, { force: true });
            sendResponse({ status: "scanned", count: all.length });
        } else {
            sendResponse({ status: "no_data", count: 0 });
        }
    }
    return true;
});
