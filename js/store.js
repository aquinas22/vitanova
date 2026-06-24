/* ==========================================================================
   store.js — Local-first data layer for Vita Nova Charting
   --------------------------------------------------------------------------
   The chart is owned by the browser via localStorage: it works instantly,
   offline, with no account, and the data stays private on the device.

   Cloud sync (Firebase) is OPTIONAL and lazy-loaded only when the user
   chooses to sign in. A failure to reach Firebase can never break the local
   app — every cloud call is wrapped and degrades silently to local-only.

   Exposed as the global `Store`.
   ========================================================================== */
(function (global) {
    'use strict';

    const STORAGE_KEY = 'vitanova.chart.v1';
    const DAYS_PER_CYCLE = 35; // a generous default; covers typical cycles

    /* ----------------------------------------------------------------------
       Data shape
       ----------------------------------------------------------------------
       {
         version: 1,
         cycles: [
           {
             id, name, startDate,
             days: [ { day, flow, observation, peak, intercourse, notes, stickerOverride } ]
           }
         ],
         updatedAt
       }
       ---------------------------------------------------------------------- */

    function blankDay(n) {
        return {
            day: n,
            flow: null,            // 'H' | 'M' | 'L' | 'VL' | 'B' | null
            observation: null,     // { category, descriptors:[], frequency } | null
            peak: false,
            intercourse: false,
            notes: '',
            stickerOverride: null  // manual sticker for special protocols
        };
    }

    function blankCycle(index, startDate) {
        return {
            id: 'c' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
            name: 'Cycle ' + index,
            startDate: startDate || null,
            days: Array.from({ length: DAYS_PER_CYCLE }, function (_, i) {
                return blankDay(i + 1);
            })
        };
    }

    function blankData() {
        return {
            version: 1,
            cycles: [blankCycle(1, null)],
            updatedAt: null
        };
    }

    // Defensively merge a loaded day onto a fresh blank so older/partial saves
    // never crash the UI.
    function normalizeDay(raw, n) {
        const base = blankDay(n);
        if (!raw || typeof raw !== 'object') return base;
        return {
            day: raw.day || n,
            flow: raw.flow || null,
            observation: raw.observation && raw.observation.category
                ? {
                    category: raw.observation.category,
                    descriptors: Array.isArray(raw.observation.descriptors) ? raw.observation.descriptors : [],
                    frequency: raw.observation.frequency || null
                }
                : null,
            peak: !!raw.peak,
            intercourse: !!raw.intercourse,
            notes: typeof raw.notes === 'string' ? raw.notes : '',
            stickerOverride: raw.stickerOverride || null
        };
    }

    function normalizeCycle(raw, index) {
        const base = blankCycle(index, raw && raw.startDate);
        if (!raw || typeof raw !== 'object') return base;
        const days = [];
        const len = Math.max(DAYS_PER_CYCLE, (raw.days && raw.days.length) || 0);
        for (let i = 0; i < len; i++) {
            days.push(normalizeDay(raw.days && raw.days[i], i + 1));
        }
        return {
            id: raw.id || base.id,
            name: raw.name || base.name,
            startDate: raw.startDate || null,
            days: days
        };
    }

    function normalizeData(raw) {
        if (!raw || !Array.isArray(raw.cycles) || raw.cycles.length === 0) {
            return blankData();
        }
        return {
            version: 1,
            cycles: raw.cycles.map(function (c, i) { return normalizeCycle(c, i + 1); }),
            updatedAt: raw.updatedAt || new Date().toISOString()
        };
    }

    /* ----------------------------------------------------------------------
       In-memory state + persistence
       ---------------------------------------------------------------------- */
    let data = load();
    const listeners = [];

    function load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return blankData();
            return normalizeData(JSON.parse(raw));
        } catch (err) {
            console.warn('Could not read saved chart; starting fresh.', err);
            return blankData();
        }
    }

    function persist() {
        data.updatedAt = new Date().toISOString();
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (err) {
            console.warn('Could not save chart locally.', err);
        }
        cloud.pushDebounced(data);
        emit();
    }

    function emit() {
        listeners.forEach(function (fn) {
            try { fn(data); } catch (e) { /* a bad listener shouldn't break others */ }
        });
    }

    /* ----------------------------------------------------------------------
       Client-side encryption — Firestore receives ciphertext, never plaintext.
       The AES-GCM key is generated once and lives only in localStorage; if this
       device's localStorage is wiped the cloud copy becomes unreadable (by design).
       ---------------------------------------------------------------------- */
    const crypt = {
        async _key() {
            const stored = localStorage.getItem('vitanova.key.v1');
            if (stored) {
                return window.crypto.subtle.importKey(
                    'jwk', JSON.parse(stored), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
                );
            }
            const k = await window.crypto.subtle.generateKey(
                { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
            );
            localStorage.setItem('vitanova.key.v1',
                JSON.stringify(await window.crypto.subtle.exportKey('jwk', k)));
            return k;
        },

        async encrypt(payload) {
            const k = await this._key();
            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            const ct = await window.crypto.subtle.encrypt(
                { name: 'AES-GCM', iv }, k,
                new TextEncoder().encode(JSON.stringify(payload))
            );
            return {
                enc: true,
                iv: btoa(String.fromCharCode(...iv)),
                data: btoa(String.fromCharCode(...new Uint8Array(ct)))
            };
        },

        async decrypt(envelope) {
            const k = await this._key();
            const iv = Uint8Array.from(atob(envelope.iv), function (c) { return c.charCodeAt(0); });
            const ct = Uint8Array.from(atob(envelope.data), function (c) { return c.charCodeAt(0); });
            const pt = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k, ct);
            return JSON.parse(new TextDecoder().decode(pt));
        }
    };

    /* ----------------------------------------------------------------------
       Optional cloud sync — lazy, isolated, non-fatal.
       ---------------------------------------------------------------------- */
    const cloud = {
        enabled: false,
        user: null,
        _fb: null,           // resolved Firebase handles
        _pushTimer: null,

        // Lazily import the Firebase config module only when needed.
        async _modules() {
            if (this._fb) return this._fb;
            const cfg = await import('./firebase-config.js');
            const fs = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
            const authMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
            this._fb = { cfg: cfg, fs: fs, authMod: authMod };
            return this._fb;
        },

        async signIn(method, email, password) {
            const { cfg, authMod } = await this._modules();
            if (method === 'google') {
                const provider = new authMod.GoogleAuthProvider();
                await authMod.signInWithPopup(cfg.auth, provider);
            } else if (method === 'signup') {
                await authMod.createUserWithEmailAndPassword(cfg.auth, email, password);
            } else {
                await authMod.signInWithEmailAndPassword(cfg.auth, email, password);
            }
        },

        async signOut() {
            try {
                const { cfg, authMod } = await this._modules();
                await authMod.signOut(cfg.auth);
            } catch (e) { /* ignore */ }
        },

        // Begin watching auth state; pulls cloud data on sign-in.
        async init(onUserChange) {
            try {
                const { cfg, authMod } = await this._modules();
                authMod.onAuthStateChanged(cfg.auth, async (user) => {
                    this.user = user;
                    this.enabled = !!user;
                    if (user) {
                        await this.pull();
                    }
                    if (onUserChange) onUserChange(user);
                });
            } catch (err) {
                console.warn('Cloud sync unavailable; staying local-only.', err);
                if (onUserChange) onUserChange(null);
            }
        },

        async pull() {
            try {
                const { cfg, fs } = await this._modules();
                const ref = fs.doc(cfg.db, 'charts', this.user.uid);
                const snap = await fs.getDoc(ref);
                if (snap.exists()) {
                    const raw = snap.data();
                    // ponytail: decrypt if encrypted; plain fallback for legacy docs
                    const remote = raw.enc ? await crypt.decrypt(raw) : raw;
                    // Last-write-wins by timestamp.
                    if (!data.updatedAt || (remote.updatedAt && remote.updatedAt > data.updatedAt)) {
                        data = normalizeData(remote);
                        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
                        emit();
                    } else {
                        this.push(data);
                    }
                } else {
                    this.push(data);
                }
            } catch (err) {
                console.warn('Cloud pull failed; using local data.', err);
            }
        },

        async push(payload) {
            if (!this.enabled || !this.user) return;
            try {
                const { cfg, fs } = await this._modules();
                const ref = fs.doc(cfg.db, 'charts', this.user.uid);
                await fs.setDoc(ref, await crypt.encrypt(payload));
            } catch (err) {
                console.warn('Cloud save failed; data is still saved locally.', err);
            }
        },

        pushDebounced(payload) {
            if (!this.enabled) return;
            clearTimeout(this._pushTimer);
            this._pushTimer = setTimeout(() => this.push(payload), 1200);
        }
    };

    /* ----------------------------------------------------------------------
       Public API
       ---------------------------------------------------------------------- */
    const Store = {
        DAYS_PER_CYCLE: DAYS_PER_CYCLE,

        getData: function () { return data; },
        getCycles: function () { return data.cycles; },
        getCycle: function (index) { return data.cycles[index] || null; },

        // Subscribe to changes; returns an unsubscribe function.
        subscribe: function (fn) {
            listeners.push(fn);
            return function () {
                const i = listeners.indexOf(fn);
                if (i !== -1) listeners.splice(i, 1);
            };
        },

        // Replace one day's record (partial merge) and persist.
        updateDay: function (cycleIndex, dayIndex, patch) {
            const cycle = data.cycles[cycleIndex];
            if (!cycle) return;
            const day = cycle.days[dayIndex];
            if (!day) return;
            Object.assign(day, patch);
            persist();
        },

        clearDay: function (cycleIndex, dayIndex) {
            const cycle = data.cycles[cycleIndex];
            if (!cycle) return;
            cycle.days[dayIndex] = blankDay(dayIndex + 1);
            persist();
        },

        setCycleMeta: function (cycleIndex, patch) {
            const cycle = data.cycles[cycleIndex];
            if (!cycle) return;
            Object.assign(cycle, patch);
            persist();
        },

        // Extend a cycle by `n` more days (default 7) for longer-than-usual
        // cycles. New days start blank.
        extendCycle: function (cycleIndex, n) {
            const cycle = data.cycles[cycleIndex];
            if (!cycle) return;
            const add = n || 7;
            const start = cycle.days.length;
            for (let i = 0; i < add; i++) {
                cycle.days.push(blankDay(start + i + 1));
            }
            persist();
        },

        addCycle: function () {
            const cycle = blankCycle(data.cycles.length + 1, null);
            data.cycles.push(cycle);
            persist();
            return data.cycles.length - 1;
        },

        deleteCycle: function (cycleIndex) {
            if (data.cycles.length <= 1) {
                // Keep at least one cycle; just reset it.
                data.cycles[0] = blankCycle(1, null);
            } else {
                data.cycles.splice(cycleIndex, 1);
            }
            persist();
        },

        resetAll: function () {
            data = blankData();
            persist();
        },

        exportJSON: function () {
            return JSON.stringify(data, null, 2);
        },

        importJSON: function (text) {
            data = normalizeData(JSON.parse(text));
            persist();
        },

        cloud: cloud
    };

    global.Store = Store;
})(window);
