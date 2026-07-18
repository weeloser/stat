/*
 * weeloser Enhancements
 * ---------------------
 * A dependency-free add-on for the original single-page application.  The
 * module deliberately keeps the old localStorage schema intact and only adds
 * optional fields to trades/sessions.  It waits for `app` to be initialised,
 * so it is safe to load before or after the main inline script.
 */
(function (global) {
    'use strict';

    const CONFIG_KEY = 'weeloser_enhancements_v1';
    const DRAFT_KEY = 'weeloser_trade_draft_v1';
    const MAX_HISTORY = 40;
    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
    const clone = (value) => {
        try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
    };
    const safeText = (value) => String(value == null ? '' : value)
        .replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const num = (value, fallback = 0) => {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    };
    const dateInput = (value) => {
        if (!value) return '';
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
    };
    const isoDate = (value) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : d.toISOString(); };
    const cssEscape = (value) => global.CSS?.escape ? global.CSS.escape(String(value)) : String(value).replace(/[^a-zA-Z0-9_-]/g, ch => `\\${ch}`);

    const Enhancements = {
        app: null,
        mounted: false,
        config: {
            outcome: 'all',
            direction: 'all',
            from: '',
            to: '',
            minPnl: '',
            maxPnl: '',
            tag: '',
            dense: false,
            focus: false,
            locked: false,
            accent: '',
            sessionQuery: '',
            sessionSort: 'newest',
            favorites: [],
            archived: [],
            showArchived: false
        },
        selected: new Set(),
        history: [],
        future: [],
        lastSnapshot: '',
        autosaveTimer: null,
        paletteOpen: false,

        mount() {
            if (this.mounted) return true;
            if (!global.app || typeof global.app.renderTrades !== 'function') {
                global.setTimeout(() => this.mount(), 80);
                return false;
            }
            this.app = global.app;
            this.loadConfig();
            this.injectStyles();
            this.patchApp();
            this.injectTradeFields();
            this.injectDashboardTools();
            this.injectNavTools();
            this.injectToolbar();
            this.injectSettingsTools();
            this.bindEvents();
            this.restoreDraft();
            this.applyVisualConfig();
            this.startAutosave();
            this.updateNetworkStatus();
            this.mounted = true;
            this.lastSnapshot = this.serializeData();
            this.updateStatus();
            this.refresh();
            return true;
        },

        loadConfig() {
            try {
                const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
                if (saved && typeof saved === 'object') this.config = { ...this.config, ...saved };
                this.config.favorites = Array.isArray(this.config.favorites) ? this.config.favorites.filter(id => typeof id === 'string').slice(-200) : [];
                this.config.archived = Array.isArray(this.config.archived) ? this.config.archived.filter(id => typeof id === 'string').slice(-200) : [];
                this.config.accent = /^#[0-9a-f]{6}$/i.test(this.config.accent || '') ? this.config.accent : '';
                this.config.outcome = ['all','win','loss','be'].includes(this.config.outcome) ? this.config.outcome : 'all';
                this.config.direction = ['all','long','short'].includes(this.config.direction) ? this.config.direction : 'all';
                this.config.sessionSort = ['newest','oldest','profit','winrate','trades','name','favorites'].includes(this.config.sessionSort) ? this.config.sessionSort : 'newest';
                this.config.sessionQuery = typeof this.config.sessionQuery === 'string' ? this.config.sessionQuery.slice(0, 80) : '';
                ['dense','focus','locked','showArchived'].forEach(key => { this.config[key] = this.config[key] === true; });
            } catch (_) { /* corrupt optional settings must never break the app */ }
        },

        saveConfig() {
            try { localStorage.setItem(CONFIG_KEY, JSON.stringify(this.config)); } catch (_) { /* quota/private mode */ }
        },

        serializeData() {
            try { return JSON.stringify(this.app && this.app.data ? this.app.data : {}); } catch (_) { return ''; }
        },

        notify(message, kind = 'info') {
            if (this.app && typeof this.app.showToast === 'function') {
                this.app.showToast(message);
                return;
            }
            const node = document.createElement('div');
            node.className = `we-toast we-toast-${kind}`;
            node.textContent = message;
            document.body.appendChild(node);
            global.setTimeout(() => node.remove(), 2800);
        },

        // ---------- visual layer -------------------------------------------------
        injectStyles() {
            if ($('#enhancement-styles')) return;
            const style = document.createElement('style');
            style.id = 'enhancement-styles';
            style.textContent = `
                .enh-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin:.75rem 0;padding:.65rem;border:1px solid var(--border);border-radius:1rem;background:color-mix(in srgb,var(--bg-card) 88%,transparent);box-shadow:0 8px 24px rgba(0,0,0,.08)}
                .enh-toolbar button,.enh-toolbar input,.enh-toolbar select{min-height:36px;border:1px solid var(--border);border-radius:.65rem;background:var(--bg-main);color:var(--text-main);padding:.45rem .65rem;font-size:.75rem;font-weight:600;outline:0}
                .enh-toolbar button:hover,.enh-toolbar button.active{border-color:var(--accent);color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,var(--bg-main))}
                .enh-filter-panel{display:none;gap:.5rem;flex-wrap:wrap;align-items:center;width:100%;padding-top:.4rem;border-top:1px solid var(--border)}
                .enh-filter-panel.open{display:flex}
                .enh-filter-panel label{font-size:.65rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;display:flex;align-items:center;gap:.25rem}
                .enh-filter-panel input{width:7rem}
                .enh-chip{display:inline-flex;align-items:center;gap:.25rem;padding:.22rem .45rem;border-radius:999px;font-size:.62rem;font-weight:700;border:1px solid var(--border);background:var(--bg-hover);color:var(--text-muted)}
                .enh-chip[data-tone="good"]{color:var(--success);border-color:color-mix(in srgb,var(--success) 30%,var(--border))}
                .enh-chip[data-tone="bad"]{color:var(--danger);border-color:color-mix(in srgb,var(--danger) 30%,var(--border))}
                .enh-selection{position:absolute;left:.7rem;top:.7rem;width:1.1rem;height:1.1rem;accent-color:var(--accent);z-index:3}
                .trade-card.enh-selected{outline:2px solid var(--accent);outline-offset:2px}
                .enh-actions{display:flex;flex-wrap:wrap;gap:.4rem;margin:.65rem 0}
                .enh-actions button{border:1px solid var(--border);border-radius:.65rem;padding:.45rem .7rem;background:var(--bg-card);color:var(--text-main);font-size:.72rem;font-weight:700}
                .enh-actions button:hover{border-color:var(--accent);color:var(--accent)}
                .enh-panel{border:1px solid var(--border);background:var(--glass);border-radius:1rem;padding:1rem;margin:.75rem 0;box-shadow:0 12px 30px rgba(0,0,0,.12)}
                .enh-panel h4{font-size:.8rem;font-weight:800;margin:0 0 .65rem;color:var(--text-main)}
                .enh-stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:.5rem}
                .enh-stat{padding:.55rem;border:1px solid var(--border);border-radius:.7rem;background:var(--bg-main)}
                .enh-stat b{display:block;font-size:1rem;margin-top:.15rem}.enh-stat span{font-size:.6rem;color:var(--text-muted);text-transform:uppercase;font-weight:700}
                body.enh-dense .trade-card{padding:.65rem!important;gap:.65rem!important}.enh-dense #trades-list{gap:.45rem!important}
                body.enh-focus nav,body.enh-focus>.fixed.bottom-0{opacity:0;pointer-events:none}body.enh-focus main{padding-top:1rem!important;max-width:100%}
                body.enh-locked .trade-card button,body.enh-locked #enh-toolbar button[data-mutating],body.enh-locked [data-enh-mutating]{pointer-events:none;opacity:.4}
                .enh-overlay{position:fixed;inset:0;z-index:90;display:none;align-items:flex-start;justify-content:center;padding:10vh 1rem;background:rgba(2,6,23,.7);backdrop-filter:blur(10px)}
                .enh-overlay.open{display:flex}.enh-dialog{width:min(680px,100%);max-height:78vh;overflow:auto;border:1px solid var(--border);border-radius:1.1rem;background:var(--bg-card);box-shadow:0 24px 70px rgba(0,0,0,.4);padding:1rem}
                .enh-dialog input{width:100%;border:1px solid var(--border);border-radius:.7rem;padding:.7rem;background:var(--bg-main);color:var(--text-main);outline:0}.enh-command{display:flex;align-items:center;justify-content:space-between;width:100%;padding:.7rem;border:1px solid transparent;border-radius:.65rem;background:transparent;color:var(--text-main);text-align:left}.enh-command:hover,.enh-command.active{background:var(--bg-hover);border-color:var(--accent)}.enh-command kbd{font-size:.62rem;color:var(--text-muted);border:1px solid var(--border);border-radius:.35rem;padding:.1rem .3rem}
                .enh-help{font-size:.68rem;color:var(--text-muted);line-height:1.45}.enh-muted{color:var(--text-muted)}
                .enh-note{margin-top:.45rem;padding:.45rem .6rem;border-left:2px solid var(--accent);border-radius:.35rem;background:var(--bg-main);font-size:.7rem;color:var(--text-muted);white-space:pre-wrap;word-break:break-word}
                .enh-toast{position:fixed;right:1rem;bottom:1rem;z-index:200;padding:.7rem 1rem;border-radius:.7rem;background:#1e293b;color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.3);font-size:.8rem}
                .enh-dashboard{display:grid;gap:.7rem;margin:0 0 1.1rem;padding:.85rem;border:1px solid var(--border);border-radius:1.1rem;background:color-mix(in srgb,var(--bg-card) 88%,transparent);box-shadow:0 12px 28px rgba(0,0,0,.08)}
                .enh-dashboard-bar{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem}.enh-dashboard-bar input,.enh-dashboard-bar select,.enh-dashboard-bar button{min-height:38px;border:1px solid var(--border);border-radius:.65rem;background:var(--bg-main);color:var(--text-main);padding:.45rem .65rem;font-size:.75rem;font-weight:650}.enh-dashboard-bar input{flex:1 1 12rem;min-width:9rem}.enh-dashboard-bar button:hover,.enh-dashboard-bar button.active{border-color:var(--accent);color:var(--accent)}
                .enh-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(105px,1fr));gap:.5rem}.enh-summary .enh-stat{min-height:58px}.enh-summary .enh-stat b{font-size:1.05rem}.enh-session-actions{display:flex;gap:.3rem;align-items:center;margin-top:.7rem;padding-top:.6rem;border-top:1px solid var(--border)}.enh-session-actions button{min-height:34px;padding:.35rem .55rem;border:1px solid var(--border);border-radius:.55rem;background:var(--bg-main);color:var(--text-muted);font-size:.7rem;font-weight:700}.enh-session-actions button:hover{color:var(--accent);border-color:var(--accent)}.enh-session-actions button[data-active="1"]{color:#fbbf24;border-color:#fbbf24;background:rgba(251,191,36,.08)}
                .enh-hidden-session{display:none!important}.enh-dashboard-empty{padding:.5rem 0;font-size:.72rem;color:var(--text-muted)}
                .enh-catalog-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.45rem}.enh-catalog-item{padding:.55rem .65rem;border:1px solid var(--border);border-radius:.65rem;background:var(--bg-main);font-size:.72rem;color:var(--text-main)}.enh-catalog-item::before{content:'вњ“';color:var(--success);font-weight:900;margin-right:.4rem}
                @media print{body.enh-printing nav,body.enh-printing>.fixed.bottom-0,body.enh-printing #enh-toolbar,body.enh-printing #enh-actions,body.enh-printing #settings-panel,body.enh-printing button{display:none!important}body.enh-printing{background:#fff!important;color:#111!important}body.enh-printing .glass-panel{box-shadow:none!important;background:#fff!important;color:#111!important;border-color:#ddd!important}}
                @media(max-width:640px){.enh-toolbar{align-items:stretch}.enh-toolbar>button,.enh-toolbar>select{flex:1}.enh-filter-panel input{flex:1;min-width:7rem}.enh-dialog{max-height:84vh}}
            `;
            document.head.appendChild(style);
        },

        injectToolbar() {
            if ($('#enh-toolbar')) return;
            const detail = $('#view-detail');
            if (!detail) return;
            const anchor = $('#trades-list');
            const toolbar = document.createElement('section');
            toolbar.id = 'enh-toolbar';
            toolbar.className = 'enh-toolbar animate-enter';
            toolbar.innerHTML = `
                <button type="button" data-enh="toggle-filters">вљ™ Р¤РёР»СЊС‚СЂС‹</button>
                <button type="button" data-enh-outcome="all" class="active">Р’СЃРµ</button>
                <button type="button" data-enh-outcome="win">вњ“ РџР»СЋСЃ</button>
                <button type="button" data-enh-outcome="loss">в€’ РњРёРЅСѓСЃ</button>
                <button type="button" data-enh-outcome="be">в‰€ РќРѕР»СЊ</button>
                <select data-enh="direction" aria-label="РќР°РїСЂР°РІР»РµРЅРёРµ"><option value="all">Р’СЃРµ РЅР°РїСЂР°РІР»РµРЅРёСЏ</option><option value="long">LONG</option><option value="short">SHORT</option></select>
                <span data-enh="count" class="enh-chip">0 РІС‹Р±СЂР°РЅРѕ</span>
                <button type="button" data-enh="select-visible">Р’С‹Р±СЂР°С‚СЊ РІРёРґРёРјС‹Рµ</button>
                <button type="button" data-enh="bulk" data-mutating>РњР°СЃСЃРѕРІС‹Рµ РґРµР№СЃС‚РІРёСЏ</button>
                <div data-enh="filter-panel" class="enh-filter-panel">
                    <label>РЎ <input type="date" data-enh="from"></label>
                    <label>РџРѕ <input type="date" data-enh="to"></label>
                    <label>P&amp;L в‰Ґ <input type="number" step=".01" data-enh="minPnl" placeholder="РЅРµС‚"></label>
                    <label>P&amp;L в‰¤ <input type="number" step=".01" data-enh="maxPnl" placeholder="РЅРµС‚"></label>
                    <label>РўРµРі <input type="search" data-enh="tag" placeholder="РЅР°РїСЂРёРјРµСЂ setup"></label>
                    <button type="button" data-enh="clear-filters">РЎР±СЂРѕСЃРёС‚СЊ</button>
                </div>`;
            if (anchor) detail.insertBefore(toolbar, anchor); else detail.appendChild(toolbar);

            const actions = document.createElement('div');
            actions.id = 'enh-actions';
            actions.className = 'enh-actions hidden';
            actions.innerHTML = `
                <button type="button" data-enh="duplicate" data-mutating>Р”СѓР±Р»РёСЂРѕРІР°С‚СЊ</button>
                <button type="button" data-enh="tag-selected" data-mutating>РўРµРі РІС‹Р±СЂР°РЅРЅС‹Рј</button>
                <button type="button" data-enh="note-selected" data-mutating>Р—Р°РјРµС‚РєР° РІС‹Р±СЂР°РЅРЅС‹Рј</button>
                <button type="button" data-enh="export-csv">CSV РІС‹Р±СЂР°РЅРЅС‹С…</button>
                <button type="button" data-enh="delete-selected" data-mutating>РЈРґР°Р»РёС‚СЊ РІС‹Р±СЂР°РЅРЅС‹Рµ</button>
                <button type="button" data-enh="clear-selection">РЎРЅСЏС‚СЊ РІС‹Р±РѕСЂ</button>`;
            if (anchor) detail.insertBefore(actions, anchor); else detail.appendChild(actions);

            const panel = document.createElement('section');
            panel.id = 'enh-analytics';
            panel.className = 'enh-panel hidden';
            panel.innerHTML = '<h4>Р Р°СЃС€РёСЂРµРЅРЅР°СЏ Р°РЅР°Р»РёС‚РёРєР°</h4><div data-enh="analytics-content"></div>';
            if (anchor) detail.insertBefore(panel, anchor); else detail.appendChild(panel);

            const status = document.createElement('div');
            status.id = 'enh-status';
            status.className = 'enh-help mt-2 text-right';
            if (anchor) detail.insertBefore(status, anchor); else detail.appendChild(status);

            this.injectPalette();
        },

        injectPalette() {
            if ($('#enh-palette')) return;
            const overlay = document.createElement('div');
            overlay.id = 'enh-palette';
            overlay.className = 'enh-overlay';
            overlay.innerHTML = `<div class="enh-dialog" role="dialog" aria-modal="true" aria-label="РљРѕРјР°РЅРґРЅР°СЏ РїР°Р»РёС‚СЂР°">
                <input data-enh="palette-input" type="search" placeholder="Р’РІРµРґРёС‚Рµ РєРѕРјР°РЅРґСѓвЂ¦ (РЅР°Р¶РјРёС‚Рµ Esc РґР»СЏ РІС‹С…РѕРґР°)" autocomplete="off">
                <div data-enh="palette-list" class="mt-3 space-y-1"></div>
                <p class="enh-help mt-3">в†‘/в†“ вЂ” РІС‹Р±РѕСЂ В· Enter вЂ” РІС‹РїРѕР»РЅРёС‚СЊ В· Ctrl/Cmd+Z вЂ” РѕС‚РјРµРЅР° В· N вЂ” РЅРѕРІР°СЏ Р·Р°РїРёСЃСЊ В· / вЂ” РїРѕРёСЃРє</p>
            </div>`;
            overlay.addEventListener('click', (event) => { if (event.target === overlay) this.closePalette(); });
            document.body.appendChild(overlay);
            this.renderPalette();
        },

        injectTradeFields() {
            const form = $('#modal-trade form');
            if (!form || $('#enh-trade-meta')) return;
            const box = document.createElement('div');
            box.id = 'enh-trade-meta';
            box.className = 'grid grid-cols-1 md:grid-cols-2 gap-4';
            box.innerHTML = `<div><label class="block text-xs font-bold text-[var(--text-muted)] uppercase mb-2 ml-1">РўРµРі</label><input id="trade-tag" maxlength="40" placeholder="setup / news / scalp" class="w-full bg-[var(--bg-main)] border border-[var(--border)] rounded-xl px-4 py-3 focus:outline-none focus:border-[var(--accent)]"></div>
                <div><label class="block text-xs font-bold text-[var(--text-muted)] uppercase mb-2 ml-1">Р—Р°РјРµС‚РєР°</label><textarea id="trade-note" maxlength="500" rows="2" placeholder="Р§С‚Рѕ РїРѕРІР»РёСЏР»Рѕ РЅР° СЂРµС€РµРЅРёРµ?" class="w-full bg-[var(--bg-main)] border border-[var(--border)] rounded-xl px-4 py-3 focus:outline-none focus:border-[var(--accent)] resize-y"></textarea></div>`;
            form.insertBefore(box, form.querySelector('button[type="submit"]') || null);
        },

        injectDashboardTools() {
            if ($(…13999 tokens truncated…s: Number.isFinite(parsedDate) ? parsedDate : Date.now(), coin, dir, entry, margin, tag: value('tag').trim().slice(0, 40), note: value('note').trim().slice(0, 500), fixes: Number.isFinite(syntheticExit) && syntheticExit > 0 ? [{ p: syntheticExit, pct: 100 }] : [] };
                    }).filter(Boolean);
                    if (!imported.length) throw new Error('rows');
                    this.pushHistory(); session.trades = (session.trades || []).concat(imported); this.app.save(); this.afterMutation(); this.app.renderTrades(); this.notify(`РРјРїРѕСЂС‚РёСЂРѕРІР°РЅРѕ РёР· CSV: ${imported.length}`);
                } catch (_) { this.notify('CSV РЅРµ СЂР°СЃРїРѕР·РЅР°РЅ: РЅСѓР¶РЅС‹ РєРѕР»РѕРЅРєРё coin Рё entry', 'error'); }
            }; reader.readAsText(file);
        },

        repairData() {
            if (this.config.locked) return this.notify('Р РµР¶РёРј С‚РѕР»СЊРєРѕ РґР»СЏ С‡С‚РµРЅРёСЏ РІРєР»СЋС‡С‘РЅ');
            const report = { sessions: 0, trades: 0, removed: 0 };
            this.pushHistory();
            Object.entries(this.app.data || {}).forEach(([id, session]) => {
                if (id === 'currentStatId' || !session || !Array.isArray(session.trades)) return;
                report.sessions++; const before = session.trades.length;
                session.trades = session.trades.map((trade, index) => { const normalized = this.app.normalizeTrade(trade, index); normalized.id = normalized.id || `t-${Date.now()}-${index}`; normalized.coin = String(normalized.coin || '').trim().toUpperCase(); normalized.entry = num(normalized.entry, NaN); normalized.margin = Math.max(0, num(normalized.margin, 1)); normalized.fixes = (normalized.fixes || []).filter((fix) => Number.isFinite(num(fix.price ?? fix.p, NaN)) && Number.isFinite(num(fix.percent ?? fix.pct, NaN))); return normalized; }).filter((trade) => trade.coin && Number.isFinite(trade.entry) && trade.entry > 0);
                report.removed += before - session.trades.length; report.trades += session.trades.length;
            });
            this.app.save(); this.afterMutation(); this.refresh(); this.notify(`РџСЂРѕРІРµСЂРєР°: ${report.sessions} СЃРµСЃСЃРёР№, ${report.trades} СЃРґРµР»РѕРє, СѓРґР°Р»РµРЅРѕ ${report.removed}`);
        },

        downloadBackup() {
            const payload = { schema: 2, exportedAt: new Date().toISOString(), app: clone(this.app.data), enhancements: clone(this.config) };
            this.downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `weeloser-backup-${new Date().toISOString().slice(0, 10)}.json`); this.notify('Р РµР·РµСЂРІРЅР°СЏ РєРѕРїРёСЏ СЃРѕР·РґР°РЅР°');
        },

        // ---------- utility UX --------------------------------------------------
        toggleDense() { this.config.dense = !this.config.dense; this.saveConfig(); this.applyVisualConfig(); this.notify(this.config.dense ? 'РљРѕРјРїР°РєС‚РЅС‹Р№ СЂРµР¶РёРј' : 'РћР±С‹С‡РЅС‹Р№ СЂРµР¶РёРј'); },
        toggleFocus() { this.config.focus = !this.config.focus; this.saveConfig(); this.applyVisualConfig(); },
        toggleLock() { this.config.locked = !this.config.locked; this.saveConfig(); this.applyVisualConfig(); this.notify(this.config.locked ? 'РўРѕР»СЊРєРѕ С‡С‚РµРЅРёРµ РІРєР»СЋС‡РµРЅРѕ' : 'Р РµРґР°РєС‚РёСЂРѕРІР°РЅРёРµ РІРєР»СЋС‡РµРЅРѕ'); },
        setAccent(color) { this.config.accent = /^#[0-9a-f]{6}$/i.test(color || '') ? color : ''; this.saveConfig(); this.applyAccent(); },
        applyAccent() {
            const root = document.documentElement;
            const accent = this.config.accent || '';
            if (accent) {
                root.style.setProperty('--accent', accent);
                root.style.setProperty('--accent-strong', accent);
                root.style.setProperty('--accent-glow', `${accent}44`);
            } else {
                root.style.removeProperty('--accent');
                root.style.removeProperty('--accent-strong');
                root.style.removeProperty('--accent-glow');
            }
            $$('[data-enh="accent"]').forEach(button => {
                const active = (button.dataset.accentValue || '').toLowerCase() === accent.toLowerCase();
                button.classList.toggle('enh-accent-active', active);
            });
            const custom = $('[data-enh="custom-accent"]');
            if (custom && /^#[0-9a-f]{6}$/i.test(accent)) custom.value = accent;
        },
        applyVisualConfig() { document.body.classList.toggle('enh-dense', !!this.config.dense); document.body.classList.toggle('enh-focus', !!this.config.focus); document.body.classList.toggle('enh-locked', !!this.config.locked); this.applyAccent(); this.updateFilterControls(); },

        startAutosave() {
            if (this.autosaveTimer) return;
            this.autosaveTimer = global.setInterval(() => { try { if (this.app?.data) this.app.save(); this.updateStatus(); } catch (_) {} }, 30000);
        },

        updateStatus() {
            const node = $('#enh-status'); if (!node) return;
            let bytes = 0; try { bytes = new Blob([this.serializeData()]).size; } catch (_) {}
            const session = this.currentSession(); const count = session?.trades?.length || 0;
            node.textContent = `${count} СЃРґРµР»РѕРє В· Р°РІС‚РѕСЃРѕС…СЂР°РЅРµРЅРёРµ РІРєР»СЋС‡РµРЅРѕ В· ${(bytes / 1024).toFixed(1)} РљР‘`;
            document.title = session ? `${session.name} В· weeloser` : 'weeloser';
        },

        updateNetworkStatus() { const node = $('#enh-network-status'); if (!node) return; const online = global.navigator?.onLine !== false; node.textContent = online ? 'в—Џ РѕРЅР»Р°Р№РЅ' : 'в—‹ РѕС„Р»Р°Р№РЅ'; node.dataset.tone = online ? 'good' : 'bad'; node.title = online ? 'РЎРµС‚СЊ РґРѕСЃС‚СѓРїРЅР°' : 'РЎРµС‚СЊ РЅРµРґРѕСЃС‚СѓРїРЅР° вЂ” Р»РѕРєР°Р»СЊРЅС‹Рµ РґР°РЅРЅС‹Рµ РїСЂРѕРґРѕР»Р¶Р°С‚ СЂР°Р±РѕС‚Р°С‚СЊ'; },

        saveDraft() {
            const fields = ['trade-coin', 'trade-entry', 'trade-margin', 'trade-date', 'trade-tag', 'trade-note']; const draft = { direction: this.app?.state?.direction || 'long' };
            fields.forEach((id) => { const el = document.getElementById(id); if (el) draft[id] = el.value; });
            try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (_) {}
        },

        restoreDraft() {
            const modal = $('#modal-trade'); if (!modal || !modal.classList.contains('active')) return;
            try { const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); if (!draft || this.stateEditId()) return; ['trade-coin', 'trade-entry', 'trade-margin', 'trade-date', 'trade-tag', 'trade-note'].forEach((id) => { const el = document.getElementById(id); if (el && Object.prototype.hasOwnProperty.call(draft, id)) el.value = draft[id]; }); if (draft.direction) this.app.setDirection(draft.direction); this.app.calcPreview(); } catch (_) {}
        },
        clearDraft() { try { sessionStorage.removeItem(DRAFT_KEY); } catch (_) {} },

        bindEvents() {
            document.addEventListener('click', (event) => {
                const target = event.target.closest('[data-enh]') || event.target.closest('[data-enh-outcome]') || event.target.closest('[data-enh-select]') || event.target.closest('[data-enh-note-action]') || event.target.closest('[data-enh-session]');
                if (!target) return;
                if (target.dataset.enhSelect) return; // handled by change below
                if (target.dataset.enhOutcome) return this.setFilter('outcome', target.dataset.enhOutcome);
                if (target.dataset.enhSession) {
                    const id = target.dataset.sessionId;
                    if (target.dataset.enhSession === 'favorite') return this.toggleFavoriteSession(id);
                    if (target.dataset.enhSession === 'archive') return this.toggleArchiveSession(id);
                    if (target.dataset.enhSession === 'duplicate') return this.duplicateSessionById(id);
                }
                const action = target.dataset.enh;
                if (action === 'toggle-filters') return $('[data-enh="filter-panel"]')?.classList.toggle('open');
                if (action === 'clear-filters') return this.clearFilters();
                if (action === 'select-visible') return this.selectVisible();
                if (action === 'bulk') return $('#enh-actions')?.classList.toggle('hidden');
                if (action === 'clear-selection') return this.clearSelection();
                if (action === 'duplicate') return this.duplicateSelected();
                if (action === 'tag-selected') return this.promptTag();
                if (action === 'note-selected') return this.promptNote();
                if (action === 'delete-selected') return this.deleteSelected();
                if (action === 'export-csv') return this.exportCSV();
                if (action === 'open-palette') return this.openPalette();
                if (action === 'session-archived') return this.toggleArchivedSessions();
                if (action === 'dashboard-clear') return this.clearSessionFilters();
                if (action === 'show-analytics') return this.showAnalytics();
                if (action === 'risk-calculator') return this.openRiskCalculator();
                if (action === 'feature-catalog') return this.openFeatureCatalog();
                if (action === 'export-all-csv') return this.exportAllCSV();
                if (action === 'export-markdown') return this.markdownReport();
                if (action === 'print-report') return this.printReport();
                if (action === 'repair-data') return this.repairData();
                if (action === 'close-risk') return $('#enh-risk-modal')?.remove();
                if (action === 'close-catalog') return $('#enh-catalog')?.remove();
                if (action === 'accent') return this.setAccent(target.dataset.accentValue || '');
                if (target.dataset.enhNoteAction) return this.addNote(target.dataset.enhNoteAction);
            });
            document.addEventListener('change', (event) => {
                const el = event.target;
                if (el.matches('[data-enh-select]')) return this.toggleSelection(el.dataset.enhSelect, el.checked);
                if (el.matches('[data-enh="custom-accent"]')) return this.setAccent(el.value);
                if (el.matches('[data-enh="direction"]')) return this.setFilter('direction', el.value);
                if (el.matches('[data-enh="from"],[data-enh="to"],[data-enh="minPnl"],[data-enh="maxPnl"],[data-enh="tag"]')) return this.setFilter(el.dataset.enh, el.value);
                if (el.matches('[data-enh="session-sort"]')) return this.setSessionSort(el.value);
            });
            document.addEventListener('input', (event) => {
                if (event.target.closest('#modal-trade form')) this.saveDraft();
                if (event.target.matches('[data-enh="session-query"]')) this.setSessionQuery(event.target.value);
                if (event.target.matches('[data-enh="tag"]')) this.setFilter('tag', event.target.value);
            });
            document.addEventListener('keydown', (event) => this.handleKey(event));
            global.addEventListener('hashchange', () => this.openHash());
            global.addEventListener('online', () => this.updateNetworkStatus());
            global.addEventListener('offline', () => this.updateNetworkStatus());
            this.openHash();
        },

        handleKey(event) {
            const tag = (event.target?.tagName || '').toLowerCase(); const typing = ['input', 'textarea', 'select'].includes(tag);
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); return event.shiftKey ? this.redo() : this.undo(); }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); return this.redo(); }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { const form = document.querySelector('.modal-backdrop.active form'); if (form) { event.preventDefault(); form.requestSubmit?.(); } return; }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'e') { event.preventDefault(); return this.currentSession() ? this.exportCSV() : this.exportAllCSV(); }
            if (event.key === 'Escape') {
                if (this.paletteOpen) return this.closePalette();
                if ($('#enh-risk-modal')) return $('#enh-risk-modal').remove();
                if ($('#enh-catalog')) return $('#enh-catalog').remove();
                const modal = document.querySelector('.modal-backdrop.active[id]'); if (modal) return this.app.closeModal(modal.id);
                const settings = $('#settings-panel'); if (settings && !settings.classList.contains('translate-x-full')) return this.app.closeSettings();
                return;
            }
            if (typing || event.altKey || event.ctrlKey || event.metaKey) return;
            if (event.key === '/') { event.preventDefault(); $('#search-trade')?.focus(); return; }
            if (event.key.toLowerCase() === 'n') return this.currentSession() ? this.app.openTradeModal() : this.app.openCreateModal();
            if (event.key.toLowerCase() === 'r' && this.currentSession()) return this.app.openReportModal();
            if (event.key.toLowerCase() === 'a' && this.currentSession()) return this.showAnalytics();
            if (event.key.toLowerCase() === 'f' && this.currentSession()) return $('[data-enh="filter-panel"]')?.classList.toggle('open');
            if (event.key === '?' || event.key.toLowerCase() === 'k') return this.openPalette();
        },

        commands() {
            return [
                ['РќРѕРІР°СЏ СЃРґРµР»РєР°', 'N', () => this.currentSession() ? this.app.openTradeModal() : this.app.openCreateModal()],
                ['РћС‚С‡С‘С‚ С‚РµРєСѓС‰РµР№ СЃРµСЃСЃРёРё', 'R', () => this.currentSession() && this.app.openReportModal()],
                ['РџРµСЂРµРєР»СЋС‡РёС‚СЊ С„РёР»СЊС‚СЂС‹', '', () => $('[data-enh="filter-panel"]')?.classList.toggle('open')],
                ['Р Р°СЃС€РёСЂРµРЅРЅР°СЏ Р°РЅР°Р»РёС‚РёРєР°', '', () => this.showAnalytics()],
                ['РћС‚РјРµРЅРёС‚СЊ РїРѕСЃР»РµРґРЅРµРµ РёР·РјРµРЅРµРЅРёРµ', 'Ctrl+Z', () => this.undo()],
                ['РџРѕРІС‚РѕСЂРёС‚СЊ РёР·РјРµРЅРµРЅРёРµ', 'Ctrl+Y', () => this.redo()],
                ['Р”СѓР±Р»РёСЂРѕРІР°С‚СЊ СЃРµСЃСЃРёСЋ', '', () => this.duplicateSession()],
                ['Р­РєСЃРїРѕСЂС‚ CSV', '', () => this.exportCSV()],
                ['Р РµР·РµСЂРІРЅР°СЏ РєРѕРїРёСЏ JSON', '', () => this.downloadBackup()],
                ['РРјРїРѕСЂС‚ CSV', '', () => this.openCSVImport()],
                ['РџСЂРѕРІРµСЂРёС‚СЊ Рё РёСЃРїСЂР°РІРёС‚СЊ РґР°РЅРЅС‹Рµ', '', () => this.repairData()],
                ['Р­РєСЃРїРѕСЂС‚ РІСЃРµС… СЃРµСЃСЃРёР№ РІ CSV', '', () => this.exportAllCSV()],
                ['РЎРєР°С‡Р°С‚СЊ Markdown-РѕС‚С‡С‘С‚', '', () => this.markdownReport()],
                ['Р РёСЃРє-РєР°Р»СЊРєСѓР»СЏС‚РѕСЂ', '', () => this.openRiskCalculator()],
                ['РЎРїРёСЃРѕРє РІСЃРµС… РІРѕР·РјРѕР¶РЅРѕСЃС‚РµР№', '', () => this.openFeatureCatalog()],
                ['РџРµС‡Р°С‚СЊ С‚РµРєСѓС‰РµРіРѕ РѕС‚С‡С‘С‚Р°', '', () => this.printReport()],
                ['РљРѕРјРїР°РєС‚РЅС‹Р№ СЂРµР¶РёРј', '', () => this.toggleDense()],
                ['Р РµР¶РёРј С„РѕРєСѓСЃР°', '', () => this.toggleFocus()],
                ['РўРѕР»СЊРєРѕ С‡С‚РµРЅРёРµ', '', () => this.toggleLock()]
            ];
        },

        renderPalette(filter = '') {
            const list = $('[data-enh="palette-list"]'); if (!list) return;
            const query = filter.trim().toLowerCase(); const commands = this.commands().filter(([label]) => !query || label.toLowerCase().includes(query));
            list.innerHTML = commands.map(([label, key], index) => `<button type="button" class="enh-command ${index === 0 ? 'active' : ''}" data-enh-command="${index}"><span>${safeText(label)}</span><kbd>${safeText(key)}</kbd></button>`).join('') || '<p class="enh-help p-2">РљРѕРјР°РЅРґС‹ РЅРµ РЅР°Р№РґРµРЅС‹</p>';
            this._paletteCommands = commands;
        },

        openPalette() { const overlay = $('#enh-palette'), input = $('[data-enh="palette-input"]'); if (!overlay || !input) return; this.paletteOpen = true; overlay.classList.add('open'); input.value = ''; this.renderPalette(); global.setTimeout(() => input.focus(), 0); },
        closePalette() { $('#enh-palette')?.classList.remove('open'); this.paletteOpen = false; },

        openHash() {
            const match = /#session=([^&]+)/.exec(global.location.hash || ''); if (!match || !this.app?.data) return;
            let id; try { id = decodeURIComponent(match[1]); } catch (_) { return; }
            if (this.app.data[id] && this.app.state.currentId !== id) this.app.openStat(id);
        },

        refresh() {
            this.updateStatus(); this.updateFilterControls();
            if (this.currentSession()) { this.injectTradeFields(); this.decorateTrades(); }
            else { this.selected.clear(); this.decorateDashboard(); }
        }
    };

    // Palette keyboard navigation is bound outside the generic event handler.
    document.addEventListener('input', (event) => { if (event.target.matches('[data-enh="palette-input"]')) Enhancements.renderPalette(event.target.value); });
    document.addEventListener('click', (event) => {
        const command = event.target.closest('[data-enh-command]'); if (!command || !Enhancements.paletteOpen) return;
        const fn = Enhancements._paletteCommands?.[Number(command.dataset.enhCommand)]?.[2]; if (fn) fn(); Enhancements.closePalette();
    });
    document.addEventListener('keydown', (event) => {
        if (!Enhancements.paletteOpen) return;
        const commands = Enhancements._paletteCommands || []; let index = commands.findIndex((_, i) => $(`[data-enh-command="${i}"]`)?.classList.contains('active'));
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); index = (index + (event.key === 'ArrowDown' ? 1 : commands.length - 1)) % Math.max(commands.length, 1); $$('[data-enh-command]').forEach((button, i) => button.classList.toggle('active', i === index)); }
        if (event.key === 'Enter' && index >= 0 && commands[index]) { event.preventDefault(); commands[index][2](); Enhancements.closePalette(); }
    });

    global.weeloserEnhancements = Enhancements;
    const boot = () => global.setTimeout(() => Enhancements.mount(), 0);
    if (document.readyState === 'complete') boot(); else global.addEventListener('load', boot, { once: true });
})(window);

