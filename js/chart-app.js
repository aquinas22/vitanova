/* ==========================================================================
   chart-app.js — UI controller for the fertility chart
   --------------------------------------------------------------------------
   Renders cycles as a strip of day cells, drives the observation-entry modal,
   and wires optional cloud sign-in. Depends on `Charting` and `Store`.
   ========================================================================== */
(function () {
    'use strict';

    const C = window.Charting;
    const Store = window.Store;

    // --- App state (which cycle / day is in view) -------------------------
    let activeCycle = 0;
    let editingDay = -1;          // day index being edited in the modal
    // Draft observation while the modal is open.
    let draft = null;

    // --- Element refs ------------------------------------------------------
    const $ = function (id) { return document.getElementById(id); };
    const strip = $('chart-strip');
    const cycleSelect = $('cycle-select');
    const cycleStart = $('cycle-start');
    const summaryEl = $('cycle-summary');

    /* ======================================================================
       Sticker rendering
       ====================================================================== */
    const STICKER_CLASS = {
        'red': 'sticker-red',
        'green': 'sticker-green',
        'white-baby': 'sticker-white-baby',
        'green-baby': 'sticker-green-baby',
        'yellow': 'sticker-yellow',
        'yellow-baby': 'sticker-yellow-baby',
        'none': 'sticker-none'
    };

    function stickerInner(sticker, label) {
        let html = '';
        if (sticker === C.STICKER.WHITE_BABY || sticker === C.STICKER.GREEN_BABY || sticker === C.STICKER.YELLOW_BABY) {
            html += '<span class="sticker-baby">👶</span>';
        }
        if (label) {
            html += '<span class="sticker-count">' + label + '</span>';
        }
        return html;
    }

    /* ======================================================================
       Rendering the chart strip
       ====================================================================== */
    function render() {
        const data = Store.getData();
        // Keep activeCycle in range.
        if (activeCycle >= data.cycles.length) activeCycle = data.cycles.length - 1;
        renderCycleSelect(data);
        renderStrip();
        renderSummary();
    }

    function renderCycleSelect(data) {
        cycleSelect.innerHTML = data.cycles.map(function (c, i) {
            return '<option value="' + i + '"' + (i === activeCycle ? ' selected' : '') + '>' +
                escapeHtml(c.name) + '</option>';
        }).join('');
        const cycle = data.cycles[activeCycle];
        cycleStart.value = cycle && cycle.startDate ? cycle.startDate : '';
    }

    function renderStrip() {
        const cycle = Store.getCycle(activeCycle);
        if (!cycle) return;
        const days = cycle.days;
        const peakIndex = C.findPeakIndex(days);

        strip.innerHTML = '';
        days.forEach(function (day, i) {
            const sticker = C.getSticker(day, i, days);
            const label = C.peakLabel(i, peakIndex);
            const code = C.buildCode(day);

            const cell = document.createElement('button');
            cell.className = 'day-cell';
            cell.type = 'button';
            cell.dataset.index = i;
            if (sticker === C.STICKER.NONE) cell.classList.add('day-empty');
            if (day.intercourse) cell.classList.add('has-intercourse');

            cell.innerHTML =
                '<span class="day-num">' + day.day + '</span>' +
                '<span class="sticker ' + STICKER_CLASS[sticker] + '">' +
                    stickerInner(sticker, label) +
                '</span>' +
                '<span class="day-code">' + (code ? escapeHtml(code) : '') + '</span>' +
                (day.day === 7 ? '<span class="day-bse" title="Day 7 — best day for a breast self-exam">BSE</span>' : '') +
                (day.intercourse ? '<span class="day-i" title="Intercourse">I</span>' : '');

            cell.addEventListener('click', function () { openEntry(i); });
            strip.appendChild(cell);
        });
    }

    function renderSummary() {
        const cycle = Store.getCycle(activeCycle);
        if (!cycle) { summaryEl.innerHTML = ''; return; }
        const s = C.summarizeCycle(cycle.days);
        const parts = [];
        parts.push(stat(s.recordedDays, 'days recorded'));
        parts.push(stat(s.peakDay ? 'Day ' + s.peakDay : '—', 'Peak Day'));
        parts.push(stat(s.daysPastPeak != null ? s.daysPastPeak : '—', 'days past Peak'));
        parts.push(stat(s.fertileWindowEnd ? 'through Day ' + s.fertileWindowEnd : '—', 'fertile window ends'));
        summaryEl.innerHTML = parts.join('');
    }

    function stat(value, label) {
        return '<div class="stat"><div class="stat-value">' + escapeHtml(String(value)) +
            '</div><div class="stat-label">' + escapeHtml(label) + '</div></div>';
    }

    /* ======================================================================
       Observation entry modal
       ====================================================================== */
    const modal = $('entry-modal');

    function openEntry(dayIndex) {
        editingDay = dayIndex;
        const day = Store.getCycle(activeCycle).days[dayIndex];
        // Build an editable draft copy.
        draft = {
            flow: day.flow,
            observation: day.observation ? {
                category: day.observation.category,
                descriptors: day.observation.descriptors.slice(),
                frequency: day.observation.frequency
            } : null,
            peak: day.peak,
            intercourse: day.intercourse,
            notes: day.notes || ''
        };

        $('entry-title').textContent = 'Day ' + day.day;
        buildChips();

        // Day 7 is the optimal day for a breast self-exam.
        $('bse-reminder').classList.toggle('hidden', day.day !== 7);

        $('peak-check').checked = draft.peak;
        $('intercourse-check').checked = draft.intercourse;
        $('notes-input').value = draft.notes;

        syncChipStates();
        updateSections();
        updatePreview();
        modal.classList.remove('hidden');
        document.body.classList.add('modal-open');
    }

    function closeEntry() {
        modal.classList.add('hidden');
        document.body.classList.remove('modal-open');
        editingDay = -1;
        draft = null;
    }

    // Quick note tags to make symptom-tracking easy (PMS, cramps, etc.).
    const NOTE_TIPS = [
        'Cramps', 'Pain level', 'Breast tenderness', 'Headache',
        'Fatigue', 'Bloating', 'Mood / PMS', 'Other'
    ];

    let chipsBuilt = false;
    function buildChips() {
        if (chipsBuilt) return;
        // A leading "None" chip makes "no bleeding" an explicit, one-tap choice.
        $('flow-chips').innerHTML =
            chip('flow', '', 'None') +
            C.FLOW.map(function (f) {
                return chip('flow', f.code, f.code + ' · ' + f.label.replace(' bleeding', ''));
            }).join('');
        $('category-chips').innerHTML = C.CATEGORY.map(function (c) {
            return chip('category', c.code, '<strong>' + c.code + '</strong> ' + c.label);
        }).join('');
        $('descriptor-chips').innerHTML = C.DESCRIPTOR.map(function (d) {
            return chip('descriptor', d.code, d.code + ' · ' + d.label);
        }).join('');
        $('frequency-chips').innerHTML = C.FREQUENCY.map(function (f) {
            return chip('frequency', f.code, f.code.replace('X', '×') + ' · ' + f.label);
        }).join('');
        $('note-tip-chips').innerHTML = NOTE_TIPS.map(function (t) {
            return '<button type="button" class="chip chip-note" data-tip="' + escapeHtml(t) + '">' + escapeHtml(t) + '</button>';
        }).join('');
        $('note-tip-chips').addEventListener('click', onNoteTipClick);

        // Delegate chip clicks for the observation chips.
        ['flow-chips', 'category-chips', 'descriptor-chips', 'frequency-chips'].forEach(function (id) {
            $(id).addEventListener('click', onChipClick);
        });
        chipsBuilt = true;
    }

    // Append a symptom tag to the notes field as a quick prompt.
    function onNoteTipClick(e) {
        const btn = e.target.closest('.chip-note');
        if (!btn) return;
        const tip = btn.dataset.tip;
        const ta = $('notes-input');
        const cur = ta.value.trim();
        ta.value = (cur ? cur + ', ' : '') + tip + ': ';
        ta.focus();
    }

    function chip(group, value, html) {
        return '<button type="button" class="chip" data-group="' + group +
            '" data-value="' + escapeHtml(value) + '">' + html + '</button>';
    }

    function onChipClick(e) {
        const btn = e.target.closest('.chip');
        if (!btn || btn.disabled) return;
        const group = btn.dataset.group;
        const value = btn.dataset.value;

        if (group === 'flow') {
            // '' is the explicit "None" choice.
            draft.flow = value || null;
        } else if (group === 'category') {
            ensureObs();
            draft.observation.category = (draft.observation.category === value) ? null : value;
            // Leaving a mucus category drops descriptors that no longer apply.
            if (!categoryAllowsDescriptors(draft.observation.category)) {
                draft.observation.descriptors = [];
            }
        } else if (group === 'descriptor') {
            ensureObs();
            const arr = draft.observation.descriptors;
            const idx = arr.indexOf(value);
            if (idx === -1) arr.push(value); else arr.splice(idx, 1);
        } else if (group === 'frequency') {
            ensureObs();
            draft.observation.frequency = (draft.observation.frequency === value) ? null : value;
        }
        syncChipStates();
        updateSections();
        updatePreview();
    }

    function ensureObs() {
        if (!draft.observation) {
            draft.observation = { category: null, descriptors: [], frequency: null };
        }
    }

    // Descriptors describe mucus, so a "0" (nothing seen) day can never carry
    // one — this is what makes e.g. "0 Yellow" impossible.
    function categoryAllowsDescriptors(cat) {
        return !!cat && cat !== '0';
    }

    function syncChipStates() {
        modal.querySelectorAll('.chip').forEach(function (btn) {
            const group = btn.dataset.group;
            const value = btn.dataset.value;
            let on = false;
            if (group === 'flow') on = (draft.flow || '') === value;
            else if (draft.observation) {
                if (group === 'category') on = draft.observation.category === value;
                else if (group === 'descriptor') on = draft.observation.descriptors.indexOf(value) !== -1;
                else if (group === 'frequency') on = draft.observation.frequency === value;
            }
            btn.classList.toggle('selected', on);

            // Lubricative can't apply to a without-lubrication category.
            if (group === 'descriptor' && value === 'L') {
                const cat = draft.observation && draft.observation.category;
                const blocked = C.DRY_CATEGORIES.indexOf(cat) !== -1;
                btn.disabled = blocked;
                btn.classList.toggle('chip-disabled', blocked);
            }
        });
    }

    // Show/hide observation parts based on the current bleeding + category, so
    // charting is one continuous flow rather than separate tabs.
    function updateSections() {
        const heavy = draft.flow === 'H' || draft.flow === 'M';
        const light = !!draft.flow && !heavy; // L / VL / B

        // Heavy/moderate bleeding fully obscures any mucus observation.
        $('section-observation').classList.toggle('hidden', heavy);
        $('light-flow-note').classList.toggle('hidden', !light);
        if (heavy && draft.observation) draft.observation = null;

        const cat = draft.observation && draft.observation.category;
        const showDetail = categoryAllowsDescriptors(cat);
        $('mucus-detail').classList.toggle('hidden', !showDetail);
    }

    function updatePreview() {
        // Read peak/intercourse live for an accurate preview.
        draft.peak = $('peak-check').checked;
        draft.intercourse = $('intercourse-check').checked;

        const dayForCalc = Object.assign({}, draft);
        // Evaluate the sticker as if this draft were saved, within the cycle.
        const days = Store.getCycle(activeCycle).days.slice();
        days[editingDay] = Object.assign({}, days[editingDay], dayForCalc);
        const peakIndex = C.findPeakIndex(days);
        const sticker = C.getSticker(days[editingDay], editingDay, days);
        const label = C.peakLabel(editingDay, peakIndex);
        const code = C.buildCode(days[editingDay]);

        const pv = $('preview-sticker');
        pv.className = 'sticker sticker-lg ' + STICKER_CLASS[sticker];
        pv.innerHTML = stickerInner(sticker, label);
        $('preview-code').textContent = code || 'No observation';
        $('preview-interp').textContent = C.interpret(sticker, label);
    }

    function saveEntry() {
        draft.peak = $('peak-check').checked;
        draft.intercourse = $('intercourse-check').checked;
        draft.notes = $('notes-input').value.trim();

        // Reject physically-impossible combinations (e.g. "0 Yellow").
        const check = C.validateDraft(draft);
        if (!check.ok) {
            toast(check.message);
            return;
        }

        // A single Peak day per cycle — clear any other peak when setting one.
        if (draft.peak) {
            const days = Store.getCycle(activeCycle).days;
            days.forEach(function (d, i) {
                if (i !== editingDay && d.peak) Store.updateDay(activeCycle, i, { peak: false });
            });
        }

        Store.updateDay(activeCycle, editingDay, {
            flow: draft.flow,
            observation: draft.observation && draft.observation.category ? draft.observation : null,
            peak: draft.peak,
            intercourse: draft.intercourse,
            notes: draft.notes
        });
        closeEntry();
        toast('Day saved');
    }

    /* ======================================================================
       Cycle bar actions
       ====================================================================== */
    function wireCycleBar() {
        cycleSelect.addEventListener('change', function () {
            activeCycle = parseInt(cycleSelect.value, 10) || 0;
            render();
        });
        cycleStart.addEventListener('change', function () {
            Store.setCycleMeta(activeCycle, { startDate: cycleStart.value || null });
        });
        $('add-cycle').addEventListener('click', function () {
            activeCycle = Store.addCycle();
            render();
            toast('New cycle added');
        });
        $('extend-cycle').addEventListener('click', function () {
            Store.extendCycle(activeCycle, 7);
            render();
            toast('Added 7 more days');
        });

        const menu = $('cycle-menu');
        $('cycle-menu-btn').addEventListener('click', function (e) {
            e.stopPropagation();
            menu.classList.toggle('hidden');
        });
        document.addEventListener('click', function () { menu.classList.add('hidden'); });
        menu.addEventListener('click', function (e) {
            const action = e.target.dataset.action;
            if (!action) return;
            menu.classList.add('hidden');
            handleMenuAction(action);
        });

        $('import-file').addEventListener('change', function (e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function () {
                try {
                    Store.importJSON(reader.result);
                    activeCycle = 0;
                    render();
                    toast('Data imported');
                } catch (err) {
                    toast('Could not import that file');
                }
            };
            reader.readAsText(file);
            e.target.value = '';
        });
    }

    function handleMenuAction(action) {
        if (action === 'print') {
            printChart();
        } else if (action === 'export') {
            const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'vita-nova-chart.json';
            a.click();
            URL.revokeObjectURL(url);
        } else if (action === 'import') {
            $('import-file').click();
        } else if (action === 'delete-cycle') {
            if (confirm('Delete this cycle? This cannot be undone.')) {
                Store.deleteCycle(activeCycle);
                activeCycle = 0;
                render();
                toast('Cycle deleted');
            }
        } else if (action === 'reset') {
            if (confirm('Erase ALL cycles and start over? This cannot be undone.')) {
                Store.resetAll();
                activeCycle = 0;
                render();
                toast('Everything reset');
            }
        }
    }

    /* ======================================================================
       Print / Export to PDF — a standard charting-style chart row.
       Uses the browser's print dialog ("Save as PDF"), so no libraries are
       needed and it works fully offline.
       ====================================================================== */
    function dayDate(startDate, offset) {
        if (!startDate) return '';
        const d = new Date(startDate + 'T00:00:00');
        d.setDate(d.getDate() + offset);
        return (d.getMonth() + 1) + '/' + d.getDate();
    }

    function printChart() {
        const cycle = Store.getCycle(activeCycle);
        if (!cycle) return;
        const days = cycle.days;
        const peakIndex = C.findPeakIndex(days);
        const s = C.summarizeCycle(days);

        const cells = days.map(function (day, i) {
            const sticker = C.getSticker(day, i, days);
            const label = C.peakLabel(i, peakIndex);
            const code = C.buildCode(day);
            return '' +
                '<td class="pc-cell">' +
                    '<div class="pc-daynum">' + day.day + '</div>' +
                    '<div class="pc-date">' + escapeHtml(dayDate(cycle.startDate, i)) + '</div>' +
                    '<div class="pc-sticker sticker ' + STICKER_CLASS[sticker] + '">' + stickerInner(sticker, label) + '</div>' +
                    '<div class="pc-code">' + (code ? escapeHtml(code) : '') + '</div>' +
                    '<div class="pc-i">' + (day.intercourse ? 'I' : '') + '</div>' +
                '</td>';
        });

        // Lay the cells out in rows of 35 so a long cycle wraps onto a page.
        const PER_ROW = 35;
        let rows = '';
        for (let r = 0; r < cells.length; r += PER_ROW) {
            rows += '<table class="pc-row"><tr>' + cells.slice(r, r + PER_ROW).join('') + '</tr></table>';
        }

        const container = document.createElement('div');
        container.id = 'print-area';
        container.innerHTML =
            '<div class="pc-head">' +
                '<h1>🌸 Vita Nova — Fertility Chart</h1>' +
                '<div class="pc-meta">' +
                    '<span><strong>' + escapeHtml(cycle.name) + '</strong></span>' +
                    (cycle.startDate ? '<span>Start: ' + escapeHtml(cycle.startDate) + '</span>' : '') +
                    (s.peakDay ? '<span>Peak: Day ' + s.peakDay + '</span>' : '') +
                    '<span>Length: ' + s.cycleLength + ' days</span>' +
                '</div>' +
            '</div>' +
            rows +
            '<div class="pc-notes"><h2>Daily notes</h2>' +
                days.filter(function (d) { return d.notes; }).map(function (d) {
                    return '<div class="pc-note"><strong>Day ' + d.day + ':</strong> ' + escapeHtml(d.notes) + '</div>';
                }).join('') +
            '</div>' +
            '<p class="pc-foot">Educational charting aid — not medical advice.</p>';

        const prev = $('print-area');
        if (prev) prev.remove();
        document.body.appendChild(container);
        document.body.classList.add('printing');

        function cleanup() {
            document.body.classList.remove('printing');
            const el = $('print-area');
            if (el) el.remove();
            window.removeEventListener('afterprint', cleanup);
        }
        window.addEventListener('afterprint', cleanup);
        window.print();
        // Fallback cleanup if afterprint never fires (some browsers).
        setTimeout(cleanup, 1000);
    }

    /* ======================================================================
       Optional cloud sign-in
       ====================================================================== */
    function wireAuth() {
        const authModal = $('auth-modal');
        const syncBtn = $('sync-btn');
        let authMode = 'login'; // 'login' | 'signup'

        function openAuth() { authModal.classList.remove('hidden'); document.body.classList.add('modal-open'); }
        function closeAuth() { authModal.classList.add('hidden'); document.body.classList.remove('modal-open'); $('auth-error').textContent = ''; }

        syncBtn.addEventListener('click', function () {
            if (Store.cloud.enabled) {
                Store.cloud.signOut();
            } else {
                openAuth();
            }
        });
        $('auth-close').addEventListener('click', closeAuth);
        authModal.addEventListener('click', function (e) { if (e.target === authModal) closeAuth(); });

        $('auth-toggle').addEventListener('click', function () {
            authMode = authMode === 'login' ? 'signup' : 'login';
            $('auth-title').textContent = authMode === 'login' ? 'Sync across devices' : 'Create an account';
            $('auth-form').querySelector('button[type="submit"]').textContent = authMode === 'login' ? 'Sign in' : 'Create account';
            $('auth-toggle').textContent = authMode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in';
        });

        $('google-signin').addEventListener('click', async function () {
            try {
                await Store.cloud.signIn('google');
                closeAuth();
            } catch (err) { showAuthError(err); }
        });

        $('auth-form').addEventListener('submit', async function (e) {
            e.preventDefault();
            const email = $('auth-email').value;
            const password = $('auth-password').value;
            try {
                await Store.cloud.signIn(authMode === 'signup' ? 'signup' : 'login', email, password);
                closeAuth();
            } catch (err) { showAuthError(err); }
        });

        function showAuthError(err) {
            const msg = (err && err.message) ? err.message.replace('Firebase:', '').trim() : 'Sign-in failed.';
            $('auth-error').textContent = msg;
        }

        // Reflect auth state in the header button.
        Store.cloud.init(function (user) {
            if (user) {
                syncBtn.textContent = '☁︎ ' + (user.email || 'Synced') + ' · Sign out';
                syncBtn.classList.add('synced');
                toast('Syncing enabled');
            } else {
                syncBtn.textContent = 'Sign in to sync';
                syncBtn.classList.remove('synced');
            }
        });
    }

    /* ======================================================================
       Modal wiring + keyboard
       ====================================================================== */
    function wireModal() {
        $('entry-close').addEventListener('click', closeEntry);
        $('entry-cancel').addEventListener('click', closeEntry);
        $('entry-save').addEventListener('click', saveEntry);
        $('entry-clear').addEventListener('click', function () {
            Store.clearDay(activeCycle, editingDay);
            closeEntry();
            toast('Day cleared');
        });
        modal.addEventListener('click', function (e) { if (e.target === modal) closeEntry(); });

        $('peak-check').addEventListener('change', updatePreview);
        $('intercourse-check').addEventListener('change', updatePreview);

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                if (!modal.classList.contains('hidden')) closeEntry();
                if (!$('auth-modal').classList.contains('hidden')) {
                    $('auth-modal').classList.add('hidden');
                    document.body.classList.remove('modal-open');
                }
            }
        });
    }

    /* ======================================================================
       Toast + utilities
       ====================================================================== */
    let toastTimer = null;
    function toast(msg) {
        const el = $('toast');
        el.textContent = msg;
        el.classList.remove('hidden');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 2200);
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    /* ======================================================================
       Boot
       ====================================================================== */
    function init() {
        wireCycleBar();
        wireModal();
        wireAuth();
        Store.subscribe(render);
        render();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
