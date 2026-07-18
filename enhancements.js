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
                .enh-catalog-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.45rem}.enh-catalog-item{padding:.55rem .65rem;border:1px solid var(--border);border-radius:.65rem;background:var(--bg-main);font-size:.72rem;color:var(--text-main)}.enh-catalog-item::before{content:'✓';color:var(--success);font-weight:900;margin-right:.4rem}
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
                <button type="button" data-enh="toggle-filters">⚙ Фильтры</button>
                <button type="button" data-enh-outcome="all" class="active">Все</button>
                <button type="button" data-enh-outcome="win">✓ Плюс</button>
                <button type="button" data-enh-outcome="loss">− Минус</button>
                <button type="button" data-enh-outcome="be">≈ Ноль</button>
                <select data-enh="direction" aria-label="Направление"><option value="all">Все направления</option><option value="long">LONG</option><option value="short">SHORT</option></select>
                <span data-enh="count" class="enh-chip">0 выбрано</span>
                <button type="button" data-enh="select-visible">Выбрать видимые</button>
                <button type="button" data-enh="bulk" data-mutating>Массовые действия</button>
                <div data-enh="filter-panel" class="enh-filter-panel">
                    <label>С <input type="date" data-enh="from"></label>
                    <label>По <input type="date" data-enh="to"></label>
                    <label>P&amp;L ≥ <input type="number" step=".01" data-enh="minPnl" placeholder="нет"></label>
                    <label>P&amp;L ≤ <input type="number" step=".01" data-enh="maxPnl" placeholder="нет"></label>
                    <label>Тег <input type="search" data-enh="tag" placeholder="например setup"></label>
                    <button type="button" data-enh="clear-filters">Сбросить</button>
                </div>`;
            if (anchor) detail.insertBefore(toolbar, anchor); else detail.appendChild(toolbar);

            const actions = document.createElement('div');
            actions.id = 'enh-actions';
            actions.className = 'enh-actions hidden';
            actions.innerHTML = `
                <button type="button" data-enh="duplicate" data-mutating>Дублировать</button>
                <button type="button" data-enh="tag-selected" data-mutating>Тег выбранным</button>
                <button type="button" data-enh="note-selected" data-mutating>Заметка выбранным</button>
                <button type="button" data-enh="export-csv">CSV выбранных</button>
                <button type="button" data-enh="delete-selected" data-mutating>Удалить выбранные</button>
                <button type="button" data-enh="clear-selection">Снять выбор</button>`;
            if (anchor) detail.insertBefore(actions, anchor); else detail.appendChild(actions);

            const panel = document.createElement('section');
            panel.id = 'enh-analytics';
            panel.className = 'enh-panel hidden';
            panel.innerHTML = '<h4>Расширенная аналитика</h4><div data-enh="analytics-content"></div>';
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
            overlay.innerHTML = `<div class="enh-dialog" role="dialog" aria-modal="true" aria-label="Командная палитра">
                <input data-enh="palette-input" type="search" placeholder="Введите команду… (нажмите Esc для выхода)" autocomplete="off">
                <div data-enh="palette-list" class="mt-3 space-y-1"></div>
                <p class="enh-help mt-3">↑/↓ — выбор · Enter — выполнить · Ctrl/Cmd+Z — отмена · N — новая запись · / — поиск</p>
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
            box.innerHTML = `<div><label class="block text-xs font-bold text-[var(--text-muted)] uppercase mb-2 ml-1">Тег</label><input id="trade-tag" maxlength="40" placeholder="setup / news / scalp" class="w-full bg-[var(--bg-main)] border border-[var(--border)] rounded-xl px-4 py-3 focus:outline-none focus:border-[var(--accent)]"></div>
                <div><label class="block text-xs font-bold text-[var(--text-muted)] uppercase mb-2 ml-1">Заметка</label><textarea id="trade-note" maxlength="500" rows="2" placeholder="Что повлияло на решение?" class="w-full bg-[var(--bg-main)] border border-[var(--border)] rounded-xl px-4 py-3 focus:outline-none focus:border-[var(--accent)] resize-y"></textarea></div>`;
            form.insertBefore(box, form.querySelector('button[type="submit"]') || null);
        },

        injectDashboardTools() {
            if ($('#enh-dashboard-tools')) return;
            const view = $('#view-dashboard'), anchor = $('#stats-grid');
            if (!view || !anchor) return;
            const section = document.createElement('section');
            section.id = 'enh-dashboard-tools';
            section.className = 'enh-dashboard animate-enter';
            section.setAttribute('aria-label', 'Панель управления сессиями');
            section.innerHTML = `
                <div class="enh-dashboard-bar">
                    <input type="search" data-enh="session-query" placeholder="Поиск сессий…" aria-label="Поиск сессий" autocomplete="off">
                    <select data-enh="session-sort" aria-label="Сортировка сессий">
                        <option value="newest">Новые</option><option value="oldest">Старые</option>
                        <option value="profit">По P&amp;L</option><option value="winrate">По winrate</option>
                        <option value="trades">По числу сделок</option><option value="name">По названию</option><option value="favorites">Избранные</option>
                    </select>
                    <button type="button" data-enh="session-archived">Архив: скрыт</button>
                    <button type="button" data-enh="open-palette">⚡ Центр функций</button>
                    <button type="button" data-enh="dashboard-clear">Сбросить</button>
                </div>
                <div class="enh-summary" data-enh="session-summary" aria-live="polite"></div>
                <div class="enh-dashboard-empty hidden" data-enh="session-empty">По этому запросу сессий нет.</div>`;
            view.insertBefore(section, anchor);
        },

        injectNavTools() {
            if ($('#enh-nav-tools')) return;
            const nav = document.querySelector('nav .flex.items-center.gap-2:last-child');
            if (!nav) return;
            const button = document.createElement('button');
            button.id = 'enh-nav-tools'; button.type = 'button'; button.dataset.enh = 'open-palette';
            // Keep this secondary palette visually distinct from the Command Center.
            button.setAttribute('aria-label', '\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u044b');
            button.title = '\u0418\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u044b (?)';
            button.className = 'p-2 rounded-xl hover:bg-[var(--bg-hover)] transition-colors text-[var(--text-muted)] hover:text-[var(--text-main)]';
            button.setAttribute('aria-label', 'Открыть центр функций'); button.title = 'Центр функций (?)';
            button.innerHTML = '<span aria-hidden="true" class="text-sm font-extrabold">⌘</span>';
            button.setAttribute('aria-label', '\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u044b');
            button.title = '\u0418\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u044b (?)';
            button.innerHTML = '<span aria-hidden="true" class="text-sm font-extrabold">&#10022;</span>';
            nav.insertBefore(button, nav.firstChild);
            const status = document.createElement('span'); status.id = 'enh-network-status'; status.className = 'enh-chip hidden sm:inline-flex'; status.setAttribute('role', 'status'); nav.insertBefore(status, button);
        },

        injectSettingsTools() {
            if ($('#enh-settings-tools')) return;
            const panel = $('#settings-panel');
            const host = panel?.querySelector('.space-y-4');
            if (!host) return;
            host.classList.add('overflow-y-auto', 'custom-scrollbar', 'pr-1');
            const section = document.createElement('section');
            section.id = 'enh-settings-tools';
            section.className = 'pt-4 border-t border-[var(--border)] space-y-2';
            section.innerHTML = `
                <p class="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Центр инструментов</p>
                <div class="grid grid-cols-2 gap-2">
                    <button type="button" data-enh="show-analytics" class="p-2 rounded-lg border border-[var(--border)] text-xs font-bold hover:border-[var(--accent)]">Аналитика</button>
                    <button type="button" data-enh="risk-calculator" class="p-2 rounded-lg border border-[var(--border)] text-xs font-bold hover:border-[var(--accent)]">Риск-калькулятор</button>
                    <button type="button" data-enh="feature-catalog" class="p-2 rounded-lg border border-[var(--border)] text-xs font-bold hover:border-[var(--accent)]">Все функции</button>
                    <button type="button" data-enh="export-all-csv" class="p-2 rounded-lg border border-[var(--border)] text-xs font-bold hover:border-[var(--accent)]">CSV всех</button>
                    <button type="button" data-enh="export-markdown" class="p-2 rounded-lg border border-[var(--border)] text-xs font-bold hover:border-[var(--accent)]">Markdown</button>
                    <button type="button" data-enh="print-report" class="p-2 rounded-lg border border-[var(--border)] text-xs font-bold hover:border-[var(--accent)]">Печать</button>
                    <button type="button" data-enh="repair-data" class="p-2 rounded-lg border border-[var(--border)] text-xs font-bold hover:border-[var(--accent)]">Проверить</button>
                </div>
                <div class="flex gap-2 pt-1">
                    <button type="button" data-enh="accent" data-accent-value="#68d9af" class="enh-accent-swatch" style="background:#68d9af" aria-label="Mint accent"></button>
                    <button type="button" data-enh="accent" data-accent-value="#f59e8b" class="enh-accent-swatch" style="background:#f59e8b" aria-label="Peach accent"></button>
                    <button type="button" data-enh="accent" data-accent-value="#8b7cf6" class="enh-accent-swatch" style="background:#8b7cf6" aria-label="Lilac accent"></button>
                    <button type="button" data-enh="accent" data-accent-value="#5bb8f5" class="enh-accent-swatch" style="background:#5bb8f5" aria-label="Sky accent"></button>
                    <button type="button" data-enh="accent" data-accent-value="#f2c14e" class="enh-accent-swatch" style="background:#f2c14e" aria-label="Sun accent"></button>
                    <button type="button" data-enh="accent" data-accent-value="#e879b9" class="enh-accent-swatch" style="background:#e879b9" aria-label="Berry accent"></button>
                    <label class="enh-custom-accent" title="&#1057;&#1074;&#1086;&#1081; &#1094;&#1074;&#1077;&#1090;">
                        <span>&#1057;&#1074;&#1086;&#1081;</span>
                        <input type="color" data-enh="custom-accent" value="#68d9af" aria-label="&#1042;&#1099;&#1073;&#1088;&#1072;&#1090;&#1100; &#1089;&#1074;&#1086;&#1081; &#1094;&#1074;&#1077;&#1090;">
                    </label>
                    <button type="button" data-enh="accent" data-accent-value="#6366f1" class="w-11 h-11 rounded-full border-2 border-white/20" style="background:#6366f1" aria-label="Фиолетовый акцент"></button>
                    <button type="button" data-enh="accent" data-accent-value="#06b6d4" class="w-11 h-11 rounded-full border-2 border-white/20" style="background:#06b6d4" aria-label="Бирюзовый акцент"></button>
                    <button type="button" data-enh="accent" data-accent-value="#f97316" class="w-11 h-11 rounded-full border-2 border-white/20" style="background:#f97316" aria-label="Оранжевый акцент"></button>
                    <button type="button" data-enh="accent" data-accent-value="" class="w-11 h-11 rounded-full border-2 border-[var(--border)] bg-transparent text-xs" aria-label="Стандартный акцент">×</button>
                </div>`;
            host.appendChild(section);
        },

        dashboardSessions() {
            return Object.entries(this.app?.data || {})
                .filter(([id, session]) => id !== 'currentStatId' && session && typeof session === 'object' && session.name)
                .map(([id, session]) => {
                    const trades = Array.isArray(session.trades) ? session.trades : [];
                    const metrics = this.app.calcMetrics(trades);
                    return { id, session, trades, metrics, favorite: this.config.favorites.includes(id), archived: this.config.archived.includes(id) };
                });
        },

        decorateDashboard() {
            const grid = $('#stats-grid');
            if (!grid) return;
            const query = String(this.config.sessionQuery || '').trim().toLowerCase();
            const sessions = this.dashboardSessions().filter(item => this.config.showArchived || !item.archived)
                .filter(item => !query || String(item.session.name).toLowerCase().includes(query));
            const sort = this.config.sessionSort || 'newest';
            sessions.sort((a, b) => {
                if (sort === 'name') return String(a.session.name).localeCompare(String(b.session.name), 'ru');
                if (sort === 'profit') return b.metrics.pnl - a.metrics.pnl;
                if (sort === 'winrate') return b.metrics.winrate - a.metrics.winrate;
                if (sort === 'trades') return b.trades.length - a.trades.length;
                if (sort === 'oldest') return String(a.id).localeCompare(String(b.id));
                if (sort === 'favorites') return Number(b.favorite) - Number(a.favorite) || String(b.id).localeCompare(String(a.id));
                return String(b.id).localeCompare(String(a.id));
            });
            const byId = new Map(sessions.map(item => [item.id, item]));
            const cards = Array.from(grid.querySelectorAll('[data-session-id]'));
            cards.forEach(card => {
                const id = card.dataset.sessionId, item = byId.get(id) || this.dashboardSessions().find(entry => entry.id === id);
                const visible = !!item && (this.config.showArchived || !item.archived) && (!query || String(item.session.name).toLowerCase().includes(query));
                card.classList.toggle('enh-hidden-session', !visible);
                if (!item) return;
                if (!card.querySelector('[data-enh-session-actions]')) {
                    const actions = document.createElement('div');
                    actions.dataset.enhSessionActions = id;
                    actions.className = 'enh-session-actions';
                    actions.innerHTML = `<button type="button" class="action-btn" data-enh-session="favorite" data-session-id="${safeText(id)}" data-active="${item.favorite ? 1 : 0}" aria-label="${item.favorite ? 'Убрать из избранного' : 'Добавить в избранное'}">${item.favorite ? '★ В избранном' : '☆ В избранное'}</button><button type="button" class="action-btn" data-enh-session="duplicate" data-session-id="${safeText(id)}">Копия</button><button type="button" class="action-btn" data-enh-session="archive" data-session-id="${safeText(id)}">${item.archived ? 'Вернуть' : 'Архив'}</button>`;
                    card.appendChild(actions);
                } else {
                    const actions = card.querySelector('[data-enh-session-actions]');
                    const favorite = actions.querySelector('[data-enh-session="favorite"]');
                    const archive = actions.querySelector('[data-enh-session="archive"]');
                    if (favorite) { favorite.dataset.active = item.favorite ? '1' : '0'; favorite.textContent = item.favorite ? '★ В избранном' : '☆ В избранное'; }
                    if (archive) archive.textContent = item.archived ? 'Вернуть' : 'Архив';
                }
            });
            sessions.forEach(item => { const card = grid.querySelector(`[data-session-id="${cssEscape(item.id)}"]`); if (card) grid.appendChild(card); });
            const summary = $('[data-enh="session-summary"]');
            if (summary) {
                const all = this.dashboardSessions(), active = all.filter(item => !item.archived), trades = active.reduce((sum, item) => sum + item.trades.length, 0), pnl = active.reduce((sum, item) => sum + item.metrics.pnl, 0), win = active.length ? Math.round(active.reduce((sum, item) => sum + item.metrics.winrate, 0) / active.length) : 0;
                summary.innerHTML = `<div class="enh-stat"><span>Сессии</span><b>${active.length}${all.length !== active.length ? ` <small class="enh-muted">/ ${all.length}</small>` : ''}</b></div><div class="enh-stat"><span>Сделки</span><b>${trades}</b></div><div class="enh-stat"><span>Общий P&amp;L</span><b class="${pnl >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}">${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%</b></div><div class="enh-stat"><span>Средний winrate</span><b>${win}%</b></div>`;
            }
            const empty = $('[data-enh="session-empty"]'); if (empty) empty.classList.toggle('hidden', sessions.length !== 0);
            const archiveButton = $('[data-enh="session-archived"]'); if (archiveButton) archiveButton.textContent = this.config.showArchived ? 'Архив: показан' : 'Архив: скрыт';
        },

        setSessionQuery(value) { this.config.sessionQuery = String(value || '').slice(0, 80); this.saveConfig(); this.decorateDashboard(); },
        setSessionSort(value) { this.config.sessionSort = ['newest','oldest','profit','winrate','trades','name','favorites'].includes(value) ? value : 'newest'; this.saveConfig(); this.decorateDashboard(); },
        toggleArchivedSessions() { this.config.showArchived = !this.config.showArchived; this.saveConfig(); this.decorateDashboard(); },
        clearSessionFilters() { this.config.sessionQuery = ''; this.config.sessionSort = 'newest'; this.config.showArchived = false; this.saveConfig(); this.updateFilterControls(); this.decorateDashboard(); },
        toggleFavoriteSession(id) { const list = new Set(this.config.favorites); list.has(id) ? list.delete(id) : list.add(id); this.config.favorites = Array.from(list).slice(-200); this.saveConfig(); this.decorateDashboard(); },
        toggleArchiveSession(id) { if (this.config.locked) return this.notify('Режим только для чтения включён'); const list = new Set(this.config.archived); list.has(id) ? list.delete(id) : list.add(id); this.config.archived = Array.from(list).slice(-200); this.saveConfig(); this.decorateDashboard(); },
        duplicateSessionById(id) { if (this.config.locked) return this.notify('Режим только для чтения включён'); const source = this.app?.data?.[id]; if (!source) return this.notify('Сессия не найдена'); const name = global.prompt('Название копии:', `${source.name} — копия`); if (!name || !name.trim()) return; this.pushHistory(); const newId = `s-${Date.now()}-${Math.random().toString(36).slice(2,7)}`; this.app.data[newId] = { ...clone(source), name: name.trim(), trades: clone(source.trades || []) }; this.app.save(); this.afterMutation(); this.decorateDashboard(); this.notify('Сессия скопирована'); },

        // ---------- app integration --------------------------------------------
        patchApp() {
            const app = this.app;
            if (app.__enhancementsPatched) return;
            app.__enhancementsPatched = true;
            const self = this;
            const wrapMutation = (name, after = () => {}) => {
                if (typeof app[name] !== 'function') return;
                const original = app[name];
                app[name] = function (...args) {
                    if (self.config.locked && ['saveTrade', 'saveStat', 'deleteTrade', 'deleteStat', 'editSessionName'].includes(name)) {
                        self.notify('Режим только для чтения включён');
                        return false;
                    }
                    self.pushHistory();
                    const result = original.apply(this, args);
                    try { after(result, args); } catch (_) { /* optional enhancement */ }
                    self.afterMutation();
                    return result;
                };
            };
            ['saveTrade', 'saveStat', 'deleteTrade', 'deleteStat', 'editSessionName'].forEach((name) => wrapMutation(name));

            // Preserve optional metadata after the original form validates/saves.
            if (typeof app.saveTrade === 'function') {
                const originalSave = app.saveTrade;
                app.saveTrade = function (event) {
                    const before = new Set((self.currentSession()?.trades || []).map((t) => t.id));
                    const editId = self.stateEditId();
                    const result = originalSave.call(this, event);
                    const session = self.currentSession();
                    if (session && $('#modal-trade') && !$('#modal-trade').classList.contains('active')) {
                        const target = editId ? session.trades.find((t) => t.id === editId) : session.trades.find((t) => !before.has(t.id));
                        if (target) {
                            target.tag = ($('#trade-tag')?.value || '').trim().slice(0, 40);
                            target.note = ($('#trade-note')?.value || '').trim().slice(0, 500);
                            self.app.save();
                            self.clearDraft();
                        }
                    }
                    self.refresh();
                    return result;
                };
            }

            // Keep URL hash and browser title in sync with the active session.
            if (typeof app.openStat === 'function') {
                const originalOpen = app.openStat;
                app.openStat = function (id) {
                    const result = originalOpen.apply(this, arguments);
                    self.selected.clear();
                    try { if (this.data?.[id]) global.history.replaceState(null, '', `#session=${encodeURIComponent(id)}`); } catch (_) {}
                    self.refresh();
                    return result;
                };
            }
            if (typeof app.goHome === 'function') {
                const originalHome = app.goHome;
                app.goHome = function () {
                    const result = originalHome.apply(this, arguments);
                    self.selected.clear();
                    try { global.history.replaceState(null, '', global.location.pathname + global.location.search); } catch (_) {}
                    self.refresh();
                    return result;
                };
            }
            if (typeof app.renderTrades === 'function') {
                const originalRender = app.renderTrades;
                app.renderTrades = function (query = '') {
                    self.config.query = query || '';
                    const result = originalRender.apply(this, arguments);
                    global.requestAnimationFrame(() => self.decorateTrades());
                    return result;
                };
            }
            if (typeof app.renderDashboard === 'function') {
                const originalDashboard = app.renderDashboard;
                app.renderDashboard = function () {
                    const result = originalDashboard.apply(this, arguments);
                    global.requestAnimationFrame(() => self.decorateDashboard());
                    return result;
                };
            }
            if (typeof app.openTradeModal === 'function') {
                const originalOpenTrade = app.openTradeModal;
                app.openTradeModal = function () {
                    const result = originalOpenTrade.apply(this, arguments);
                    self.fillMetaForEdit(null);
                    self.restoreDraft();
                    global.requestAnimationFrame(() => { if ($('#modal-trade')?.classList.contains('active')) $('#trade-coin')?.focus(); });
                    return result;
                };
            }
            if (typeof app.openCreateModal === 'function') {
                const originalCreate = app.openCreateModal;
                app.openCreateModal = function () { const result = originalCreate.apply(this, arguments); global.requestAnimationFrame(() => $('#stat-name')?.focus()); return result; };
            }
            if (typeof app.editTrade === 'function') {
                const originalEdit = app.editTrade;
                app.editTrade = function (id) {
                    const result = originalEdit.apply(this, arguments);
                    self.fillMetaForEdit(id);
                    global.requestAnimationFrame(() => $('#trade-coin')?.focus());
                    return result;
                };
            }
            if (typeof app.toggleTheme === 'function') {
                const originalTheme = app.toggleTheme;
                app.toggleTheme = function () { const result = originalTheme.apply(this, arguments); self.applyAccent(); return result; };
            }
        },

        currentSession() {
            const id = this.app?.state?.currentId;
            return id && this.app.data ? this.app.data[id] : null;
        },

        stateEditId() { return this.app?.state?.editTradeId || null; },

        pushHistory() {
            const snapshot = this.serializeData();
            if (!snapshot) return;
            if (this.history[this.history.length - 1] === snapshot) return;
            this.history.push(snapshot);
            if (this.history.length > MAX_HISTORY) this.history.shift();
            this.future = [];
        },

        afterMutation() {
            this.lastSnapshot = this.serializeData();
            this.saveConfig();
            this.updateStatus();
            global.requestAnimationFrame(() => this.refresh());
        },

        undo() {
            if (!this.history.length) return this.notify('История пуста');
            const previous = this.history.pop();
            this.future.push(this.serializeData());
            this.restoreSnapshot(previous);
            this.notify('Изменение отменено');
        },

        redo() {
            if (!this.future.length) return this.notify('Нечего повторять');
            const next = this.future.pop();
            this.history.push(this.serializeData());
            this.restoreSnapshot(next);
            this.notify('Изменение повторено');
        },

        restoreSnapshot(snapshot) {
            try {
                const data = JSON.parse(snapshot);
                this.app.data = data && typeof data === 'object' ? data : {};
                this.app.save();
                this.lastSnapshot = this.serializeData();
                if (this.app.state.currentId && this.app.data[this.app.state.currentId]) this.app.renderTrades();
                else { this.app.state.currentId = null; this.app.renderDashboard(); }
                this.refresh();
            } catch (_) { this.notify('Не удалось восстановить состояние', 'error'); }
        },

        // ---------- filtering and selection ------------------------------------
        getTrades() {
            const session = this.currentSession();
            return (session?.trades || []).map((trade, index) => ({ ...this.app.normalizeTrade(trade, index), _index: index }));
        },

        passesFilter(trade) {
            const pnl = num(this.app.calcPnl(trade));
            const outcome = pnl > .05 ? 'win' : pnl < -.05 ? 'loss' : 'be';
            if (this.config.outcome !== 'all' && outcome !== this.config.outcome) return false;
            if (this.config.direction !== 'all' && (trade.dir || 'long') !== this.config.direction) return false;
            const day = dateInput(trade.ts);
            if (this.config.from && day < this.config.from) return false;
            if (this.config.to && day > this.config.to) return false;
            if (this.config.minPnl !== '' && pnl < num(this.config.minPnl, -Infinity)) return false;
            if (this.config.maxPnl !== '' && pnl > num(this.config.maxPnl, Infinity)) return false;
            if (this.config.tag && !String(trade.tag || '').toLowerCase().includes(String(this.config.tag).toLowerCase())) return false;
            return true;
        },

        applyFilters() {
            const cards = $$('.trade-card');
            const byId = new Map(this.getTrades().map((trade) => [String(trade.id), trade]));
            let visible = 0;
            cards.forEach((card) => {
                const trade = byId.get(String(card.dataset.tradeId));
                const show = !!trade && this.passesFilter(trade) && !card.dataset.enhSearchHidden;
                card.classList.toggle('hidden', !show);
                if (show) visible++;
            });
            const count = $('[data-enh="count"]');
            if (count) count.textContent = `${this.selected.size} выбрано · ${visible} показано`;
            const actions = $('#enh-actions');
            if (actions) actions.classList.toggle('hidden', this.selected.size === 0);
            this.updateAnalytics();
        },

        decorateTrades() {
            const cards = $$('.trade-card');
            const byId = new Map(this.getTrades().map((trade) => [String(trade.id), trade]));
            this.selected.forEach(id => { if (!byId.has(String(id))) this.selected.delete(id); });
            cards.forEach((card) => {
                const id = String(card.dataset.tradeId || '');
                const trade = byId.get(id);
                if (!trade) return;
                card.classList.toggle('enh-selected', this.selected.has(id));
                if (!card.querySelector('[data-enh-select]')) {
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox'; checkbox.className = 'enh-selection'; checkbox.dataset.enhSelect = id;
                    checkbox.checked = this.selected.has(id); checkbox.setAttribute('aria-label', `Выбрать ${trade.coin}`);
                    card.style.position = 'relative'; card.prepend(checkbox);
                }
                const heading = $('h4', card);
                if (heading && trade.tag && !heading.querySelector('[data-enh-tag]')) {
                    const tag = document.createElement('span'); tag.dataset.enhTag = '1'; tag.className = 'enh-chip ml-2 align-middle'; tag.textContent = `#${trade.tag}`; heading.appendChild(tag);
                }
                if (heading && trade.note && !card.querySelector('[data-enh-note]')) {
                    const note = document.createElement('div'); note.dataset.enhNote = '1'; note.className = 'enh-note'; note.textContent = trade.note; heading.closest('.flex-1')?.appendChild(note);
                }
                if (!card.querySelector('[data-enh-note-action]')) {
                    const host = card.querySelector('.flex.md\\:flex-col') || card.lastElementChild;
                    if (host) {
                        const button = document.createElement('button'); button.type = 'button'; button.dataset.enhNoteAction = id; button.className = 'p-3 rounded-xl bg-[var(--bg-main)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors flex-1 md:flex-none'; button.title = 'Заметка'; button.textContent = '✎'; host.appendChild(button);
                    }
                }
            });
            this.applyFilters();
        },

        setFilter(key, value) {
            this.config[key] = value;
            this.saveConfig();
            this.updateFilterControls();
            this.applyFilters();
        },

        updateFilterControls() {
            $$('[data-enh-outcome]').forEach((button) => button.classList.toggle('active', button.dataset.enhOutcome === this.config.outcome));
            $$('[data-enh]').forEach((control) => {
                const key = control.dataset.enh;
                if (['from', 'to', 'minPnl', 'maxPnl', 'tag', 'direction'].includes(key)) control.value = this.config[key] ?? (key === 'direction' ? 'all' : '');
            });
            const query = $('[data-enh="session-query"]'); if (query && query.value !== (this.config.sessionQuery || '')) query.value = this.config.sessionQuery || '';
            const sort = $('[data-enh="session-sort"]'); if (sort) sort.value = this.config.sessionSort || 'newest';
        },

        clearFilters() {
            Object.assign(this.config, { outcome: 'all', direction: 'all', from: '', to: '', minPnl: '', maxPnl: '', tag: '' });
            this.saveConfig(); this.updateFilterControls(); this.applyFilters();
        },

        selectVisible() {
            $$('.trade-card:not(.hidden)').forEach((card) => { if (card.dataset.tradeId) this.selected.add(String(card.dataset.tradeId)); });
            this.decorateTrades();
        },

        toggleSelection(id, checked) {
            if (checked) this.selected.add(String(id)); else this.selected.delete(String(id));
            const card = document.querySelector(`[data-trade-id="${cssEscape(String(id))}"]`);
            if (card) card.classList.toggle('enh-selected', checked);
            this.applyFilters();
        },

        clearSelection() { this.selected.clear(); this.decorateTrades(); },

        selectedTrades() {
            const ids = this.selected;
            return this.getTrades().filter((trade) => ids.has(String(trade.id)));
        },

        selectedSourceTrades() {
            const ids = this.selected, trades = this.currentSession()?.trades;
            return Array.isArray(trades) ? trades.filter(trade => ids.has(String(trade.id))) : [];
        },

        // ---------- metadata and bulk actions ----------------------------------
        fillMetaForEdit(id) {
            const tag = $('#trade-tag'), note = $('#trade-note');
            if (!tag || !note) return;
            if (!id) { tag.value = ''; note.value = ''; return; }
            const trade = this.currentSession()?.trades?.find((item) => String(item.id) === String(id));
            tag.value = trade?.tag || ''; note.value = trade?.note || '';
        },

        setMetadata(trade, tag, note) {
            if (!trade) return;
            if (tag !== undefined) trade.tag = String(tag).trim().slice(0, 40);
            if (note !== undefined) trade.note = String(note).trim().slice(0, 500);
        },

        promptTag() {
            if (this.config.locked) return this.notify('Режим только для чтения включён');
            const tag = global.prompt('Тег для выбранных сделок (пусто — очистить):', this.selectedSourceTrades()[0]?.tag || '');
            if (tag === null) return;
            this.pushHistory(); this.selectedSourceTrades().forEach((trade) => this.setMetadata(trade, tag)); this.app.save(); this.afterMutation(); this.app.renderTrades();
        },

        promptNote() {
            if (this.config.locked) return this.notify('Режим только для чтения включён');
            const note = global.prompt('Заметка для выбранных сделок (пусто — очистить):', '');
            if (note === null) return;
            this.pushHistory(); this.selectedSourceTrades().forEach((trade) => this.setMetadata(trade, undefined, note)); this.app.save(); this.afterMutation(); this.app.renderTrades();
        },

        deleteSelected() {
            if (this.config.locked) return this.notify('Режим только для чтения включён');
            const selected = this.selectedTrades();
            if (!selected.length || !global.confirm(`Удалить выбранные сделки (${selected.length})?`)) return;
            this.pushHistory();
            const ids = new Set(selected.map((trade) => String(trade.id)));
            const session = this.currentSession();
            session.trades = (session.trades || []).filter((trade) => !ids.has(String(trade.id)));
            this.selected.clear(); this.app.save(); this.afterMutation(); this.app.renderTrades(); this.notify(`Удалено: ${selected.length}`);
        },

        duplicateSelected() {
            if (this.config.locked) return this.notify('Режим только для чтения включён');
            const selected = this.selectedTrades();
            if (!selected.length) return this.notify('Сначала выберите сделки');
            this.pushHistory();
            const session = this.currentSession();
            selected.forEach((trade, index) => {
                const copy = clone(trade); delete copy._index; copy.id = `t-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`; copy.ts = Date.now() + index; session.trades.push(copy);
            });
            this.app.save(); this.selected.clear(); this.afterMutation(); this.app.renderTrades(); this.notify(`Дублировано: ${selected.length}`);
        },

        addNote(id) {
            if (this.config.locked) return this.notify('Режим только для чтения включён');
            const session = this.currentSession(); const trade = session?.trades?.find((item) => String(item.id) === String(id));
            if (!trade) return;
            const note = global.prompt('Заметка к сделке:', trade.note || '');
            if (note === null) return;
            this.pushHistory(); this.setMetadata(trade, undefined, note); this.app.save(); this.afterMutation(); this.app.renderTrades();
        },

        duplicateSession() {
            if (this.config.locked) return this.notify('Режим только для чтения включён');
            const source = this.currentSession();
            if (!source) return this.notify('Откройте сессию');
            const name = global.prompt('Название копии:', `${source.name} — копия`);
            if (!name || !name.trim()) return;
            this.pushHistory();
            const id = `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            this.app.data[id] = { ...clone(source), name: name.trim(), trades: clone(source.trades || []) };
            this.app.save(); this.afterMutation(); this.app.goHome(); this.notify('Сессия скопирована');
        },

        // ---------- analytics ---------------------------------------------------
        metrics(trades = this.getTrades()) {
            const values = trades.map((trade) => num(this.app.calcPnl(trade))).filter(Number.isFinite);
            const wins = values.filter((value) => value > .05), losses = values.filter((value) => value < -.05);
            let equity = 0, peak = 0, drawdown = 0, streak = 0, bestStreak = 0, worstStreak = 0, currentSign = 0, currentStreak = 0;
            values.forEach((value) => {
                equity += value; peak = Math.max(peak, equity); drawdown = Math.max(drawdown, peak - equity);
                const sign = value > .05 ? 1 : value < -.05 ? -1 : 0;
                if (sign && sign === currentSign) currentStreak++; else if (sign) { currentSign = sign; currentStreak = 1; } else { currentSign = 0; currentStreak = 0; }
                if (currentSign > 0) bestStreak = Math.max(bestStreak, currentStreak); if (currentSign < 0) worstStreak = Math.max(worstStreak, currentStreak);
            });
            const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
            const variance = values.length > 1 ? values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / (values.length - 1) : 0;
            return { count: values.length, wins: wins.length, losses: losses.length, be: values.length - wins.length - losses.length, total: values.reduce((a, b) => a + b, 0), avg, expectancy: avg, drawdown, bestStreak, worstStreak, volatility: Math.sqrt(variance), profitFactor: Math.abs(losses.reduce((a, b) => a + b, 0)) ? wins.reduce((a, b) => a + b, 0) / Math.abs(losses.reduce((a, b) => a + b, 0)) : (wins.length ? Infinity : 0) };
        },

        updateAnalytics() {
            const panel = $('#enh-analytics'), output = $('[data-enh="analytics-content"]');
            if (!panel || !output) return;
            const filtered = this.getTrades().filter((trade) => this.passesFilter(trade));
            const m = this.metrics(filtered);
            output.innerHTML = `<div class="enh-stat-grid"><div class="enh-stat"><span>Сделок</span><b>${m.count}</b></div><div class="enh-stat"><span>Expectancy</span><b class="${m.expectancy >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}">${m.expectancy >= 0 ? '+' : ''}${m.expectancy.toFixed(2)}%</b></div><div class="enh-stat"><span>Drawdown</span><b class="text-[var(--danger)]">-${m.drawdown.toFixed(2)}%</b></div><div class="enh-stat"><span>Волатильность</span><b>${m.volatility.toFixed(2)}%</b></div><div class="enh-stat"><span>Серия плюс</span><b>${m.bestStreak}</b></div><div class="enh-stat"><span>Серия минус</span><b>${m.worstStreak}</b></div><div class="enh-stat"><span>Profit factor</span><b>${m.profitFactor === Infinity ? '∞' : m.profitFactor.toFixed(2)}</b></div></div>`;
        },

        showAnalytics() { if (!this.currentSession()) return this.notify('Откройте сессию для аналитики'); const panel = $('#enh-analytics'); if (panel) { panel.classList.toggle('hidden'); this.updateAnalytics(); this.app.closeSettings?.(); } },

        // ---------- import/export and maintenance -----------------------------
        csvEscape(value) { const text = String(value == null ? '' : value); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; },

        exportCSV(trades = this.selectedTrades().length ? this.selectedTrades() : this.getTrades().filter((trade) => this.passesFilter(trade))) {
            if (!trades.length) return this.notify('Нет сделок для экспорта');
            const rows = [['id', 'date', 'coin', 'direction', 'entry', 'margin', 'pnl_percent', 'tag', 'note']];
            trades.forEach((trade) => rows.push([trade.id, isoDate(trade.ts), trade.coin, trade.dir, trade.entry, trade.margin, num(this.app.calcPnl(trade)).toFixed(6), trade.tag || '', trade.note || '']));
            const blob = new Blob(['\ufeff' + rows.map((row) => row.map((cell) => this.csvEscape(cell)).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
            this.downloadBlob(blob, `weeloser-${Date.now()}.csv`); this.notify(`Экспортировано: ${trades.length}`);
        },

        downloadBlob(blob, filename) { const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; document.body.appendChild(link); link.click(); global.setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 1000); },

        exportAllCSV() {
            const rows = [['session', 'session_id', 'trade_id', 'date', 'coin', 'direction', 'entry', 'margin', 'pnl_percent', 'tag', 'note']];
            this.dashboardSessions().forEach(({ id, session, trades }) => trades.forEach((trade, index) => rows.push([session.name, id, trade.id || index + 1, isoDate(trade.ts), trade.coin, trade.dir, trade.entry, trade.margin, num(this.app.calcPnl(trade)).toFixed(6), trade.tag || '', trade.note || ''])));
            if (rows.length === 1) return this.notify('Нет сделок для экспорта');
            const blob = new Blob(['\ufeff' + rows.map(row => row.map(cell => this.csvEscape(cell)).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
            this.downloadBlob(blob, `weeloser-all-${new Date().toISOString().slice(0,10)}.csv`); this.notify(`Экспортировано всех сделок: ${rows.length - 1}`);
        },

        markdownReport() {
            const sessions = this.dashboardSessions().filter(item => !item.archived);
            if (!sessions.length) return this.notify('Нет сессий для отчёта');
            const lines = [`# weeloser — отчёт`, ``, `_Сформировано: ${new Date().toLocaleString()}_`, ``];
            sessions.forEach(({ session, trades, metrics }) => {
                lines.push(`## ${String(session.name).replace(/[\r\n#]/g, ' ')}`, ``, `- Сделок: **${trades.length}**`, `- P&L: **${metrics.pnl >= 0 ? '+' : ''}${metrics.pnl.toFixed(2)}%**`, `- Winrate: **${metrics.winrate}%**`, ``);
                if (trades.length) { lines.push('| Дата | Инструмент | Направление | P&L | Тег |', '|---|---|---:|---:|---|'); trades.slice(0, 200).forEach(trade => lines.push(`| ${new Date(trade.ts).toLocaleDateString()} | ${trade.coin} | ${String(trade.dir).toUpperCase()} | ${this.app.calcPnl(trade).toFixed(2)}% | ${trade.tag || ''} |`)); lines.push(''); }
            });
            this.downloadBlob(new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }), `weeloser-report-${new Date().toISOString().slice(0,10)}.md`); this.notify('Markdown-отчёт готов');
        },

        printReport() {
            if (!this.currentSession()) return this.notify('Откройте сессию для печати');
            document.body.classList.add('enh-printing');
            global.setTimeout(() => { try { global.print(); } finally { document.body.classList.remove('enh-printing'); } }, 40);
        },

        openRiskCalculator() {
            if ($('#enh-risk-modal')) { $('#enh-risk-modal').classList.add('open'); return; }
            const overlay = document.createElement('div'); overlay.id = 'enh-risk-modal'; overlay.className = 'enh-overlay open';
            overlay.innerHTML = `<div class="enh-dialog" role="dialog" aria-modal="true" aria-label="Риск-калькулятор"><div class="flex items-center justify-between mb-3"><h3 class="font-bold text-lg">Риск-калькулятор</h3><button type="button" data-enh="close-risk" class="p-2 rounded-lg hover:bg-[var(--bg-hover)]" aria-label="Закрыть">×</button></div><p class="enh-help mb-3">Расчёт размера позиции по риску и стоп-лоссу. Данные не отправляются в сеть.</p><div class="grid grid-cols-2 gap-3"><label class="text-xs font-bold">Депозит<input data-risk="account" type="number" min="0" step="any" value="1000" class="mt-1"></label><label class="text-xs font-bold">Риск, %<input data-risk="risk" type="number" min="0" step="any" value="1" class="mt-1"></label><label class="text-xs font-bold">Вход<input data-risk="entry" type="number" min="0" step="any" value="100" class="mt-1"></label><label class="text-xs font-bold">Стоп<input data-risk="stop" type="number" min="0" step="any" value="98" class="mt-1"></label></div><div data-risk="result" class="enh-panel mt-4 mb-0"><div class="enh-stat-grid"><div class="enh-stat"><span>Риск в валюте</span><b data-risk-out="cash">0</b></div><div class="enh-stat"><span>Размер позиции</span><b data-risk-out="size">0</b></div><div class="enh-stat"><span>Количество</span><b data-risk-out="units">0</b></div></div></div></div>`;
            document.body.appendChild(overlay);
            const calculate = () => { const account = num(overlay.querySelector('[data-risk="account"]')?.value), risk = num(overlay.querySelector('[data-risk="risk"]')?.value), entry = num(overlay.querySelector('[data-risk="entry"]')?.value), stop = num(overlay.querySelector('[data-risk="stop"]')?.value), cash = account * risk / 100, distance = Math.abs(entry - stop), size = distance > 0 ? cash / (distance / Math.max(entry, 1)) : 0, units = entry > 0 ? size / entry : 0; const set = (key, value) => { const el = overlay.querySelector(`[data-risk-out="${key}"]`); if (el) el.textContent = Number.isFinite(value) ? value.toFixed(2) : '0.00'; }; set('cash', cash); set('size', size); set('units', units); };
            overlay.addEventListener('input', calculate); overlay.addEventListener('click', event => { if (event.target === overlay || event.target.closest('[data-enh="close-risk"]')) overlay.remove(); }); calculate();
        },

        featureCatalog() {
            return ['Сессии и сделки','Избранное и архив','Поиск сессий','Сортировка сессий','Фильтр по результату','Фильтр LONG/SHORT','Фильтр по датам','Фильтр по P&L','Фильтр по тегам','Массовый выбор','Массовое удаление','Дублирование сделок','Дублирование сессий','Теги сделок','Заметки сделок','Черновик формы','Расчёт P&L','Кривая капитала','Winrate-кольцо','Средний выигрыш/убыток','Expectancy','Drawdown','Волатильность','Серии побед','Серии убытков','Profit Factor','Лучшая сделка','Худшая сделка','Детальный отчёт','Копирование отчёта','Копирование сделки','Экспорт JSON','Импорт JSON','Экспорт CSV','Импорт CSV','Экспорт всех CSV','Markdown-отчёт','Проверка данных','Безопасная нормализация','Защита от XSS','Лимит импорта','Автосохранение','Синхронизация вкладок','История undo','История redo','Командная палитра','Горячие клавиши','Режим фокуса','Компактный режим','Только чтение','Темная тема','Светлая тема','Цветовой акцент','Риск-калькулятор','Печать отчёта','Deep-link сессии','Статус хранилища','Индикатор сети','Адаптивные модалки','Safe-area для мобильных','Доступность клавиатуры','Reduced motion'];
        },

        openFeatureCatalog() {
            if ($('#enh-catalog')) { $('#enh-catalog').classList.add('open'); return; }
            const overlay = document.createElement('div'); overlay.id = 'enh-catalog'; overlay.className = 'enh-overlay open';
            const items = this.featureCatalog().map(item => `<div class="enh-catalog-item">${safeText(item)}</div>`).join('');
            overlay.innerHTML = `<div class="enh-dialog" role="dialog" aria-modal="true" aria-label="Все функции"><div class="flex items-center justify-between mb-2"><div><h3 class="font-bold text-lg">Центр возможностей</h3><p class="enh-help">${this.featureCatalog().length}+ рабочих функций в одном журнале</p></div><button type="button" data-enh="close-catalog" class="p-2 rounded-lg hover:bg-[var(--bg-hover)]" aria-label="Закрыть">×</button></div><div class="enh-catalog-grid">${items}</div></div>`;
            document.body.appendChild(overlay); overlay.addEventListener('click', event => { if (event.target === overlay || event.target.closest('[data-enh="close-catalog"]')) overlay.remove(); });
        },

        openCSVImport() {
            let input = $('#enh-csv-input');
            if (!input) { input = document.createElement('input'); input.type = 'file'; input.accept = '.csv,text/csv'; input.id = 'enh-csv-input'; input.hidden = true; document.body.appendChild(input); input.addEventListener('change', (event) => { const file = event.target.files?.[0]; event.target.value = ''; this.importCSV(file); }); }
            input.click();
        },

        parseCSV(text) {
            const rows = []; let row = [], cell = '', quote = false;
            for (let i = 0; i < text.length; i++) { const ch = text[i], next = text[i + 1]; if (ch === '"' && quote && next === '"') { cell += '"'; i++; } else if (ch === '"') quote = !quote; else if (ch === ',' && !quote) { row.push(cell); cell = ''; } else if ((ch === '\n' || ch === '\r') && !quote) { if (ch === '\r' && next === '\n') i++; row.push(cell); if (row.some((item) => item.trim())) rows.push(row); row = []; cell = ''; } else cell += ch; }
            if (cell || row.length) { row.push(cell); rows.push(row); } return rows;
        },

        importCSV(file) {
            if (!file) return;
            if (this.config.locked) return this.notify('Режим только для чтения включён');
            if (file.size > 10 * 1024 * 1024) return this.notify('CSV слишком большой (максимум 10 МБ)', 'error');
            const reader = new FileReader(); reader.onerror = () => this.notify('Не удалось прочитать CSV', 'error'); reader.onload = () => {
                try {
                    const rows = this.parseCSV(String(reader.result || '')); if (rows.length < 2) throw new Error('empty');
                    const headers = rows.shift().map((header) => header.replace(/^\uFEFF/, '').trim().toLowerCase()); const col = (name) => headers.indexOf(name);
                    const session = this.currentSession(); if (!session) throw new Error('session');
                    const imported = rows.map((cells, index) => {
                        const value = (name, fallback = '') => { const position = col(name); return position >= 0 ? (cells[position] ?? fallback) : fallback; };
                        const entry = num(value('entry'), NaN), coin = value('coin').trim().toUpperCase();
                        if (!coin || !Number.isFinite(entry) || entry <= 0) return null;
                        const dir = value('direction', 'long').toLowerCase() === 'short' ? 'short' : 'long';
                        const margin = Math.max(.0001, num(value('margin'), 1));
                        const importedPnl = num(value('pnl_percent'), NaN);
                        const syntheticExit = Number.isFinite(importedPnl) ? entry * (1 + importedPnl / (100 * margin * (dir === 'long' ? 1 : -1))) : NaN;
                        const parsedDate = Date.parse(value('date'));
                        return { id: `t-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`, ts: Number.isFinite(parsedDate) ? parsedDate : Date.now(), coin, dir, entry, margin, tag: value('tag').trim().slice(0, 40), note: value('note').trim().slice(0, 500), fixes: Number.isFinite(syntheticExit) && syntheticExit > 0 ? [{ p: syntheticExit, pct: 100 }] : [] };
                    }).filter(Boolean);
                    if (!imported.length) throw new Error('rows');
                    this.pushHistory(); session.trades = (session.trades || []).concat(imported); this.app.save(); this.afterMutation(); this.app.renderTrades(); this.notify(`Импортировано из CSV: ${imported.length}`);
                } catch (_) { this.notify('CSV не распознан: нужны колонки coin и entry', 'error'); }
            }; reader.readAsText(file);
        },

        repairData() {
            if (this.config.locked) return this.notify('Режим только для чтения включён');
            const report = { sessions: 0, trades: 0, removed: 0 };
            this.pushHistory();
            Object.entries(this.app.data || {}).forEach(([id, session]) => {
                if (id === 'currentStatId' || !session || !Array.isArray(session.trades)) return;
                report.sessions++; const before = session.trades.length;
                session.trades = session.trades.map((trade, index) => { const normalized = this.app.normalizeTrade(trade, index); normalized.id = normalized.id || `t-${Date.now()}-${index}`; normalized.coin = String(normalized.coin || '').trim().toUpperCase(); normalized.entry = num(normalized.entry, NaN); normalized.margin = Math.max(0, num(normalized.margin, 1)); normalized.fixes = (normalized.fixes || []).filter((fix) => Number.isFinite(num(fix.price ?? fix.p, NaN)) && Number.isFinite(num(fix.percent ?? fix.pct, NaN))); return normalized; }).filter((trade) => trade.coin && Number.isFinite(trade.entry) && trade.entry > 0);
                report.removed += before - session.trades.length; report.trades += session.trades.length;
            });
            this.app.save(); this.afterMutation(); this.refresh(); this.notify(`Проверка: ${report.sessions} сессий, ${report.trades} сделок, удалено ${report.removed}`);
        },

        downloadBackup() {
            const payload = { schema: 2, exportedAt: new Date().toISOString(), app: clone(this.app.data), enhancements: clone(this.config) };
            this.downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `weeloser-backup-${new Date().toISOString().slice(0, 10)}.json`); this.notify('Резервная копия создана');
        },

        // ---------- utility UX --------------------------------------------------
        toggleDense() { this.config.dense = !this.config.dense; this.saveConfig(); this.applyVisualConfig(); this.notify(this.config.dense ? 'Компактный режим' : 'Обычный режим'); },
        toggleFocus() { this.config.focus = !this.config.focus; this.saveConfig(); this.applyVisualConfig(); },
        toggleLock() { this.config.locked = !this.config.locked; this.saveConfig(); this.applyVisualConfig(); this.notify(this.config.locked ? 'Только чтение включено' : 'Редактирование включено'); },
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
            node.textContent = `${count} сделок · автосохранение включено · ${(bytes / 1024).toFixed(1)} КБ`;
            document.title = session ? `${session.name} · weeloser` : 'weeloser';
        },

        updateNetworkStatus() { const node = $('#enh-network-status'); if (!node) return; const online = global.navigator?.onLine !== false; node.textContent = online ? '● онлайн' : '○ офлайн'; node.dataset.tone = online ? 'good' : 'bad'; node.title = online ? 'Сеть доступна' : 'Сеть недоступна — локальные данные продолжат работать'; },

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
                ['Новая сделка', 'N', () => this.currentSession() ? this.app.openTradeModal() : this.app.openCreateModal()],
                ['Отчёт текущей сессии', 'R', () => this.currentSession() && this.app.openReportModal()],
                ['Переключить фильтры', '', () => $('[data-enh="filter-panel"]')?.classList.toggle('open')],
                ['Расширенная аналитика', '', () => this.showAnalytics()],
                ['Отменить последнее изменение', 'Ctrl+Z', () => this.undo()],
                ['Повторить изменение', 'Ctrl+Y', () => this.redo()],
                ['Дублировать сессию', '', () => this.duplicateSession()],
                ['Экспорт CSV', '', () => this.exportCSV()],
                ['Резервная копия JSON', '', () => this.downloadBackup()],
                ['Импорт CSV', '', () => this.openCSVImport()],
                ['Проверить и исправить данные', '', () => this.repairData()],
                ['Экспорт всех сессий в CSV', '', () => this.exportAllCSV()],
                ['Скачать Markdown-отчёт', '', () => this.markdownReport()],
                ['Риск-калькулятор', '', () => this.openRiskCalculator()],
                ['Список всех возможностей', '', () => this.openFeatureCatalog()],
                ['Печать текущего отчёта', '', () => this.printReport()],
                ['Компактный режим', '', () => this.toggleDense()],
                ['Режим фокуса', '', () => this.toggleFocus()],
                ['Только чтение', '', () => this.toggleLock()]
            ];
        },

        renderPalette(filter = '') {
            const list = $('[data-enh="palette-list"]'); if (!list) return;
            const query = filter.trim().toLowerCase(); const commands = this.commands().filter(([label]) => !query || label.toLowerCase().includes(query));
            list.innerHTML = commands.map(([label, key], index) => `<button type="button" class="enh-command ${index === 0 ? 'active' : ''}" data-enh-command="${index}"><span>${safeText(label)}</span><kbd>${safeText(key)}</kbd></button>`).join('') || '<p class="enh-help p-2">Команды не найдены</p>';
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
