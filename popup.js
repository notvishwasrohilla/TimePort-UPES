document.addEventListener('DOMContentLoaded', () => {
    const timeDisplay = document.getElementById('last-sync-time');
    const cohortDisplay = document.getElementById('cohort-display');
    const syncBtn = document.getElementById('force-sync-btn');
    const authStatus = document.getElementById('auth-status');
    const authBtn = document.getElementById('auth-action-btn');
    const scheduleContainer = document.getElementById('schedule-container');
    const reportBox = document.getElementById('sync-report');

    const ONLINE_COLOR = 'rgb(228, 96, 151)';
    let isLoggedIn = false;

    // -----------------------------------------------------------------------
    // Auth
    // -----------------------------------------------------------------------

    function updateAuthUI() {
        chrome.runtime.sendMessage({ action: 'check_auth' }, (response) => {
            isLoggedIn = Boolean(response && response.status === 'logged_in');
            if (isLoggedIn) {
                authStatus.textContent = response.email || 'Connected';
                authStatus.className = 'auth-pill logged-in';
                authBtn.textContent = 'Log Out';
            } else {
                authStatus.textContent = 'Not Connected';
                authStatus.className = 'auth-pill logged-out';
                authBtn.textContent = 'Log In with Google';
            }
        });
    }
    updateAuthUI();

    authBtn.addEventListener('click', () => {
        // Track state in a variable rather than reading it back off the label.
        const action = isLoggedIn ? 'logout' : 'login';
        authBtn.textContent = 'Processing...';
        chrome.runtime.sendMessage({ action }, () => {
            setTimeout(updateAuthUI, 800);
        });
    });

    // -----------------------------------------------------------------------
    // Hydration
    // -----------------------------------------------------------------------

    chrome.storage.local.get(
        ['lastSyncTime', 'lastCohort', 'latestSessions', 'lastSyncReport'],
        (data) => {
            if (data.lastSyncTime) {
                const options = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
                timeDisplay.textContent = new Date(data.lastSyncTime).toLocaleString('en-US', options);
            }
            cohortDisplay.textContent = data.lastCohort && data.lastCohort !== 'UNKNOWN_COHORT'
                ? data.lastCohort
                : 'Not detected';

            if (data.latestSessions && data.latestSessions.length > 0) {
                renderTiles(data.latestSessions);
            }
            renderReport(data.lastSyncReport);
        }
    );

    // -----------------------------------------------------------------------
    // Sync report — the only place failures are visible to the user
    // -----------------------------------------------------------------------

    function renderReport(report) {
        if (!reportBox) return;
        reportBox.textContent = '';
        if (!report) return;

        const cal = report.calendar || {};
        const line = document.createElement('div');

        if (report.ok) {
            line.className = 'report-line report-ok';
            line.textContent =
                `${cal.inserted || 0} added · ${cal.updated || 0} updated · ${cal.deleted || 0} removed`;
            reportBox.appendChild(line);
            return;
        }

        line.className = 'report-line report-warn';
        line.textContent =
            `${cal.inserted || 0} added · ${cal.updated || 0} updated · ` +
            `${(report.errors || []).length} problem(s)`;
        reportBox.appendChild(line);

        (report.errors || []).slice(0, 4).forEach((err) => {
            const li = document.createElement('div');
            li.className = 'report-error';
            li.textContent = err;
            reportBox.appendChild(li);
        });

        (cal.skipped || []).slice(0, 4).forEach((s) => {
            const li = document.createElement('div');
            li.className = 'report-error';
            li.textContent = `Skipped ${s.subject}: ${s.reason}`;
            reportBox.appendChild(li);
        });
    }

    // -----------------------------------------------------------------------
    // Schedule tiles
    // -----------------------------------------------------------------------

    // API date form "2026-Aug-03" isn't reliably parsed by new Date() across
    // browsers, so compare on a normalized yyyy-mmm-dd token instead.
    const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    function dayToken(dateStr) {
        const m = String(dateStr || '').match(/(\d{4})-([A-Za-z]{3,})-(\d{1,2})/)
            || String(dateStr || '').match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (!m) return null;
        let mo = isNaN(+m[2]) ? MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1 : +m[2];
        return `${m[1]}-${mo}-${+m[3]}`;
    }

    function renderTiles(sessions) {
        const now = new Date();
        const todayToken = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;

        const todaysClasses = sessions.filter((s) => {
            if (s.cancelled) return false;
            const tok = dayToken(s.date);
            return tok === null ? false : tok === todayToken;
        });

        if (todaysClasses.length === 0) return;

        scheduleContainer.textContent = '';

        todaysClasses.forEach((session) => {
            const roomStr = session.room || 'N/A';
            const cat = String(session.venueCategory || '').toLowerCase();

            const isOnline =
                Boolean(session.meetingLink) ||
                cat.includes('virtual') ||
                cat.includes('online') ||
                roomStr.toLowerCase().includes('teams') ||
                roomStr === 'N/A';

            let colorStr = session.colorCode || '#3b82f6';
            if (isOnline) colorStr = ONLINE_COLOR;

            const tile = document.createElement('div');
            tile.className = 'class-tile';
            tile.style.borderLeft = `4px solid ${colorStr}`;

            // Built with DOM nodes, not innerHTML. Subject and room are scraped
            // from a third-party page — interpolating them into markup lets that
            // page inject nodes into the extension UI.
            const header = document.createElement('div');
            header.className = 'tile-header';

            const subjectEl = document.createElement('span');
            subjectEl.className = 'tile-subject';
            subjectEl.textContent = session.subject || 'Untitled';

            const timeEl = document.createElement('span');
            timeEl.className = 'tile-time';
            timeEl.textContent = session.start && session.end
                ? `${session.start} - ${session.end}`
                : (session.start || '');

            header.appendChild(subjectEl);
            header.appendChild(timeEl);

            const footer = document.createElement('div');
            footer.className = 'tile-footer';

            if (isOnline) {
                const link = document.createElement('a');
                link.className = 'teams-link';
                // Use the portal's real meeting link when we have it.
                link.href = session.meetingLink || 'https://teams.microsoft.com/';
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = '📍 Join Microsoft Teams';
                footer.appendChild(link);
            } else {
                const room = document.createElement('span');
                room.className = 'tile-room';
                room.textContent = `📍 ${roomStr}`;
                footer.appendChild(room);
            }

            tile.appendChild(header);
            tile.appendChild(footer);
            scheduleContainer.appendChild(tile);
        });
    }

    // -----------------------------------------------------------------------
    // Force sync — now waits on the real result instead of a setTimeout
    // -----------------------------------------------------------------------

    function finish(label, reload = true) {
        syncBtn.textContent = label;
        syncBtn.style.opacity = '1';
        if (reload) setTimeout(() => location.reload(), 1600);
    }

    syncBtn.addEventListener('click', () => {
        syncBtn.textContent = 'Syncing...';
        syncBtn.style.opacity = '0.7';

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs && tabs[0];
            const url = (tab && tab.url) || '';

            if (!url.includes('myupes')) {
                finish('Open UPES Portal First');
                return;
            }

            chrome.tabs.sendMessage(tab.id, { action: 'force_scan' }, (scanRes) => {
                if (chrome.runtime.lastError) {
                    finish('Please Refresh the UPES Page');
                    return;
                }

                if (!scanRes || scanRes.count === 0) {
                    finish('No classes found on this page');
                    return;
                }

                // content.js fires trigger_sync separately; poll storage for the
                // report it writes on completion.
                const startedAt = Date.now();
                const poll = setInterval(() => {
                    chrome.runtime.sendMessage({ action: 'get_report' }, (res) => {
                        const report = res && res.report;
                        if (report && report.at >= startedAt - 500) {
                            clearInterval(poll);
                            renderReport(report);
                            finish(report.ok ? 'Sync Complete' : 'Synced with warnings');
                        } else if (Date.now() - startedAt > 20000) {
                            clearInterval(poll);
                            finish('Sync timed out');
                        }
                    });
                }, 600);
            });
        });
    });
});
