/* ==========================================================================
   chart-app.js — UI controller for the Creighton chart
   --------------------------------------------------------------------------
   Renders cycles as a strip of day cells, drives the observation-entry modal,
   and wires optional cloud sign-in. Depends on `Creighton` and `Store`.
   ========================================================================== */
(function () {
    'use strict';

    const C = window.Creighton;
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
        // Determine initial day-type.
        let type = 'dry';
        if (draft.flow) type = 'bleeding';
        else if (draft.observation) type = 'mucus';
        setDayType(type, true);

        $('peak-check').checked = draft.peak;
        $('intercourse-check').checked = draft.intercourse;
        $('notes-input').value = draft.notes;

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

    // Build the chip selectors from the Creighton reference data (once values
    // may change per open, but options are static — rebuild keeps it simple).
    let chipsBuilt = false;
    function buildChips() {
        if (chipsBuilt) return;
        $('flow-chips').innerHTML = C.FLOW.map(function (f) {
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

        // Delegate chip clicks.
        modal.querySelectorAll('.chip-row').forEach(function (row) {
            row.addEventListener('click', onChipClick);
        });
        chipsBuilt = true;
    }

    function chip(group, value, html) {
        return '<button type="button" class="chip" data-group="' + group +
            '" data-value="' + escapeHtml(value) + '">' + html + '</button>';
    }

    function onChipClick(e) {
        const btn = e.target.closest('.chip');
        if (!btn) return;
        const group = btn.dataset.group;
        const value = btn.dataset.value;

        if (group === 'flow') {
            draft.flow = (draft.flow === value) ? null : value;
        } else if (group === 'category') {
            ensureObs();
            draft.observation.category = (draft.observation.category === value) ? null : value;
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
        updatePreview();
    }

    function ensureObs() {
        if (!draft.observation) {
            draft.observation = { category: null, descriptors: [], frequency: null };
        }
    }

    function syncChipStates() {
        modal.querySelectorAll('.chip').forEach(function (btn) {
            const group = btn.dataset.group;
            const value = btn.dataset.value;
            let on = false;
            if (group === 'flow') on = draft.flow === value;
            else if (draft.observation) {
                if (group === 'category') on = draft.observation.category === value;
                else if (group === 'descriptor') on = draft.observation.descriptors.indexOf(value) !== -1;
                else if (group === 'frequency') on = draft.observation.frequency === value;
            }
            btn.classList.toggle('selected', on);
        });
    }

    function setDayType(type, skipClear) {
        modal.querySelectorAll('#day-type .seg').forEach(function (b) {
            b.classList.toggle('active', b.dataset.type === type);
        });
        $('section-bleeding').classList.toggle('hidden', type !== 'bleeding');
        $('section-mucus').classList.toggle('hidden', type !== 'mucus');

        if (!skipClear) {
            // Switching type clears the other branch's data.
            if (type === 'dry') { draft.flow = null; draft.observation = null; }
            else if (type === 'bleeding') { draft.observation = null; }
            else if (type === 'mucus') { draft.flow = null; ensureObs(); }
        }
        syncChipStates();
        updatePreview();
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
        if (action === 'export') {
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

        modal.querySelectorAll('#day-type .seg').forEach(function (b) {
            b.addEventListener('click', function () { setDayType(b.dataset.type); });
        });
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
