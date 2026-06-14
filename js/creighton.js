/* ==========================================================================
   creighton.js — Domain logic for the Creighton Model FertilityCare System
   --------------------------------------------------------------------------
   Pure, dependency-free functions that encode the standardized rules of the
   Creighton Model (CrMS): the Vaginal Discharge Recording System (VDRS),
   Peak Day identification + counting, and automatic sticker assignment.

   No network, no DOM. Exposed as the global `Creighton`.
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

    /* ----------------------------------------------------------------------
       VDRS code string — what gets written on the chart line for a day.
       e.g. "8KLx2", "10WLx3 (AD)", "VL", "H"
       ---------------------------------------------------------------------- */
    function buildCode(day) {
        if (!day) return '';
        if (dayHasFlow(day)) {
            return day.flow;
        }
        if (!day.observation) return '';
        const o = day.observation;
        let s = o.category || '';
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

    /* ----------------------------------------------------------------------
       Peak Day + counting.

       Peak Day = the LAST day of mucus that is clear, stretchy (≥1 inch) or
       lubricative. In this app the user marks the Peak explicitly; we then
       label the following three days 1, 2, 3 (the post-Peak count). Those
       count days remain fertile (white baby) regardless of what is observed.
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
         ⚪👶 white-baby  → mucus or a count day (1–3) → conception possible
         🟢👶 green-baby  → mucus appearing during established post-Peak infertility
         🟡 yellow        → manual override for special situations

       Rules applied (standard CrMS, to identify the fertile window):
         • Bleeding  ............................. red
         • Count days P, +1, +2, +3 ............. white baby (always fertile)
         • Any mucus before/at the fertile window white baby
         • Mucus after Peak+3 (post-Peak phase) . green baby
         • Dry day .............................. green
       ---------------------------------------------------------------------- */
    function getSticker(day, index, days) {
        if (!dayHasEntry(day)) return STICKER.NONE;

        // Explicit manual override always wins (e.g. yellow-stamp protocols).
        if (day.stickerOverride) return day.stickerOverride;

        if (dayHasFlow(day)) return STICKER.RED;

        const peakIndex = findPeakIndex(days);
        const label = peakLabel(index, peakIndex);

        // Peak day and the three days that follow are always fertile.
        if (label) return STICKER.WHITE_BABY;

        const hasMucus = dayHasMucus(day);
        if (!hasMucus) return STICKER.GREEN;

        // Mucus present. If we are past the post-Peak count, this discharge
        // occurs during established infertility → green baby. Otherwise it is
        // part of (or building toward) the fertile window → white baby.
        if (peakIndex >= 0 && index > peakIndex + 3) {
            return STICKER.GREEN_BABY;
        }
        return STICKER.WHITE_BABY;
    }

    /* ----------------------------------------------------------------------
       Plain-language interpretation for a day (shown to the user).
       ---------------------------------------------------------------------- */
    function interpret(sticker, label) {
        switch (sticker) {
            case STICKER.RED:        return 'Menstrual bleeding.';
            case STICKER.GREEN:      return 'Dry day — a time of infertility.';
            case STICKER.GREEN_BABY: return 'Discharge during the infertile phase after Peak.';
            case STICKER.YELLOW:     return 'Special discharge day (yellow-stamp protocol).';
            case STICKER.YELLOW_BABY:return 'Discharge recorded during a yellow-stamp protocol.';
            case STICKER.WHITE_BABY:
                if (label === 'P') return 'Peak Day — the last day of fertile-type mucus.';
                if (label === '1' || label === '2' || label === '3') {
                    return 'Day ' + label + ' after Peak — still within the fertile window.';
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
        for (let i = 0; i < days.length; i++) {
            if (dayHasMucus(days[i])) { firstMucus = i; break; }
        }
        return {
            peakDay: peakIndex >= 0 ? peakIndex + 1 : null,
            recordedDays: recorded,
            firstMucusDay: firstMucus >= 0 ? firstMucus + 1 : null,
            fertileWindowEnd: peakIndex >= 0 ? peakIndex + 4 : null // Peak + 3 (1-indexed day number)
        };
    }

    /* ---------------------------------------------------------------------- */
    global.Creighton = {
        FLOW: FLOW,
        CATEGORY: CATEGORY,
        DESCRIPTOR: DESCRIPTOR,
        FREQUENCY: FREQUENCY,
        STICKER: STICKER,
        buildCode: buildCode,
        getSticker: getSticker,
        findPeakIndex: findPeakIndex,
        peakLabel: peakLabel,
        dayHasMucus: dayHasMucus,
        dayHasFlow: dayHasFlow,
        dayHasEntry: dayHasEntry,
        interpret: interpret,
        summarizeCycle: summarizeCycle
    };
})(window);
