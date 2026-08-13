importScripts('config.js');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TZ_OFFSET = '+05:30';
const TZ_NAME = 'Asia/Kolkata';
const CAL_BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

// Ownership marker. Lives in extendedProperties.private so the user can edit
// the description without us losing track of the event. Queryable server-side
// via ?privateExtendedProperty=timeport=v1
const TAG_KEY = 'timeport';
const TAG_VAL = 'v1';
const LEGACY_DESCRIPTION = 'Synced via TimePort';

// Base32hex alphabet. Google Calendar requires event IDs to use exactly these
// characters (0-9, a-v), length 5-1024.
const B32HEX = '0123456789abcdefghijklmnopqrstuv';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function getToken(interactive) {
    return new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive }, (token) => {
            const err = chrome.runtime.lastError;
            if (err || !token) {
                reject(new Error(err ? err.message : 'No token returned'));
                return;
            }
            resolve(token);
        });
    });
}

function dropToken(token) {
    return new Promise((resolve) => {
        chrome.identity.removeCachedAuthToken({ token }, resolve);
    });
}

// Returns a fetch wrapper that carries the bearer token and transparently
// refreshes it once on a 401 (cached tokens go stale after ~1h).
function makeClient(initialToken) {
    let token = initialToken;

    return async function request(url, opts = {}) {
        const send = () => fetch(url, {
            ...opts,
            headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token }
        });

        let res = await send();
        if (res.status === 401) {
            await dropToken(token);
            token = await getToken(false);
            res = await send();
        }
        return res;
    };
}

// ---------------------------------------------------------------------------
// Parsing  (never throws, never guesses silently — returns null on failure)
// ---------------------------------------------------------------------------

const MONTHS = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

const pad = (n) => String(n).padStart(2, '0');

// Portal date strings often omit the year. Pick whichever of last/this/next
// year places the date closest to today, rather than assuming the current one
// (which breaks across the Dec/Jan boundary).
function inferYear(month, day) {
    const now = Date.now();
    const y0 = new Date().getFullYear();
    let best = y0;
    let bestDiff = Infinity;
    for (const y of [y0 - 1, y0, y0 + 1]) {
        const diff = Math.abs(new Date(y, month - 1, day).getTime() - now);
        if (diff < bestDiff) { bestDiff = diff; best = y; }
    }
    return best;
}

function validDate(y, m, d) {
    if (!y || !m || !d) return null;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const probe = new Date(y, m - 1, d);
    if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== d) return null;
    return { y, m, d };
}

function parseDate(raw) {
    if (!raw) return null;

    // content.js may already have resolved it into parts
    if (typeof raw === 'object') {
        return validDate(Number(raw.y), Number(raw.m), Number(raw.d));
    }

    const s = String(raw).trim();
    let m;

    // 2026-Aug-03  — the format the timetable API returns.
    if ((m = s.match(/(\d{4})-([A-Za-z]{3,})-(\d{1,2})/))) {
        const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
        if (mo) return validDate(+m[1], mo, +m[3]);
    }

    // 2026-08-03
    if ((m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/))) {
        return validDate(+m[1], +m[2], +m[3]);
    }

    // August 3, 2026  /  Aug 3  /  August 3 2026
    // (?!\d) stops the day group from biting the first two digits off a bare
    // trailing year, e.g. "3 August 2026" reading as August 20.
    if ((m = s.match(/([A-Za-z]{3,})\s+(\d{1,2})(?!\d)(?:\D{1,3}(\d{4}))?/))) {
        const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
        if (mo) return validDate(m[3] ? +m[3] : inferYear(mo, +m[2]), mo, +m[2]);
    }

    // 3 August 2026  /  3 Aug
    if ((m = s.match(/(\d{1,2})(?!\d)\s+([A-Za-z]{3,})(?:\D{1,3}(\d{4}))?/))) {
        const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
        if (mo) return validDate(m[3] ? +m[3] : inferYear(mo, +m[1]), mo, +m[1]);
    }

    // 03/08/2026 — assumed dd/mm/yyyy (Indian portal). Verify against the live grid.
    if ((m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/))) {
        return validDate(+m[3], +m[2], +m[1]);
    }

    return null;
}

function parseClock(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    let m;

    // 9:00 AM / 9.00 pm / 9:00A.M.
    if ((m = s.match(/(\d{1,2})[:.](\d{2})\s*([AaPp])\.?\s*[Mm]/))) {
        let h = +m[1];
        const min = +m[2];
        const isPM = m[3].toLowerCase() === 'p';
        if (h > 12 || min > 59) return null;
        if (isPM && h < 12) h += 12;
        if (!isPM && h === 12) h = 0;
        return { h, m: min };
    }

    // 14:00 — 24h only, anchored so it can't chew a fragment out of "9:00 PM"
    if ((m = s.match(/^(\d{1,2})[:.](\d{2})$/))) {
        const h = +m[1];
        const min = +m[2];
        if (h > 23 || min > 59) return null;
        return { h, m: min };
    }

    return null;
}

// Offset-explicit wall-clock timestamp. Deliberately NOT toISOString(): that
// reinterprets local machine time as UTC, so events shifted for anyone whose
// system clock wasn't set to IST.
function toOffsetISO(dp, clock) {
    return `${dp.y}-${pad(dp.m)}-${pad(dp.d)}T${pad(clock.h)}:${pad(clock.m)}:00${TZ_OFFSET}`;
}

// ---------------------------------------------------------------------------
// Deterministic event IDs
// ---------------------------------------------------------------------------

// Note: cohort is intentionally NOT part of the hash. The target is the user's
// own calendar, so subject+start is already unique for them — and keeping
// cohort out means improving cohort detection later won't orphan every event
// we've already written.
async function eventId(subject, startISO) {
    const norm = `${String(subject).toLowerCase().trim().replace(/\s+/g, ' ')}|${startISO}`;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(norm));
    const bytes = new Uint8Array(digest);
    // 256 is divisible by 32, so `byte & 31` is a uniform mapping into the alphabet.
    let id = 'tp';
    for (let i = 0; i < 24; i++) id += B32HEX[bytes[i] & 31];
    return id;
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

async function pool(items, limit, fn) {
    const out = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const i = cursor++;
            try {
                out[i] = { ok: true, value: await fn(items[i]) };
            } catch (e) {
                out[i] = { ok: false, error: e.message };
            }
        }
    });
    await Promise.all(workers);
    return out;
}

// ---------------------------------------------------------------------------
// Calendar sync
// ---------------------------------------------------------------------------

function buildDesired(sessions) {
    const rows = [];
    const skipped = [];

    for (const s of sessions) {
        // Cancelled classes are dropped here; the diff then deletes any
        // matching calendar event that was created on a previous sync.
        if (s.cancelled) {
            skipped.push({ subject: s.subject || '(no subject)', reason: 'cancelled by portal' });
            continue;
        }

        // The API gives clean fields: date "2026-Aug-03", times "12:00 PM".
        const dp = parseDate(s.date);
        const start = parseClock(s.start);
        const end = parseClock(s.end);

        if (!dp || !start || !end) {
            skipped.push({
                subject: s.subject || '(no subject)',
                reason: !dp ? 'unparseable date' : 'unparseable time',
                raw: { date: s.date, start: s.start, end: s.end }
            });
            continue;
        }

        const startISO = toOffsetISO(dp, start);
        const endISO = toOffsetISO(dp, end);

        if (new Date(endISO).getTime() <= new Date(startISO).getTime()) {
            skipped.push({
                subject: s.subject,
                reason: 'end time is not after start time',
                raw: { start: s.start, end: s.end }
            });
            continue;
        }

        rows.push({ session: s, startISO, endISO });
    }

    return { rows, skipped };
}

// The API tells us the venue category directly, so this is authoritative
// rather than a heuristic. A real meeting link also implies online.
function isOnline(session) {
    const cat = String(session.venueCategory || '').toLowerCase();
    if (cat.includes('virtual') || cat.includes('online')) return true;
    if (session.meetingLink) return true;

    const room = String(session.room || '').toLowerCase().trim();
    return room.includes('teams') || room.includes('virtual') || room === 'n/a' || room === '';
}

function toCalendarEvent(id, row) {
    const s = row.session;
    const online = isOnline(s);

    // Prefer the portal's real meeting link; fall back to a Teams label.
    let location;
    if (s.meetingLink) location = s.meetingLink;
    else if (online) location = 'Microsoft Teams';
    else location = s.room || 'N/A';

    const descLines = [LEGACY_DESCRIPTION];
    if (s.faculty) descLines.push(`Faculty: ${s.faculty}`);
    if (s.moduleCode) descLines.push(`Course: ${s.moduleCode}`);
    if (s.meetingLink) descLines.push(s.meetingLink);

    const event = {
        id,
        summary: s.subject,
        location,
        description: descLines.join('\n'),
        start: { dateTime: row.startISO, timeZone: TZ_NAME },
        end: { dateTime: row.endISO, timeZone: TZ_NAME },
        extendedProperties: { private: { [TAG_KEY]: TAG_VAL } }
    };
    // Flamingo for online sessions; default colour otherwise. Calendar only
    // accepts colorId 1-11, so the portal hex can't be passed through.
    if (online) event.colorId = '4';
    return event;
}

function sameEvent(existing, desired) {
    const e = existing || {};
    return e.summary === desired.summary
        && (e.location || '') === (desired.location || '')
        && new Date(e.start && e.start.dateTime ? e.start.dateTime : 0).getTime()
            === new Date(desired.start.dateTime).getTime()
        && new Date(e.end && e.end.dateTime ? e.end.dateTime : 0).getTime()
            === new Date(desired.end.dateTime).getTime();
}

async function listEvents(request, timeMin, timeMax, tagged) {
    const items = [];
    let pageToken = null;

    do {
        const url = new URL(CAL_BASE);
        url.searchParams.set('timeMin', timeMin);
        url.searchParams.set('timeMax', timeMax);
        url.searchParams.set('singleEvents', 'true');
        url.searchParams.set('showDeleted', 'false');
        url.searchParams.set('maxResults', '250');
        if (tagged) url.searchParams.set('privateExtendedProperty', `${TAG_KEY}=${TAG_VAL}`);
        if (pageToken) url.searchParams.set('pageToken', pageToken);

        const res = await request(url.toString());
        if (!res.ok) throw new Error(`Calendar list failed: ${res.status} ${await res.text()}`);

        const body = await res.json();
        (body.items || []).forEach((e) => items.push(e));
        pageToken = body.nextPageToken || null;
    } while (pageToken);

    return items;
}

// One-time cleanup of events written by the pre-ID version. Those were only
// identifiable by their description, so we delete them and let the diff below
// recreate them with stable IDs.
async function migrateLegacyEvents(request) {
    const done = await chrome.storage.local.get('migratedToStableIds');
    if (done.migratedToStableIds) return 0;

    const from = new Date(Date.now() - 30 * 864e5).toISOString();
    const to = new Date(Date.now() + 120 * 864e5).toISOString();

    const all = await listEvents(request, from, to, false);
    const legacy = all.filter((e) =>
        e.description === LEGACY_DESCRIPTION &&
        !(e.extendedProperties &&
          e.extendedProperties.private &&
          e.extendedProperties.private[TAG_KEY] === TAG_VAL)
    );

    await pool(legacy, 5, (e) =>
        request(`${CAL_BASE}/${encodeURIComponent(e.id)}`, { method: 'DELETE' })
    );

    await chrome.storage.local.set({ migratedToStableIds: true });
    return legacy.length;
}

async function syncToGoogleCalendar(sessions) {
    const report = { inserted: 0, updated: 0, deleted: 0, migrated: 0, skipped: [], errors: [] };

    const { rows, skipped } = buildDesired(sessions);
    report.skipped = skipped;

    if (rows.length === 0) {
        report.errors.push('No sessions had a usable date and time.');
        return report;
    }

    const token = await getToken(false);
    const request = makeClient(token);

    try {
        report.migrated = await migrateLegacyEvents(request);
    } catch (e) {
        report.errors.push(`Legacy migration skipped: ${e.message}`);
    }

    // Desired state, keyed by deterministic ID
    const desired = new Map();
    for (const row of rows) {
        const id = await eventId(row.session.subject, row.startISO);
        desired.set(id, toCalendarEvent(id, row));
    }

    // Purge window is derived from what we actually scraped, so it matches the
    // scrape scope instead of being hardcoded to "today".
    const starts = rows.map((r) => new Date(r.startISO).getTime());
    const ends = rows.map((r) => new Date(r.endISO).getTime());
    const timeMin = new Date(Math.min(...starts) - 3600e3).toISOString();
    const timeMax = new Date(Math.max(...ends) + 3600e3).toISOString();

    const existingList = await listEvents(request, timeMin, timeMax, true);
    const existing = new Map(existingList.map((e) => [e.id, e]));

    const toInsert = [];
    const toUpdate = [];
    for (const [id, event] of desired) {
        if (!existing.has(id)) toInsert.push(event);
        else if (!sameEvent(existing.get(id), event)) toUpdate.push(event);
    }
    const toDelete = [...existing.keys()].filter((id) => !desired.has(id));

    // Insert. A 409 means the ID exists (possibly as a soft-deleted event), so
    // fall through to an update rather than dropping the session.
    const insertResults = await pool(toInsert, 5, async (event) => {
        const res = await request(CAL_BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(event)
        });
        if (res.status === 409) {
            const put = await request(`${CAL_BASE}/${event.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(event)
            });
            if (!put.ok) throw new Error(`${event.summary}: update after conflict ${put.status}`);
            return 'updated';
        }
        if (!res.ok) throw new Error(`${event.summary}: insert ${res.status} ${await res.text()}`);
        return 'inserted';
    });

    const updateResults = await pool(toUpdate, 5, async (event) => {
        const res = await request(`${CAL_BASE}/${event.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(event)
        });
        if (!res.ok) throw new Error(`${event.summary}: update ${res.status}`);
        return 'updated';
    });

    const deleteResults = await pool(toDelete, 5, async (id) => {
        const res = await request(`${CAL_BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!res.ok && res.status !== 410 && res.status !== 404) {
            throw new Error(`delete ${id}: ${res.status}`);
        }
        return 'deleted';
    });

    for (const r of insertResults) {
        if (!r.ok) report.errors.push(r.error);
        else if (r.value === 'inserted') report.inserted++;
        else report.updated++;
    }
    for (const r of updateResults) {
        if (!r.ok) report.errors.push(r.error);
        else report.updated++;
    }
    for (const r of deleteResults) {
        if (!r.ok) report.errors.push(r.error);
        else report.deleted++;
    }

    return report;
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

async function pushToSupabase(cohortId, scheduleData) {
    // Fail closed. Writing under a guessed cohort would overwrite another
    // cohort's row, since the upsert merges on cohort_id.
    if (!cohortId || cohortId === 'UNKNOWN_COHORT') {
        return { ok: false, error: 'Cohort not detected — skipped cloud push.' };
    }

    try {
        const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/timetables`, {
            method: 'POST',
            headers: {
                apikey: CONFIG.SUPABASE_KEY,
                Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                Prefer: 'resolution=merge-duplicates'
            },
            body: JSON.stringify({
                cohort_id: cohortId,
                schedule_data: scheduleData,
                last_updated: new Date().toISOString()
            })
        });

        if (!res.ok) {
            return { ok: false, error: `Supabase ${res.status}: ${await res.text()}` };
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, error: `Supabase unreachable: ${e.message}` };
    }
}

// ---------------------------------------------------------------------------
// Sync orchestration
// ---------------------------------------------------------------------------

// Coalesces concurrent syncs. Two portal tabs both polling would otherwise
// race through check-then-insert and both win.
let syncInFlight = null;

function runSync(cohort, sessions) {
    if (syncInFlight) return syncInFlight;

    syncInFlight = (async () => {
        const report = {
            at: Date.now(),
            cohort,
            sessionCount: sessions.length,
            calendar: null,
            cloud: null,
            errors: []
        };

        const [cloud, calendar] = await Promise.allSettled([
            pushToSupabase(cohort, sessions),
            syncToGoogleCalendar(sessions)
        ]);

        if (cloud.status === 'fulfilled') {
            report.cloud = cloud.value;
            if (!cloud.value.ok) report.errors.push(cloud.value.error);
        } else {
            report.errors.push(`Cloud push failed: ${cloud.reason.message}`);
        }

        if (calendar.status === 'fulfilled') {
            report.calendar = calendar.value;
            report.errors.push(...calendar.value.errors);
        } else {
            const msg = calendar.reason.message || String(calendar.reason);
            report.errors.push(
                /No token|OAuth2 not granted|not signed in/i.test(msg)
                    ? 'Not signed in to Google — open the popup and log in.'
                    : `Calendar sync failed: ${msg}`
            );
        }

        report.ok = report.errors.length === 0;
        await chrome.storage.local.set({ lastSyncReport: report });
        return report;
    })();

    syncInFlight.finally(() => { syncInFlight = null; });
    return syncInFlight;
}

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'trigger_sync' && message.data) {
        (async () => {
            await chrome.storage.local.set({
                lastSyncTime: Date.now(),
                lastCohort: message.cohort,
                latestSessions: message.data
            });

            try {
                const report = await runSync(message.cohort, message.data);
                sendResponse({ status: report.ok ? 'complete' : 'partial', report });
            } catch (e) {
                sendResponse({ status: 'failed', error: e.message });
            }
        })();
        return true;
    }

    if (message.action === 'get_report') {
        chrome.storage.local.get('lastSyncReport').then((d) => {
            sendResponse({ report: d.lastSyncReport || null });
        });
        return true;
    }

    if (message.action === 'check_auth') {
        (async () => {
            try {
                const token = await getToken(false);
                const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                    headers: { Authorization: 'Bearer ' + token }
                });
                const data = res.ok ? await res.json() : {};
                sendResponse({ status: 'logged_in', email: data.email || 'Connected' });
            } catch (e) {
                sendResponse({ status: 'logged_out' });
            }
        })();
        return true;
    }

    if (message.action === 'login') {
        (async () => {
            try {
                await getToken(true);
                sendResponse({ status: 'success' });
            } catch (e) {
                sendResponse({ status: 'failed', error: e.message });
            }
        })();
        return true;
    }

    if (message.action === 'logout') {
        (async () => {
            try {
                const token = await getToken(false);
                await dropToken(token);
                await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
            } catch (e) {
                // already signed out
            }
            sendResponse({ status: 'logged_out' });
        })();
        return true;
    }
});
