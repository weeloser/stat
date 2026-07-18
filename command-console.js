/*
 * weeloser Command Center
 * ------------------------
 * A dependency-free, safe command palette for sessions, trades, statistics
 * and visual settings. The parser is a small hand-written tokenizer: it never
 * uses eval, Function, HTML execution or dynamic property assignment.
 *
 * Integration: load this file after enhancements.js. The module waits for
 * window.app, injects its own top-right button and owns Ctrl/Cmd + K.
 */
(function (global) {
    'use strict';

    const VERSION = '1.0.0';
    const HISTORY_KEY = 'weeloser_command_history_v1';
    const MAX_HISTORY = 100;
    const MAX_INPUT = 12000;
    const MAX_COMMANDS = 60;
    const MAX_TOKENS = 800;
    const MAX_BATCH_TRADES = 250;
    const MAX_SESSIONS = 1000;
    const MAX_TRADES_PER_SESSION = 20000;

    const ENTITY_ALIASES = new Map([
        ['session', 'session'], ['sessions', 'session'], ['stat', 'session'],
        ['СЃРµСЃСЃРёСЏ', 'session'], ['СЃРµСЃСЃРёРё', 'session'],
        ['trade', 'trade'], ['trades', 'trade'], ['СЃРґРµР»РєР°', 'trade'], ['СЃРґРµР»РєРё', 'trade'],
        ['stats', 'stats'], ['statistic', 'stats'], ['statistics', 'stats'],
        ['СЃС‚Р°С‚РёСЃС‚РёРєР°', 'stats'], ['РёС‚РѕРіРё', 'stats'],
        ['config', 'config'], ['setting', 'config'], ['settings', 'config'],
        ['РЅР°СЃС‚СЂРѕР№РєР°', 'config'], ['РЅР°СЃС‚СЂРѕР№РєРё', 'config']
    ]);

    const ACTION_ALIASES = new Map([
        ['list', 'list'], ['ls', 'list'], ['СЃРїРёСЃРѕРє', 'list'], ['РїРѕРєР°Р·Р°С‚СЊ', 'list'],
        ['show', 'show'], ['view', 'show'], ['РёС‚РѕРі', 'show'], ['РїРѕРєР°Р·Р°С‚СЊ', 'show'],
        ['create', 'create'], ['new', 'create'], ['СЃРѕР·РґР°С‚СЊ', 'create'], ['РЅРѕРІР°СЏ', 'create'],
        ['add', 'add'], ['РґРѕР±Р°РІРёС‚СЊ', 'add'],
        ['open', 'open'], ['use', 'open'], ['select', 'open'], ['РѕС‚РєСЂС‹С‚СЊ', 'open'], ['РІС‹Р±СЂР°С‚СЊ', 'open'],
        ['rename', 'rename'], ['name', 'rename'], ['РїРµСЂРµРёРјРµРЅРѕРІР°С‚СЊ', 'rename'],
        ['edit', 'edit'], ['update', 'edit'], ['change', 'edit'],
        ['СЂРµРґР°РєС‚РёСЂРѕРІР°С‚СЊ', 'edit'], ['РёР·РјРµРЅРёС‚СЊ', 'edit'],
        ['delete', 'delete'], ['remove', 'delete'], ['rm', 'delete'], ['СѓРґР°Р»РёС‚СЊ', 'delete'],
        ['clear', 'clear'], ['РѕС‡РёСЃС‚РёС‚СЊ', 'clear'],
        ['reset', 'reset'], ['СЃР±СЂРѕСЃРёС‚СЊ', 'reset'],
        ['set', 'set'], ['СѓСЃС‚Р°РЅРѕРІРёС‚СЊ', 'set'], ['Р·Р°РґР°С‚СЊ', 'set'],
        ['duplicate', 'duplicate'], ['copy', 'duplicate'], ['РєРѕРїРёСЂРѕРІР°С‚СЊ', 'duplicate'], ['РґСѓР±Р»РёСЂРѕРІР°С‚СЊ', 'duplicate']
    ]);

    const KEY_ALIASES = new Map([
        ['name', 'name'], ['РЅР°Р·РІР°РЅРёРµ', 'name'], ['РёРјСЏ', 'name'],
        ['balance', 'balance'], ['Р±Р°Р»Р°РЅСЃ', 'balance'],
        ['session', 'session'], ['СЃРµСЃСЃРёСЏ', 'session'], ['in', 'session'], ['РІ', 'session'],
        ['coin', 'coin'], ['symbol', 'coin'], ['ticker', 'coin'], ['С‚РёРєРµСЂ', 'coin'], ['РјРѕРЅРµС‚Р°', 'coin'],
        ['dir', 'dir'], ['direction', 'dir'], ['РЅР°РїСЂР°РІР»РµРЅРёРµ', 'dir'],
        ['entry', 'entry'], ['РІС…РѕРґ', 'entry'], ['open', 'entry'],
        ['exit', 'exit'], ['РІС‹С…РѕРґ', 'exit'], ['close', 'exit'],
        ['margin', 'margin'], ['leverage', 'margin'], ['x', 'margin'], ['РїР»РµС‡Рѕ', 'margin'], ['РјР°СЂР¶Р°', 'margin'],
        ['pct', 'pct'], ['percent', 'pct'], ['share', 'pct'], ['РґРѕР»СЏ', 'pct'], ['РїСЂРѕС†РµРЅС‚', 'pct'],
        ['pnl', 'pnl'], ['result', 'pnl'], ['СЂРµР·СѓР»СЊС‚Р°С‚', 'pnl'], ['РїСЂРёР±С‹Р»СЊ', 'pnl'],
        ['date', 'date'], ['РґР°С‚Р°', 'date'], ['time', 'date'],
        ['tag', 'tag'], ['С‚РµРі', 'tag'],
        ['note', 'note'], ['comment', 'note'], ['Р·Р°РјРµС‚РєР°', 'note'], ['РєРѕРјРјРµРЅС‚Р°СЂРёР№', 'note'],
        ['fixes', 'fixes'], ['exits', 'fixes'], ['С„РёРєСЃР°С†РёРё', 'fixes'], ['РІС‹С…РѕРґС‹', 'fixes'],
        ['ids', 'ids'], ['id', 'ids'],
        ['limit', 'limit'], ['Р»РёРјРёС‚', 'limit'],
        ['sort', 'sort'], ['СЃРѕСЂС‚РёСЂРѕРІРєР°', 'sort'],
        ['theme', 'theme'], ['С‚РµРјР°', 'theme'],
        ['accent', 'accent'], ['Р°РєС†РµРЅС‚', 'accent'], ['С†РІРµС‚', 'accent'],
        ['dense', 'dense'], ['compact', 'dense'], ['РєРѕРјРїР°РєС‚РЅРѕ', 'dense'],
        ['focus', 'focus'], ['С„РѕРєСѓСЃ', 'focus'],
        ['locked', 'locked'], ['readonly', 'locked'], ['С‚РѕР»СЊРєРѕС‡С‚РµРЅРёРµ', 'locked'],
        ['archived', 'showArchived'], ['archive', 'showArchived'], ['Р°СЂС…РёРІ', 'showArchived'],
        ['sessionsort', 'sessionSort'], ['СЃРѕСЂС‚РёСЂРѕРІРєР°СЃРµСЃСЃРёР№', 'sessionSort']
    ]);

    const DIRECTIONS = new Map([
        ['long', 'long'], ['l', 'long'], ['Р»РѕРЅРі', 'long'], ['buy', 'long'], ['РїРѕРєСѓРїРєР°', 'long'],
        ['short', 'short'], ['s', 'short'], ['С€РѕСЂС‚', 'short'], ['sell', 'short'], ['РїСЂРѕРґР°Р¶Р°', 'short']
    ]);

    const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'РґР°', 'РІРєР»', 'РІРєР»СЋС‡РёС‚СЊ']);
    const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', 'РЅРµС‚', 'РІС‹РєР»', 'РІС‹РєР»СЋС‡РёС‚СЊ']);
    const CURRENT_VALUES = new Set(['current', 'active', 'С‚РµРєСѓС‰Р°СЏ', 'С‚РµРєСѓС‰РёР№', 'РѕС‚РєСЂС‹С‚Р°СЏ', '.']);
    const ALL_VALUES = new Set(['all', '*', 'РІСЃРµ', 'РІСЃС‘']);

    const TEMPLATES = [
        ['СЃРµСЃСЃРёРё СЃРїРёСЃРѕРє', 'Р’СЃРµ СЃРµСЃСЃРёРё СЃ РєСЂР°С‚РєРѕР№ СЃС‚Р°С‚РёСЃС‚РёРєРѕР№'],
        ['СЃРµСЃСЃРёСЏ СЃРѕР·РґР°С‚СЊ "РќРѕРІР°СЏ СЃРµСЃСЃРёСЏ"', 'РЎРѕР·РґР°С‚СЊ СЃРµСЃСЃРёСЋ'],
        ['СЃРµСЃСЃРёСЏ РѕС‚РєСЂС‹С‚СЊ "РќР°Р·РІР°РЅРёРµ"', 'РћС‚РєСЂС‹С‚СЊ СЃРµСЃСЃРёСЋ РїРѕ РёРјРµРЅРё РёР»Рё ID'],
        ['СЃРµСЃСЃРёСЏ РїРµСЂРµРёРјРµРЅРѕРІР°С‚СЊ current "РќРѕРІРѕРµ РЅР°Р·РІР°РЅРёРµ"', 'РџРµСЂРµРёРјРµРЅРѕРІР°С‚СЊ Р°РєС‚РёРІРЅСѓСЋ СЃРµСЃСЃРёСЋ'],
        ['СЃРµСЃСЃРёСЏ СѓРґР°Р»РёС‚СЊ current --confirm', 'РЈРґР°Р»РёС‚СЊ СЃРµСЃСЃРёСЋ РїРѕСЃР»Рµ preview'],
        ['СЃРґРµР»РєРё СЃРїРёСЃРѕРє', 'РЎРґРµР»РєРё Р°РєС‚РёРІРЅРѕР№ СЃРµСЃСЃРёРё'],
        ['СЃРґРµР»РєР° РґРѕР±Р°РІРёС‚СЊ BTC long 60000 -> 62000 x3', 'Р‘С‹СЃС‚СЂРѕ РґРѕР±Р°РІРёС‚СЊ СЃРґРµР»РєСѓ'],
        ['СЃРґРµР»РєР° РґРѕР±Р°РІРёС‚СЊ BTC long РІС…РѕРґ=60000 РІС‹С…РѕРґ=62000 РїР»РµС‡Рѕ=3 С‚РµРі=scalp', 'Р”РѕР±Р°РІРёС‚СЊ СЃРґРµР»РєСѓ С‡РµСЂРµР· РєР»СЋС‡Рё'],
        ['trade add BTC long 60000 -> 62000 x3; trade add ETH short 3400 -> 3250 x2; trade add SOL long 145 -> 154 x2', 'РўСЂРё СЃРґРµР»РєРё РѕРґРЅРёРј Р°С‚РѕРјР°СЂРЅС‹Рј РїР°РєРµС‚РѕРј'],
        ['СЃРґРµР»РєР° РёР·РјРµРЅРёС‚СЊ #1 С‚РµРі="breakout" Р·Р°РјРµС‚РєР°="Р’С…РѕРґ РїРѕ РїР»Р°РЅСѓ"', 'РР·РјРµРЅРёС‚СЊ СЃРґРµР»РєСѓ РїРѕ РЅРѕРјРµСЂСѓ'],
        ['СЃРґРµР»РєР° СѓРґР°Р»РёС‚СЊ #1 --confirm', 'РЈРґР°Р»РёС‚СЊ СЃРґРµР»РєСѓ'],
        ['СЃС‚Р°С‚РёСЃС‚РёРєР° РїРѕРєР°Р·Р°С‚СЊ current', 'РњРµС‚СЂРёРєРё Р°РєС‚РёРІРЅРѕР№ СЃРµСЃСЃРёРё'],
        ['СЃС‚Р°С‚РёСЃС‚РёРєР° РѕС‡РёСЃС‚РёС‚СЊ current --confirm', 'РЈРґР°Р»РёС‚СЊ РІСЃРµ СЃРґРµР»РєРё СЃРµСЃСЃРёРё'],
        ['РЅР°СЃС‚СЂРѕР№РєР° РїРѕРєР°Р·Р°С‚СЊ', 'РўРµРєСѓС‰РёРµ РЅР°СЃС‚СЂРѕР№РєРё'],
        ['РЅР°СЃС‚СЂРѕР№РєР° СѓСЃС‚Р°РЅРѕРІРёС‚СЊ С‚РµРјР°=dark Р°РєС†РµРЅС‚=#7c3aed РєРѕРјРїР°РєС‚РЅРѕ=true', 'РР·РјРµРЅРёС‚СЊ РІРЅРµС€РЅРёР№ РІРёРґ'],
        ['РїРѕРјРѕС‰СЊ', 'РљСЂР°С‚РєР°СЏ СЃРїСЂР°РІРєР° РїРѕ DSL'],
        ['РёСЃС‚РѕСЂРёСЏ', 'РџРѕСЃР»РµРґРЅРёРµ РєРѕРјР°РЅРґС‹']
    ];

    const $ = (selector, root = document) => root.querySelector(selector);
    const clone = value => {
        try { return JSON.parse(JSON.stringify(value)); }
        catch (_) { throw new CommandError('РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕР·РґР°С‚СЊ Р±РµР·РѕРїР°СЃРЅСѓСЋ РєРѕРїРёСЋ РґР°РЅРЅС‹С…'); }
    };
    const lower = value => String(value == null ? '' : value).trim().toLocaleLowerCase('ru');
    const canonicalEntity = value => ENTITY_ALIASES.get(lower(value));
    const canonicalAction = value => ACTION_ALIASES.get(lower(value));
    const canonicalKey = value => KEY_ALIASES.get(lower(value));
    const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const uniqueId = (prefix, occupied) => {
        let id;
        do {
            const cryptoPart = global.crypto?.getRandomValues
                ? Array.from(global.crypto.getRandomValues(new Uint32Array(2)), n => n.toString(36)).join('')
                : Math.random().toString(36).slice(2, 12);
            id = `${prefix}-${Date.now()}-${cryptoPart.slice(0, 12)}`;
        } while (occupied.has(id));
        return id;
    };
    const cleanText = (value, max, label, allowEmpty = false) => {
        const text = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f<>]/g, '').trim();
        if (!allowEmpty && !text) throw new CommandError(`${label}: Р·РЅР°С‡РµРЅРёРµ РЅРµ РјРѕР¶РµС‚ Р±С‹С‚СЊ РїСѓСЃС‚С‹Рј`);
        if (text.length > max) throw new CommandError(`${label}: РјР°РєСЃРёРјСѓРј ${max} СЃРёРјРІРѕР»РѕРІ`);
        return text;
    };
    const finiteNumber = (value, label, options = {}) => {
        const normalized = typeof value === 'string' ? value.trim().replace(',', '.') : value;
        const number = Number(normalized);
        if (!Number.isFinite(number)) throw new CommandError(`${label}: РЅСѓР¶РЅРѕ РєРѕРЅРµС‡РЅРѕРµ С‡РёСЃР»Рѕ`);
        if (options.min !== undefined && number < options.min) throw new CommandError(`${label}: РјРёРЅРёРјСѓРј ${options.min}`);
        if (options.max !== undefined && number > options.max) throw new CommandError(`${label}: РјР°РєСЃРёРјСѓРј ${options.max}`);
        return number;
    };
    const boolValue = (value, label) => {
        const key = lower(value);
        if (TRUE_VALUES.has(key)) return true;
        if (FALSE_VALUES.has(key)) return false;
        throw new CommandError(`${label}: РёСЃРїРѕР»СЊР·СѓР№С‚Рµ true/false, on/off РёР»Рё РґР°/РЅРµС‚`);
    };
    const formatNumber = (value, digits = 2) => new Intl.NumberFormat('ru-RU', {
        maximumFractionDigits: digits,
        minimumFractionDigits: 0
    }).format(Number(value) || 0);
    const formatDate = value => {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? 'вЂ”' : date.toLocaleDateString('ru-RU');
    };

    class CommandError extends Error {
        constructor(message, hint = '') {
            super(message);
            this.name = 'CommandError';
            this.hint = hint;
        }
    }

    function tokenizeProgram(source) {
        if (typeof source !== 'string') throw new CommandError('РљРѕРјР°РЅРґР° РґРѕР»Р¶РЅР° Р±С‹С‚СЊ С‚РµРєСЃС‚РѕРј');
        if (source.length > MAX_INPUT) throw new CommandError(`РЎР»РёС€РєРѕРј РґР»РёРЅРЅС‹Р№ РІРІРѕРґ: РјР°РєСЃРёРјСѓРј ${MAX_INPUT} СЃРёРјРІРѕР»РѕРІ`);

        const commands = [];
        let tokens = [];
        let token = '';
        let quote = '';
        let escaped = false;
        let tokenStarted = false;
        let totalTokens = 0;

        const pushToken = () => {
            if (!tokenStarted) return;
            tokens.push(token);
            totalTokens++;
            if (totalTokens > MAX_TOKENS) throw new CommandError(`РЎР»РёС€РєРѕРј РјРЅРѕРіРѕ РїР°СЂР°РјРµС‚СЂРѕРІ: РјР°РєСЃРёРјСѓРј ${MAX_TOKENS}`);
            token = '';
            tokenStarted = false;
        };
        const pushCommand = () => {
            pushToken();
            if (!tokens.length) return;
            commands.push(tokens);
            if (commands.length > MAX_COMMANDS) throw new CommandError(`РЎР»РёС€РєРѕРј РјРЅРѕРіРѕ РєРѕРјР°РЅРґ: РјР°РєСЃРёРјСѓРј ${MAX_COMMANDS}`);
            tokens = [];
        };

        for (let index = 0; index < source.length; index++) {
            const char = source[index];
            const next = source[index + 1];
            if (escaped) {
                token += char === 'n' ? '\n' : char === 't' ? '\t' : char;
                escaped = false;
                tokenStarted = true;
                continue;
            }
            if (quote) {
                if (char === '\\') { escaped = true; continue; }
                if (char === quote) { quote = ''; tokenStarted = true; continue; }
                token += char;
                tokenStarted = true;
                continue;
            }
            if (char === '"' || char === "'") {
                quote = char;
                tokenStarted = true;
                continue;
            }
            if (char === '-' && next === '>') {
                pushToken();
                tokens.push('->');
                totalTokens++;
                index++;
                continue;
            }
            if (char === ';' || char === '\n' || char === '\r') {
                pushCommand();
                if (char === '\r' && next === '\n') index++;
                continue;
            }
            if (/\s/u.test(char)) {
                pushToken();
                continue;
            }
            token += char;
            tokenStarted = true;
        }
        if (escaped) throw new CommandError('РќРµР·Р°РІРµСЂС€С‘РЅРЅР°СЏ escape-РїРѕСЃР»РµРґРѕРІР°С‚РµР»СЊРЅРѕСЃС‚СЊ');
        if (quote) throw new CommandError('РќРµ Р·Р°РєСЂС‹С‚Р° РєР°РІС‹С‡РєР°', 'Р—Р°РєСЂРѕР№С‚Рµ С‚РµРєСЃС‚ С‚РѕР№ Р¶Рµ РєР°РІС‹С‡РєРѕР№');
        pushCommand();
        if (!commands.length) throw new CommandError('Р’РІРµРґРёС‚Рµ РєРѕРјР°РЅРґСѓ РёР»Рё РІС‹Р±РµСЂРёС‚Рµ РїСЂРёРјРµСЂ РЅРёР¶Рµ');
        return commands;
    }

    function parseArguments(tokens) {
        const options = Object.create(null);
        const positionals = [];
        const flags = new Set();

        for (const raw of tokens) {
            if (raw.startsWith('--')) {
                const flag = lower(raw.slice(2));
                if (flag) flags.add(flag);
                continue;
            }
            const equals = raw.indexOf('=');
            if (equals > 0) {
                const rawKey = raw.slice(0, equals);
                const key = canonicalKey(rawKey);
                if (!key) throw new CommandError(`РќРµРёР·РІРµСЃС‚РЅС‹Р№ РєР»СЋС‡ В«${rawKey}В»`);
                if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new CommandError('РќРµРґРѕРїСѓСЃС‚РёРјС‹Р№ РєР»СЋС‡');
                options[key] = raw.slice(equals + 1);
                continue;
            }
            positionals.push(raw);
        }
        return { options, positionals, flags };
    }

    function parseDate(value) {
        if (value == null || value === '') return Date.now();
        const normalized = lower(value);
        const today = new Date();
        if (normalized === 'today' || normalized === 'СЃРµРіРѕРґРЅСЏ') {
            today.setHours(12, 0, 0, 0);
            return today.getTime();
        }
        if (normalized === 'yesterday' || normalized === 'РІС‡РµСЂР°') {
            today.setDate(today.getDate() - 1);
            today.setHours(12, 0, 0, 0);
            return today.getTime();
        }
        let date;
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) date = new Date(`${value}T12:00:00`);
        else date = new Date(value);
        if (Number.isNaN(date.getTime())) throw new CommandError(`Р”Р°С‚Р° В«${value}В» РЅРµ СЂР°СЃРїРѕР·РЅР°РЅР°`, 'РСЃРїРѕР»СЊР·СѓР№С‚Рµ YYYY-MM-DD, today/СЃРµРіРѕРґРЅСЏ РёР»Рё yesterday/РІС‡РµСЂР°');
        const year = date.getFullYear();
        if (year < 1970 || year > 2200) throw new CommandError('Р”Р°С‚Р° РґРѕР»Р¶РЅР° Р±С‹С‚СЊ РјРµР¶РґСѓ 1970 Рё 2200 РіРѕРґРѕРј');
        return date.getTime();
    }

    function sessionEntries(ctx) {
        return Object.entries(ctx.data).filter(([id, value]) => id !== 'currentStatId' && isObject(value));
    }

    function findSession(ctx, selector, options = {}) {
        const raw = selector == null || selector === '' ? 'current' : String(selector);
        const key = lower(raw);
        if (CURRENT_VALUES.has(key)) {
            const id = ctx.currentId || ctx.data.currentStatId;
            if (id && isObject(ctx.data[id])) return { id, session: ctx.data[id] };
            if (options.optional) return null;
            throw new CommandError('РќРµС‚ Р°РєС‚РёРІРЅРѕР№ СЃРµСЃСЃРёРё', 'РћС‚РєСЂРѕР№С‚Рµ РµС‘ РєРѕРјР°РЅРґРѕР№: СЃРµСЃСЃРёСЏ РѕС‚РєСЂС‹С‚СЊ "РќР°Р·РІР°РЅРёРµ"');
        }
        if (isObject(ctx.data[raw])) return { id: raw, session: ctx.data[raw] };
        const entries = sessionEntries(ctx);
        const exact = entries.filter(([, session]) => lower(session.name) === key);
        if (exact.length === 1) return { id: exact[0][0], session: exact[0][1] };
        const partial = entries.filter(([id, session]) => lower(id).includes(key) …16914 tokens truncated…this.history.length > MAX_HISTORY) this.history = this.history.slice(-MAX_HISTORY);
            try { localStorage.setItem(HISTORY_KEY, JSON.stringify(this.history)); } catch (_) { /* private mode */ }
        },

        navigateHistory(direction) {
            if (!this.history.length) return;
            if (this.historyIndex === -1) {
                this.historyDraft = $('#wl-cc-input')?.value || '';
                this.historyIndex = this.history.length;
            }
            this.historyIndex = Math.max(0, Math.min(this.history.length, this.historyIndex + direction));
            this.setInput(this.historyIndex === this.history.length ? this.historyDraft : this.history[this.historyIndex]);
            this.updateSuggestions();
        },

        suggestionPool() {
            const pool = [...TEMPLATES];
            if (this.app) {
                Object.entries(this.app.data || {}).forEach(([id, session]) => {
                    if (id === 'currentStatId' || !isObject(session)) return;
                    const quoted = `"${String(session.name || '').replace(/["\\]/g, '\\$&')}"`;
                    pool.push([`СЃРµСЃСЃРёСЏ РѕС‚РєСЂС‹С‚СЊ ${quoted}`, `РћС‚РєСЂС‹С‚СЊ В· ${id}`]);
                    pool.push([`СЃС‚Р°С‚РёСЃС‚РёРєР° РїРѕРєР°Р·Р°С‚СЊ ${quoted}`, 'РџРѕСЃРјРѕС‚СЂРµС‚СЊ РјРµС‚СЂРёРєРё']);
                });
            }
            return pool;
        },

        updateSuggestions() {
            const host = $('#wl-cc-suggestions');
            const input = $('#wl-cc-input');
            if (!host || !input || !this.opened) return;
            const query = lower(input.value);
            if (!query || query.includes('\n') || query.includes(';')) {
                host.dataset.visible = '0';
                host.replaceChildren();
                this._suggestions = [];
                return;
            }
            const words = query.split(/\s+/).filter(Boolean);
            const scored = this.suggestionPool().map(item => {
                const candidate = lower(item[0]);
                let score = candidate.startsWith(query) ? 100 : 0;
                if (!score && words.every(word => candidate.includes(word))) score = 50;
                if (!score && candidate.split(/\s+/).some(word => word.startsWith(query))) score = 25;
                return { item, score };
            }).filter(result => result.score > 0).sort((a, b) => b.score - a.score || a.item[0].length - b.item[0].length).slice(0, 7);
            this._suggestions = scored.map(result => result.item);
            this.suggestionIndex = 0;
            host.replaceChildren();
            this._suggestions.forEach(([command, detail], index) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'wl-cc-suggestion';
                button.dataset.wlSuggestion = String(index);
                button.setAttribute('role', 'option');
                const code = document.createElement('code'); code.textContent = command;
                const small = document.createElement('small'); small.textContent = detail;
                button.append(code, small);
                host.appendChild(button);
            });
            host.dataset.visible = this._suggestions.length ? '1' : '0';
            this.paintSuggestionActive();
        },

        paintSuggestionActive() {
            document.querySelectorAll('[data-wl-suggestion]').forEach((node, index) => {
                node.dataset.active = index === this.suggestionIndex ? '1' : '0';
                node.setAttribute('aria-selected', index === this.suggestionIndex ? 'true' : 'false');
            });
        },

        acceptSuggestion(index) {
            const item = this._suggestions?.[index];
            if (!item) return;
            this.setInput(item[0]);
            $('#wl-cc-suggestions').dataset.visible = '0';
            $('#wl-cc-input')?.focus();
        },

        currentEnhConfig() {
            return global.weeloserEnhancements?.config || {};
        },

        currentSnapshot() {
            return JSON.stringify({
                data: clone(this.app?.data || {}),
                config: clone(this.app?.config || {}),
                enhConfig: clone(this.currentEnhConfig())
            });
        },

        run(source) {
            const input = $('#wl-cc-input');
            const command = typeof source === 'string' ? source : input?.value || '';
            if (typeof source === 'string') this.setInput(source);
            this.saveHistory(command);
            if ($('#wl-cc-suggestions')) $('#wl-cc-suggestions').dataset.visible = '0';
            try {
                const plan = parseProgram(command, this.app, this.currentEnhConfig());
                if (plan.meta.showHistory) plan.meta.sections.push(this.historySection());
                if (plan.meta.clearOutput && plan.meta.sections.length === 0) {
                    this.pending = null;
                    this.renderWelcome();
                    this.updateApplyBar();
                    return;
                }
                this.pending = plan.meta.mutations ? plan : null;
                this.renderPlan(plan);
                this.updateApplyBar();
                if (!plan.meta.mutations) this.applyEffects(plan);
            } catch (error) {
                this.pending = null;
                this.renderError(error);
                this.updateApplyBar();
            }
        },

        historySection() {
            const lines = this.history.slice(-20).reverse().map((command, index) => `${index + 1}. ${command}`);
            return section(`РСЃС‚РѕСЂРёСЏ В· ${this.history.length}`, lines.length ? lines : ['РСЃС‚РѕСЂРёСЏ РїРѕРєР° РїСѓСЃС‚Р°.']);
        },

        renderWelcome() {
            const output = $('#wl-cc-output');
            if (!output) return;
            output.replaceChildren();
            const head = document.createElement('div');
            head.className = 'wl-cc-output-head';
            const copy = document.createElement('div');
            const title = document.createElement('h3'); title.textContent = 'РќР°С‡РЅРёС‚Рµ СЃ РіРѕС‚РѕРІРѕР№ РєРѕРјР°РЅРґС‹';
            const note = document.createElement('p'); note.textContent = 'Р СѓСЃСЃРєРёР№ Рё English РјРѕР¶РЅРѕ СЃРІРѕР±РѕРґРЅРѕ СЃРјРµС€РёРІР°С‚СЊ';
            copy.append(title, note); head.append(copy); output.append(head);
            const grid = document.createElement('div'); grid.className = 'wl-cc-welcome';
            TEMPLATES.slice(0, 8).forEach(([command, detail]) => {
                const button = document.createElement('button');
                button.type = 'button'; button.className = 'wl-cc-example'; button.dataset.wlExample = command;
                const code = document.createElement('code'); code.textContent = command;
                const span = document.createElement('span'); span.textContent = detail;
                button.append(code, span); grid.append(button);
            });
            output.append(grid);
        },

        renderPlan(plan) {
            const output = $('#wl-cc-output');
            if (!output) return;
            output.replaceChildren();
            const head = document.createElement('div'); head.className = 'wl-cc-output-head';
            const copy = document.createElement('div');
            const title = document.createElement('h3');
            title.textContent = plan.meta.mutations ? 'Preview РёР·РјРµРЅРµРЅРёР№' : 'Р РµР·СѓР»СЊС‚Р°С‚';
            const note = document.createElement('p');
            note.textContent = `${plan.commandCount} РєРѕРјР°РЅРґ В· ${plan.meta.mutations} РёР·РјРµРЅРµРЅРёР№${plan.meta.addedTrades ? ` В· +${plan.meta.addedTrades} СЃРґРµР»РѕРє` : ''}`;
            copy.append(title, note);
            const badges = document.createElement('div'); badges.className = 'wl-cc-badges';
            const badgeTexts = [];
            if (plan.commandCount > 1) badgeTexts.push('Atomic batch');
            if (plan.dryRun) badgeTexts.push('Dry run');
            if (plan.meta.danger) badgeTexts.push('РћРїР°СЃРЅР°СЏ РѕРїРµСЂР°С†РёСЏ');
            badgeTexts.forEach(textValue => { const badge = document.createElement('span'); badge.className = 'wl-cc-badge'; badge.textContent = textValue; badges.append(badge); });
            head.append(copy, badges); output.append(head);
            plan.meta.sections.forEach(item => this.renderSection(output, item));
        },

        renderSection(host, item) {
            const block = document.createElement('section'); block.className = 'wl-cc-section'; block.dataset.tone = item.tone || 'neutral';
            const title = document.createElement('h4'); title.textContent = item.title; block.append(title);
            if (item.lines?.length) {
                const list = document.createElement('ul');
                item.lines.forEach(value => { const li = document.createElement('li'); li.textContent = value; list.append(li); });
                block.append(list);
            }
            if (item.table) {
                const wrap = document.createElement('div'); wrap.className = 'wl-cc-table-wrap';
                const table = document.createElement('table'); table.className = 'wl-cc-table';
                const thead = document.createElement('thead'); const trh = document.createElement('tr');
                item.table.headers.forEach(value => { const th = document.createElement('th'); th.textContent = value; trh.append(th); });
                thead.append(trh); table.append(thead);
                const tbody = document.createElement('tbody');
                item.table.rows.forEach(row => { const tr = document.createElement('tr'); row.forEach(value => { const td = document.createElement('td'); td.textContent = value; td.title = value; tr.append(td); }); tbody.append(tr); });
                table.append(tbody); wrap.append(table); block.append(wrap);
            }
            host.append(block);
        },

        renderError(error) {
            const output = $('#wl-cc-output');
            if (!output) return;
            output.replaceChildren();
            const block = document.createElement('div'); block.className = 'wl-cc-error';
            const title = document.createElement('strong'); title.textContent = error instanceof CommandError ? error.message : 'РљРѕРјР°РЅРґР° РЅРµ РІС‹РїРѕР»РЅРµРЅР°';
            block.append(title);
            const note = document.createElement('p');
            note.textContent = error instanceof CommandError && error.hint ? error.hint : error instanceof CommandError ? 'Р’РІРµРґРёС‚Рµ В«РїРѕРјРѕС‰СЊВ», С‡С‚РѕР±С‹ СѓРІРёРґРµС‚СЊ РїСЂРёРјРµСЂС‹.' : 'Р”Р°РЅРЅС‹Рµ РЅРµ РјРµРЅСЏР»РёСЃСЊ. РџРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰С‘ СЂР°Р· РёР»Рё РѕС‚РєСЂРѕР№С‚Рµ СЃРїСЂР°РІРєСѓ.';
            block.append(note); output.append(block);
            if (!(error instanceof CommandError)) console.error('[Command Center]', error);
        },

        updateApplyBar() {
            const bar = $('#wl-cc-apply');
            if (!bar) return;
            const plan = this.pending;
            bar.hidden = !plan;
            if (!plan) return;
            const title = $('#wl-cc-apply-title');
            const note = $('#wl-cc-apply-note');
            const critical = $('#wl-cc-critical');
            const check = $('#wl-cc-critical-check');
            const button = $('#wl-cc-commit');
            title.textContent = plan.dryRun ? 'Dry run Р·Р°РІРµСЂС€С‘РЅ' : plan.meta.danger ? 'РќСѓР¶РЅРѕ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ' : 'РџР»Р°РЅ РіРѕС‚РѕРІ Рє РїСЂРёРјРµРЅРµРЅРёСЋ';
            if (plan.dryRun) note.textContent = 'Р РµР¶РёРј --dry-run: РїСЂРёРјРµРЅРµРЅРёРµ РѕС‚РєР»СЋС‡РµРЅРѕ';
            else if (plan.meta.danger && !plan.confirmed) note.textContent = 'Р”РѕР±Р°РІСЊС‚Рµ --confirm РІ РєРѕРјР°РЅРґСѓ Рё Р·Р°РїСѓСЃС‚РёС‚Рµ preview СЃРЅРѕРІР°';
            else note.textContent = `Р‘СѓРґРµС‚ РїСЂРёРјРµРЅРµРЅРѕ Р°С‚РѕРјР°СЂРЅРѕ: ${plan.meta.mutations} РёР·РјРµРЅРµРЅРёР№`;
            critical.hidden = !plan.meta.critical || plan.dryRun || !plan.confirmed;
            if (check) check.checked = false;
            button.dataset.danger = plan.meta.danger ? '1' : '0';
            button.textContent = plan.meta.danger ? 'РџРѕРґС‚РІРµСЂРґРёС‚СЊ' : 'РџСЂРёРјРµРЅРёС‚СЊ';
            this.updateCommitState();
        },

        updateCommitState() {
            const plan = this.pending;
            const button = $('#wl-cc-commit');
            if (!plan || !button) return;
            button.disabled = plan.dryRun || (plan.meta.danger && !plan.confirmed) || (plan.meta.critical && !$('#wl-cc-critical-check')?.checked);
        },

        commit() {
            const plan = this.pending;
            if (!plan) return;
            if (plan.dryRun || (plan.meta.danger && !plan.confirmed) || (plan.meta.critical && !$('#wl-cc-critical-check')?.checked)) return;
            let current;
            try { current = this.currentSnapshot(); }
            catch (error) { this.renderError(error); return; }
            if (current !== plan.sourceSnapshot) {
                this.pending = null;
                this.renderError(new CommandError('Р”Р°РЅРЅС‹Рµ РёР·РјРµРЅРёР»РёСЃСЊ РїРѕСЃР»Рµ preview', 'Р—Р°РїСѓСЃС‚РёС‚Рµ РєРѕРјР°РЅРґСѓ РµС‰С‘ СЂР°Р· вЂ” СЃС‚Р°СЂС‹Р№ РїР»Р°РЅ Р±РµР·РѕРїР°СЃРЅРѕ РѕС‚РјРµРЅС‘РЅ.'));
                this.updateApplyBar();
                return;
            }

            const before = {
                data: clone(this.app.data), config: clone(this.app.config), enhConfig: clone(this.currentEnhConfig()), currentId: this.app.state?.currentId || null
            };
            const enhancements = global.weeloserEnhancements;
            try {
                enhancements?.pushHistory?.();
                this.app.data = clone(plan.ctx.data);
                this.app.config = clone(plan.ctx.config);
                if (enhancements?.config) enhancements.config = clone(plan.ctx.enhConfig);
                const saved = this.app.save();
                if (saved === false) throw new Error('save returned false');
                enhancements?.saveConfig?.();
                this.app.applyTheme?.();
                enhancements?.applyVisualConfig?.();
                this.applyEffects(plan);
                this.refreshApp(plan);
                enhancements?.afterMutation?.();
                this.pending = null;
                this.renderSuccess(plan);
                this.updateApplyBar();
            } catch (error) {
                try {
                    this.app.data = before.data;
                    this.app.config = before.config;
                    if (enhancements?.config) enhancements.config = before.enhConfig;
                    if (this.app.state) this.app.state.currentId = before.currentId;
                    this.app.save();
                    enhancements?.saveConfig?.();
                    this.app.applyTheme?.();
                    this.refreshApp({ ctx: { currentId: before.currentId, openId: before.currentId } });
                } catch (rollbackError) { console.error('[Command Center] rollback failed', rollbackError); }
                this.pending = null;
                this.renderError(new CommandError('РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРёРјРµРЅРёС‚СЊ РїР°РєРµС‚', 'Р’СЃРµ РёР·РјРµРЅРµРЅРёСЏ Р±С‹Р»Рё РѕС‚РјРµРЅРµРЅС‹. РџСЂРѕРІРµСЂСЊС‚Рµ РґРѕСЃС‚СѓРїРЅРѕСЃС‚СЊ Р»РѕРєР°Р»СЊРЅРѕРіРѕ С…СЂР°РЅРёР»РёС‰Р°.'));
                this.updateApplyBar();
                console.error('[Command Center] commit failed', error);
            }
        },

        applyEffects(plan) {
            if (plan.ctx.openId && this.app.data?.[plan.ctx.openId]) this.app.openStat?.(plan.ctx.openId);
        },

        refreshApp(plan) {
            const wanted = plan.ctx.currentId;
            if (wanted && this.app.data?.[wanted]) {
                if (this.app.state) this.app.state.currentId = wanted;
                this.app.data.currentStatId = wanted;
                const query = document.getElementById('search-trade')?.value || '';
                this.app.renderTrades?.(query);
            } else if (this.app.state?.currentId && !this.app.data?.[this.app.state.currentId]) {
                this.app.goHome?.();
            } else if (!this.app.state?.currentId) {
                this.app.renderDashboard?.();
            } else {
                this.app.renderDashboard?.();
            }
        },

        renderSuccess(plan) {
            const output = $('#wl-cc-output');
            if (!output) return;
            output.replaceChildren();
            const head = document.createElement('div'); head.className = 'wl-cc-output-head';
            const copy = document.createElement('div');
            const title = document.createElement('h3'); title.textContent = 'Р“РѕС‚РѕРІРѕ';
            const note = document.createElement('p'); note.textContent = `РђС‚РѕРјР°СЂРЅРѕ РїСЂРёРјРµРЅРµРЅРѕ РёР·РјРµРЅРµРЅРёР№: ${plan.meta.mutations}`;
            copy.append(title, note); head.append(copy); output.append(head);
            this.renderSection(output, section('РљРѕРјР°РЅРґР° РІС‹РїРѕР»РЅРµРЅР°', [
                plan.meta.addedTrades ? `Р”РѕР±Р°РІР»РµРЅРѕ СЃРґРµР»РѕРє: ${plan.meta.addedTrades}` : 'Р”Р°РЅРЅС‹Рµ СЃРѕС…СЂР°РЅРµРЅС‹.',
                'РР·РјРµРЅРµРЅРёСЏ СѓР¶Рµ РѕС‚СЂР°Р¶РµРЅС‹ РІ Р¶СѓСЂРЅР°Р»Рµ.'
            ], { tone: 'positive' }));
            this.app.showToast?.(plan.meta.addedTrades ? `Р”РѕР±Р°РІР»РµРЅРѕ СЃРґРµР»РѕРє: ${plan.meta.addedTrades}` : 'РљРѕРјР°РЅРґР° РІС‹РїРѕР»РЅРµРЅР°');
        }
    };

    // Small public surface for integration tests and other optional modules.
    CommandCenter.version = VERSION;
    CommandCenter.tokenize = tokenizeProgram;
    CommandCenter.parse = function (source) {
        if (!this.app) throw new CommandError('Command Center РµС‰С‘ РЅРµ РїРѕРґРєР»СЋС‡С‘РЅ Рє РїСЂРёР»РѕР¶РµРЅРёСЋ');
        return parseProgram(source, this.app, this.currentEnhConfig());
    };
    CommandCenter.execute = function (source) { this.open(); this.run(source); };
    global.weeloserCommandConsole = CommandCenter;

    const boot = () => global.setTimeout(() => CommandCenter.mount(), 0);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
})(window);

