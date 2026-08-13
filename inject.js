// inject.js — runs in the PAGE's main world.
//
// A content script lives in an isolated world with its own copy of
// window.fetch, so patching from there would never see the Angular app's
// traffic. This has to be injected.
//
// It only READS responses the page already requested — it issues no requests
// of its own and touches no credentials. The one endpoint it cares about is
// the timetable payload, which it trims to the fields TimePort needs before
// handing it to the content script.

(() => {
    if (window.__timeportSniffer) return;
    window.__timeportSniffer = true;

    const TIMETABLE = /\/apigateway\/api\/timetable\/?(\?|$)/;

    function trim(sessions) {
        if (!Array.isArray(sessions)) return null;

        return sessions.map((s) => {
            const fp = s.FloorPlanDetails || {};
            const mod = (s.ModuleList || [])[0] || {};
            return {
                id: s.Id,
                subject: mod.ModuleName || '',
                moduleCode: mod.ModuleCode || '',
                date: s.SlotDate || '',
                start: s.SlotStartTime || '',
                end: s.SlotEndTime || '',
                room: fp.VenueName || '',
                venueCategory: fp.VenueCategory || '',
                colorCode: fp.ColorCode || '',
                meetingLink: fp.MeetingLink || '',
                faculty: ((s.TeacherList || [])[0] || {}).Name || '',
                // Cohort codes arrive as "BT-CSE-SPZ-CSF-VII-B14_CSSF4115P_1";
                // everything before the first underscore is the batch.
                cohorts: (s.CohortList || []).map((c) => String(c.Code || '').split('_')[0]),
                cancelled: Boolean(s.IsCancelledSlot),
                recurring: Boolean(s.IsRecurringSlot)
            };
        });
    }

    function report(url, text) {
        if (!TIMETABLE.test(String(url))) return;
        if (!text || text.length > 4000000) return;

        let parsed;
        try { parsed = JSON.parse(text); } catch (e) { return; }

        const sessions = trim(parsed);
        if (!sessions || !sessions.length) return;

        // Same-origin target so other scripts on the page can't listen in.
        window.postMessage({ __timeport: true, sessions }, location.origin);
    }

    const origFetch = window.fetch;
    window.fetch = function (...args) {
        return origFetch.apply(this, args).then((res) => {
            try {
                const a = args[0];
                const url = typeof a === 'string' ? a : (a && a.url) || '';
                if (TIMETABLE.test(String(url))) {
                    res.clone().text().then((t) => report(url, t)).catch(() => {});
                }
            } catch (e) { /* never break the app's own request */ }
            return res;
        });
    };

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__tpUrl = url;
        return origOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
        this.addEventListener('load', () => {
            try { report(this.__tpUrl || '', this.responseText); } catch (e) {}
        });
        return origSend.apply(this, args);
    };
})();
