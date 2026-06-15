/* ==========================================================================
   charting.js — Domain logic for natural fertility charting
   --------------------------------------------------------------------------
   Pure, dependency-free functions that encode a natural method of cycle
   charting for Natural Family Planning: the discharge recording code (VDRS),
   Peak Day identification + counting, and automatic sticker assignment.

   No network, no DOM. Exposed as the global `Charting`.
   ========================================================================== */
(function (global) {
    'use strict';

    /* ----------------------------------------------------------------------
       Reference data — the standardized VDRS vocabulary.
       These are the options a user picks; the code string and sticker are
       then derived automatically.
       ---------------------------------------------------------------------- */

    // Menstrual / bleeding flow (recorded instead of a mucus observation).
    const FLOW = [
        { code: 'H',  label: 'Heavy bleeding' },
        { code: 'M',  label: 'Moderate bleeding' },
        { code: 'L',  label: 'Light bleeding' },
        { code: 'VL', label: 'Very light bleeding' },
        { code: 'B',  label: 'Brown / black bleeding' }
    ];

    // VDRS category number — the single most fertile observation of the day.
    // `mucus: true` means the category represents cervical mucus (possibly
    // fertile); `mucus: false` is a dry-type day.
    const CATEGORY = [
        { code: '0',    label: 'Dry — nothing seen, nothing felt', mucus: false },
        { code: '2',    label: 'Damp or moist, without lubrication', mucus: false },
        { code: '2W',   label: 'Wet, without lubrication', mucus: false },
        { code: '4',    label: 'Damp, moist or wet — with lubrication', mucus: true },
        { code: '6',    label: 'Sticky / pasty (¼ inch stretch)', mucus: true },
        { code: '8',    label: 'Tacky / gummy (½–¾ inch stretch)', mucus: true },
        { code: '10',   label: 'Stretchy (1 inch or more)', mucus: true },
        { code: '10DL', label: 'Dry, with lubrication', mucus: true },
        { code: '10SL', label: 'Shiny, with lubrication', mucus: true },
        { code: '10WL', label: 'Wet, with lubrication', mucus: true }
    ];

    // Color / quality descriptor letters appended to the category number.
    const DESCRIPTOR = [
        { code: 'B',   label: 'Brown (or black)' },
        { code: 'C',   label: 'Cloudy (white)' },
        { code: 'C/K', label: 'Cloudy / clear' },
        { code: 'K',   label: 'Clear' },
        { code: 'G',   label: 'Gummy (gluey)' },
        { code: 'L',   label: 'Lubricative' },
        { code: 'P',   label: 'Pasty (creamy)' },
        { code: 'Y',   label: 'Yellow (even pale yellow)' }
    ];

    // How many times the most fertile sign was seen that day.
    const FREQUENCY = [
        { code: 'X1', label: 'Once during the day' },
        { code: 'X2', label: 'Twice during the day' },
        { code: 'X3', label: 'Three times during the day' },
        { code: 'AD', label: 'All day' }
    ];

    // Descriptors that, by themselves, signal true cervical mucus even when the
    // category alone might look dry. Used to decide white-baby vs green stickers.
    const MUCUS_DESCRIPTORS = ['C', 'C/K', 'K', 'G', 'L', 'P', 'Y'];

    // Flows light enough that cervical mucus can still be observed underneath
    // them — on these days we still ask the mucus question (and may record it).
    const LIGHT_FLOWS = ['L', 'VL', 'B'];

    // Categories that describe a NON-mucus (dry-type) day. A descriptor that
    // implies actual mucus is therefore impossible alongside these.
    const DRY_CATEGORIES = ['0', '2', '2W'];

    /* ----------------------------------------------------------------------
       Sticker types
       ---------------------------------------------------------------------- */
    const STICKER = {
        NONE:        'none',         // no observation recorded yet
        RED:         'red',          // menstrual bleeding
        GREEN:       'green',        // dry day — infertile
        WHITE_BABY:  'white-baby',   // mucus / fertile — conception possible
        GREEN_BABY:  'green-baby',   // mucus during established infertility (post-Peak)
        YELLOW:      'yellow',       // special circumstance (set manually)
        YELLOW_BABY: 'yellow-baby'   // discharge during a special yellow-stamp protocol
    };

    /* ----------------------------------------------------------------------
       Helpers
       ---------------------------------------------------------------------- */

    function find(list, code) {
        return list.find(function (item) { return item.code === code; }) || null;
    }

    // Does this day record any cervical mucus (i.e. potentially fertile)?
    function dayHasMucus(day) {
        if (!day || !day.observation) return false;
        const cat = find(CATEGORY, day.observation.category);
        if (cat && cat.mucus) return true;
        const desc = day.observation.descriptors || [];
        return desc.some(function (d) { return MUCUS_DESCRIPTORS.indexOf(d) !== -1; });
    }

    function dayHasFlow(day) {
        return !!(day && day.flow);
    }

    // Has the user recorded anything at all for this day?
    function dayHasEntry(day) {
        return dayHasFlow(day) || !!(day && day.observation) || (day && day.peak);
    }

    function flowIsLight(day) {
        return dayHasFlow(day) && LIGHT_FLOWS.indexOf(day.flow) !== -1;
    }

    /* ----------------------------------------------------------------------
       VDRS code string — what gets written on the chart line for a day.
       e.g. "8KLx2", "10WLx3 (AD)", "VL", "H", "L 6CKx2"
       ---------------------------------------------------------------------- */
    function buildObsCode(o) {
        if (!o || !o.category) return '';
        let s = o.category;
        if (o.descriptors && o.descriptors.length) {
            s += o.descriptors.join('');
        }
        if (o.frequency) {
            // X1/X2/X3 render as a lowercase x; AD renders as itself.
            s += /^X[123]$/.test(o.frequency)
                ? o.frequency.toLowerCase()
                : ' ' + o.frequency;
        }
        return s.trim();
    }

    function buildCode(day) {
        if (!day) return '';
        if (dayHasFlow(day)) {
            // On light/very-light/brown days mucus can still be seen, so we
            // append any observation that was recorded alongside the bleeding.
            const obs = buildObsCode(day.observation);
            if (flowIsLight(day) && obs && day.observation.category !== '0') {
                return day.flow + ' ' + obs;
            }
            return day.flow;
        }
        return buildObsCode(day.observation);
    }

    /* ----------------------------------------------------------------------
       Validation — reject combinations that cannot physically happen, so the
       chart stays meaningful (e.g. category "0" = nothing seen, yet a Yellow
       descriptor would claim mucus was seen).
       Returns { ok: true } or { ok: false, message }.
       ---------------------------------------------------------------------- */
    function validateDraft(draft) {
        if (!draft) return { ok: true };
        const o = draft.observation;
        if (!o) return { ok: true };
        const hasDesc = o.descriptors && o.descriptors.length;

        if (!o.category && (hasDesc || o.frequency)) {
            return { ok: false, message: 'Choose an observation category before adding color, quality, or frequency.' };
        }
        if (o.category === '0' && hasDesc) {
            return { ok: false, message: 'A “0” day means nothing was seen — it can’t also have a colour/quality descriptor (e.g. “0 Yellow” is impossible).' };
        }
        if (DRY_CATEGORIES.indexOf(o.category) !== -1 && o.descriptors && o.descriptors.indexOf('L') !== -1) {
            return { ok: false, message: '“Lubricative” describes mucus, so it can’t go with a without-lubrication category.' };
        }
        return { ok: true };
    }

    /* ----------------------------------------------------------------------
       Peak Day + counting.

       Peak Day = the LAST day of mucus that is clear, stretchy (≥1 inch) or
       lubricative. In this app the user marks the Peak explicitly; we then
       label the following three days 1, 2, 3 (the post-Peak count). Those
       count days are still treated as fertile: a count day with mucus is a
       white baby, while a dry count day is a green baby (dry-looking, but
       still counted).
       ---------------------------------------------------------------------- */

    // Index of the Peak day within a days array, or -1.
    function findPeakIndex(days) {
        for (let i = days.length - 1; i >= 0; i--) {
            if (days[i] && days[i].peak) return i;
        }
        return -1;
    }

    // The count label for a given day index ('P', '1', '2', '3', or '').
    function peakLabel(index, peakIndex) {
        if (peakIndex < 0) return '';
        if (index === peakIndex) return 'P';
        const diff = index - peakIndex;
        if (diff >= 1 && diff <= 3) return String(diff);
        return '';
    }

    /* ----------------------------------------------------------------------
       Sticker assignment — the visual interpretation of fertility.

         🔴 red          → bleeding
         🟢 green         → dry / infertile
         ⚪👶 white-baby  → mucus (incl. the Peak Day) → conception possible
         🟢👶 green-baby  → a dry post-Peak count day (1·2·3), or mucus during
                            established post-Peak infertility
         🟡 yellow        → manual override for special situations

       Rules applied (to identify the fertile window):
         • Bleeding ............................. red
         • Peak Day ............................ white baby
         • Count day 1·2·3 with mucus .......... white baby
         • Count day 1·2·3 when dry ............ green baby (dry, still counted)
         • Mucus before the fertile window ..... white baby
         • Mucus after Peak+3 (post-Peak) ...... green baby
         • Dry day ............................. green
       ---------------------------------------------------------------------- */
    function getSticker(day, index, days) {
        if (!dayHasEntry(day)) return STICKER.NONE;

        // Explicit manual override always wins (e.g. yellow-stamp protocols).
        if (day.stickerOverride) return day.stickerOverride;

        if (dayHasFlow(day)) return STICKER.RED;

        const peakIndex = findPeakIndex(days);
        const label = peakLabel(index, peakIndex);
        const hasMucus = dayHasMucus(day);

        // The Peak Day is the last day of fertile mucus → always white baby.
        if (label === 'P') return STICKER.WHITE_BABY;

        // Count days 1·2·3 stay fertile: white baby if mucus is still present,
        // otherwise a green baby — dry-looking, but still within the count.
        if (label) return hasMucus ? STICKER.WHITE_BABY : STICKER.GREEN_BABY;

        if (!hasMucus) return STICKER.GREEN;

        // Mucus present, outside the count. After Peak+3 it occurs during
        // established infertility → green baby; otherwise it is part of (or
        // building toward) the fertile window → white baby.
        if (peakIndex >= 0 && index > peakIndex + 3) {
            return STICKER.GREEN_BABY;
        }
        return STICKER.WHITE_BABY;
    }

    /* ----------------------------------------------------------------------
       Intercourse guidance — educational hints from the method's rules,
       tailored to the couple's goal. NOT medical advice.

       intent: 'avoid' | 'conceive'
       returns { level, title, detail } or null when no guidance applies.
       level: 'fertile' | 'available' | 'best' | 'good' | 'wait'
       ---------------------------------------------------------------------- */
    function intercourseGuidance(day, index, days, intent) {
        if (intent !== 'avoid' && intent !== 'conceive') return null;
        if (!dayHasEntry(day)) return null;

        const peakIndex = findPeakIndex(days);
        const label = peakLabel(index, peakIndex);
        const bleeding = dayHasFlow(day);
        const mucus = dayHasMucus(day);
        const isPeak = label === 'P';
        const isCount = label === '1' || label === '2' || label === '3';
        const postPeak = peakIndex >= 0 && index > peakIndex + 3;
        const fertile = isPeak || isCount || mucus;

        if (intent === 'avoid') {
            if (bleeding) {
                return { level: 'fertile', title: 'Avoid', detail: 'Bleeding can mask mucus, so days of flow are treated as fertile.' };
            }
            if (fertile) {
                return { level: 'fertile', title: 'Avoid — fertile', detail: 'A fertile sign is present (or you’re within Peak + 3). Conception is possible.' };
            }
            if (postPeak) {
                return { level: 'available', title: 'Likely available', detail: 'Post-Peak infertile phase — any time, day or evening.' };
            }
            // Dry day before Peak.
            return { level: 'available', title: 'Available — evenings, EOD', detail: 'Dry day before Peak: evenings only and every other day, so residue isn’t mistaken for mucus.' };
        }

        // intent === 'conceive'
        if (isPeak) {
            return { level: 'best', title: 'Best chance', detail: 'Peak Day — usually the most fertile day of the whole cycle.' };
        }
        if (mucus && !postPeak) {
            return { level: 'best', title: 'Very fertile', detail: 'Fertile-type mucus is present — a prime time to try, especially around Peak.' };
        }
        if (isCount) {
            return { level: 'good', title: 'Still fertile', detail: 'Just after Peak — fertility is winding down, but conception is still possible.' };
        }
        if (bleeding) {
            return { level: 'wait', title: 'Wait', detail: 'Menstruation — watch for mucus to return.' };
        }
        if (postPeak) {
            return { level: 'wait', title: 'Window passed', detail: 'The fertile window has likely closed for this cycle.' };
        }
        return { level: 'wait', title: 'Building', detail: 'Dry for now — watch for mucus as fertility builds toward Peak.' };
    }

    /* ----------------------------------------------------------------------
       Plain-language interpretation for a day (shown to the user).
       ---------------------------------------------------------------------- */
    function interpret(sticker, label) {
        switch (sticker) {
            case STICKER.RED:        return 'Menstrual bleeding.';
            case STICKER.GREEN:      return 'Dry day — a time of infertility.';
            case STICKER.GREEN_BABY:
                if (label === '1' || label === '2' || label === '3') {
                    return 'Day ' + label + ' after Peak — dry, but still counted as fertile.';
                }
                return 'Discharge during the infertile phase after Peak.';
            case STICKER.YELLOW:     return 'Special discharge day (yellow-stamp protocol).';
            case STICKER.YELLOW_BABY:return 'Discharge recorded during a yellow-stamp protocol.';
            case STICKER.WHITE_BABY:
                if (label === 'P') return 'Peak Day — the last day of fertile-type mucus.';
                if (label === '1' || label === '2' || label === '3') {
                    return 'Day ' + label + ' after Peak — mucus still present, fertile.';
                }
                return 'Mucus present — a potentially fertile day.';
            default: return 'No observation recorded.';
        }
    }

    /* ----------------------------------------------------------------------
       Cycle-level summary: Peak day, cycle length, fertile-window span.
       ---------------------------------------------------------------------- */
    function summarizeCycle(days) {
        const peakIndex = findPeakIndex(days);
        const recorded = days.filter(dayHasEntry).length;
        let firstMucus = -1;
        let lastEntry = -1;
        for (let i = 0; i < days.length; i++) {
            if (dayHasMucus(days[i]) && firstMucus === -1) firstMucus = i;
            if (dayHasEntry(days[i])) lastEntry = i;
        }
        // Days past Peak — how far the post-Peak phase has progressed. Counted
        // from the last day that has any entry (the furthest you've charted).
        const daysPastPeak = (peakIndex >= 0 && lastEntry > peakIndex)
            ? lastEntry - peakIndex
            : null;
        return {
            peakDay: peakIndex >= 0 ? peakIndex + 1 : null,
            recordedDays: recorded,
            cycleLength: days.length,
            firstMucusDay: firstMucus >= 0 ? firstMucus + 1 : null,
            fertileWindowEnd: peakIndex >= 0 ? peakIndex + 4 : null, // Peak + 3 (1-indexed day number)
            daysPastPeak: daysPastPeak
        };
    }

    /* ---------------------------------------------------------------------- */
    global.Charting = {
        FLOW: FLOW,
        CATEGORY: CATEGORY,
        DESCRIPTOR: DESCRIPTOR,
        FREQUENCY: FREQUENCY,
        STICKER: STICKER,
        LIGHT_FLOWS: LIGHT_FLOWS,
        DRY_CATEGORIES: DRY_CATEGORIES,
        buildCode: buildCode,
        buildObsCode: buildObsCode,
        validateDraft: validateDraft,
        flowIsLight: flowIsLight,
        getSticker: getSticker,
        intercourseGuidance: intercourseGuidance,
        findPeakIndex: findPeakIndex,
        peakLabel: peakLabel,
        dayHasMucus: dayHasMucus,
        dayHasFlow: dayHasFlow,
        dayHasEntry: dayHasEntry,
        interpret: interpret,
        summarizeCycle: summarizeCycle
    };
})(window);
