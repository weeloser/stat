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
        ['сессия', 'session'], ['сессии', 'session'],
        ['trade', 'trade'], ['trades', 'trade'], ['сделка', 'trade'], ['сделки', 'trade'],
        ['stats', 'stats'], ['statistic', 'stats'], ['statistics', 'stats'],
        ['статистика', 'stats'], ['итоги', 'stats'],
        ['config', 'config'], ['setting', 'config'], ['settings', 'config'],
        ['настройка', 'config'], ['настройки', 'config']
    ]);

    const ACTION_ALIASES = new Map([
        ['list', 'list'], ['ls', 'list'], ['список', 'list'], ['показать', 'list'],
        ['show', 'show'], ['view', 'show'], ['итог', 'show'], ['показать', 'show'],
        ['create', 'create'], ['new', 'create'], ['создать', 'create'], ['новая', 'create'],
        ['add', 'add'], ['добавить', 'add'],
        ['open', 'open'], ['use', 'open'], ['select', 'open'], ['открыть', 'open'], ['выбрать', 'open'],
        ['rename', 'rename'], ['name', 'rename'], ['переименовать', 'rename'],
        ['edit', 'edit'], ['update', 'edit'], ['change', 'edit'],
        ['редактировать', 'edit'], ['изменить', 'edit'],
        ['delete', 'delete'], ['remove', 'delete'], ['rm', 'delete'], ['удалить', 'delete'],
        ['clear', 'clear'], ['очистить', 'clear'],
        ['reset', 'reset'], ['сбросить', 'reset'],
        ['set', 'set'], ['установить', 'set'], ['задать', 'set'],
        ['duplicate', 'duplicate'], ['copy', 'duplicate'], ['копировать', 'duplicate'], ['дублировать', 'duplicate']
    ]);

    const KEY_ALIASES = new Map([
        ['name', 'name'], ['название', 'name'], ['имя', 'name'],
        ['balance', 'balance'], ['баланс', 'balance'],
        ['session', 'session'], ['сессия', 'session'], ['in', 'session'], ['в', 'session'],
        ['coin', 'coin'], ['symbol', 'coin'], ['ticker', 'coin'], ['тикер', 'coin'], ['монета', 'coin'],
        ['dir', 'dir'], ['direction', 'dir'], ['направление', 'dir'],
        ['entry', 'entry'], ['вход', 'entry'], ['open', 'entry'],
        ['exit', 'exit'], ['выход', 'exit'], ['close', 'exit'],
        ['margin', 'margin'], ['leverage', 'margin'], ['x', 'margin'], ['плечо', 'margin'], ['маржа', 'margin'],
        ['pct', 'pct'], ['percent', 'pct'], ['share', 'pct'], ['доля', 'pct'], ['процент', 'pct'],
        ['pnl', 'pnl'], ['result', 'pnl'], ['результат', 'pnl'], ['прибыль', 'pnl'],
        ['date', 'date'], ['дата', 'date'], ['time', 'date'],
        ['tag', 'tag'], ['тег', 'tag'],
        ['note', 'note'], ['comment', 'note'], ['заметка', 'note'], ['комментарий', 'note'],
        ['fixes', 'fixes'], ['exits', 'fixes'], ['фиксации', 'fixes'], ['выходы', 'fixes'],
        ['ids', 'ids'], ['id', 'ids'],
        ['limit', 'limit'], ['лимит', 'limit'],
        ['sort', 'sort'], ['сортировка', 'sort'],
        ['theme', 'theme'], ['тема', 'theme'],
        ['accent', 'accent'], ['акцент', 'accent'], ['цвет', 'accent'],
        ['dense', 'dense'], ['compact', 'dense'], ['компактно', 'dense'],
        ['focus', 'focus'], ['фокус', 'focus'],
        ['locked', 'locked'], ['readonly', 'locked'], ['толькочтение', 'locked'],
        ['archived', 'showArchived'], ['archive', 'showArchived'], ['архив', 'showArchived'],
        ['sessionsort', 'sessionSort'], ['сортировкасессий', 'sessionSort']
    ]);

    const DIRECTIONS = new Map([
        ['long', 'long'], ['l', 'long'], ['лонг', 'long'], ['buy', 'long'], ['покупка', 'long'],
        ['short', 'short'], ['s', 'short'], ['шорт', 'short'], ['sell', 'short'], ['продажа', 'short']
    ]);

    const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'да', 'вкл', 'включить']);
    const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', 'нет', 'выкл', 'выключить']);
    const CURRENT_VALUES = new Set(['current', 'active', 'текущая', 'текущий', 'открытая', '.']);
    const ALL_VALUES = new Set(['all', '*', 'все', 'всё']);

    const TEMPLATES = [
        ['сессии список', 'Все сессии с краткой статистикой'],
        ['сессия создать "Новая сессия"', 'Создать сессию'],
        ['сессия открыть "Название"', 'Открыть сессию по имени или ID'],
        ['сессия переименовать current "Новое название"', 'Переименовать активную сессию'],
        ['сессия удалить current --confirm', 'Удалить сессию после preview'],
        ['сделки список', 'Сделки активной сессии'],
        ['сделка добавить BTC long 60000 -> 62000 x3', 'Быстро добавить сделку'],
        ['сделка добавить BTC long вход=60000 выход=62000 плечо=3 тег=scalp', 'Добавить сделку через ключи'],
        ['trade add BTC long 60000 -> 62000 x3; trade add ETH short 3400 -> 3250 x2; trade add SOL long 145 -> 154 x2', 'Три сделки одним атомарным пакетом'],
        ['сделка изменить #1 тег="breakout" заметка="Вход по плану"', 'Изменить сделку по номеру'],
        ['сделка удалить #1 --confirm', 'Удалить сделку'],
        ['статистика показать current', 'Метрики активной сессии'],
        ['статистика очистить current --confirm', 'Удалить все сделки сессии'],
        ['настройка показать', 'Текущие настройки'],
        ['настройка установить тема=dark акцент=#7c3aed компактно=true', 'Изменить внешний вид'],
        ['помощь', 'Краткая справка по DSL'],
        ['история', 'Последние команды']
    ];

    const $ = (selector, root = document) => root.querySelector(selector);
    const clone = value => {
        try { return JSON.parse(JSON.stringify(value)); }
        catch (_) { throw new CommandError('Не удалось создать безопасную копию данных'); }
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
        if (!allowEmpty && !text) throw new CommandError(`${label}: значение не может быть пустым`);
        if (text.length > max) throw new CommandError(`${label}: максимум ${max} символов`);
        return text;
    };
    const finiteNumber = (value, label, options = {}) => {
        const normalized = typeof value === 'string' ? value.trim().replace(',', '.') : value;
        const number = Number(normalized);
        if (!Number.isFinite(number)) throw new CommandError(`${label}: нужно конечное число`);
        if (options.min !== undefined && number < options.min) throw new CommandError(`${label}: минимум ${options.min}`);
        if (options.max !== undefined && number > options.max) throw new CommandError(`${label}: максимум ${options.max}`);
        return number;
    };
    const boolValue = (value, label) => {
        const key = lower(value);
        if (TRUE_VALUES.has(key)) return true;
        if (FALSE_VALUES.has(key)) return false;
        throw new CommandError(`${label}: используйте true/false, on/off или да/нет`);
    };
    const formatNumber = (value, digits = 2) => new Intl.NumberFormat('ru-RU', {
        maximumFractionDigits: digits,
        minimumFractionDigits: 0
    }).format(Number(value) || 0);
    const formatDate = value => {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('ru-RU');
    };

    class CommandError extends Error {
        constructor(message, hint = '') {
            super(message);
            this.name = 'CommandError';
            this.hint = hint;
        }
    }

    function tokenizeProgram(source) {
        if (typeof source !== 'string') throw new CommandError('Команда должна быть текстом');
        if (source.length > MAX_INPUT) throw new CommandError(`Слишком длинный ввод: максимум ${MAX_INPUT} символов`);

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
            if (totalTokens > MAX_TOKENS) throw new CommandError(`Слишком много параметров: максимум ${MAX_TOKENS}`);
            token = '';
            tokenStarted = false;
        };
        const pushCommand = () => {
            pushToken();
            if (!tokens.length) return;
            commands.push(tokens);
            if (commands.length > MAX_COMMANDS) throw new CommandError(`Слишком много команд: максимум ${MAX_COMMANDS}`);
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
        if (escaped) throw new CommandError('Незавершённая escape-последовательность');
        if (quote) throw new CommandError('Не закрыта кавычка', 'Закройте текст той же кавычкой');
        pushCommand();
        if (!commands.length) throw new CommandError('Введите команду или выберите пример ниже');
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
                if (!key) throw new CommandError(`Неизвестный ключ «${rawKey}»`);
                if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new CommandError('Недопустимый ключ');
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
        if (normalized === 'today' || normalized === 'сегодня') {
            today.setHours(12, 0, 0, 0);
            return today.getTime();
        }
        if (normalized === 'yesterday' || normalized === 'вчера') {
            today.setDate(today.getDate() - 1);
            today.setHours(12, 0, 0, 0);
            return today.getTime();
        }
        let date;
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) date = new Date(`${value}T12:00:00`);
        else date = new Date(value);
        if (Number.isNaN(date.getTime())) throw new CommandError(`Дата «${value}» не распознана`, 'Используйте YYYY-MM-DD, today/сегодня или yesterday/вчера');
        const year = date.getFullYear();
        if (year < 1970 || year > 2200) throw new CommandError('Дата должна быть между 1970 и 2200 годом');
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
            throw new CommandError('Нет активной сессии', 'Откройте её командой: сессия открыть "Название"');
        }
        if (isObject(ctx.data[raw])) return { id: raw, session: ctx.data[raw] };
        const entries = sessionEntries(ctx);
        const exact = entries.filter(([, session]) => lower(session.name) === key);
        if (exact.length === 1) return { id: exact[0][0], session: exact[0][1] };
        const partial = entries.filter(([id, session]) => lower(id).includes(key) || lower(session.name).includes(key));
        if (partial.length === 1) return { id: partial[0][0], session: partial[0][1] };
        if (partial.length > 1) throw new CommandError(`Сессия «${raw}» неоднозначна`, `Подходят: ${partial.slice(0, 5).map(([, s]) => s.name).join(', ')}`);
        if (options.optional) return null;
        throw new CommandError(`Сессия «${raw}» не найдена`);
    }

    function tradeEntries(session) {
        if (!Array.isArray(session.trades)) session.trades = [];
        return session.trades.map((trade, index) => ({ trade, index, number: index + 1 }));
    }

    function findTrades(session, selector, options = {}) {
        const entries = tradeEntries(session);
        const raw = String(selector == null ? '' : selector).trim();
        const key = lower(raw);
        if (!raw) throw new CommandError('Укажите сделку: ID, #номер или тикер');
        if (ALL_VALUES.has(key)) return entries;
        if (/^#\d+$/.test(raw)) {
            const index = Number(raw.slice(1)) - 1;
            if (!entries[index]) throw new CommandError(`Сделки ${raw} нет`);
            return [entries[index]];
        }
        const selectors = raw.split(',').map(item => item.trim()).filter(Boolean);
        if (selectors.length > 1) {
            const found = [];
            const seen = new Set();
            selectors.forEach(item => findTrades(session, item, options).forEach(entry => {
                if (!seen.has(entry.trade.id)) { seen.add(entry.trade.id); found.push(entry); }
            }));
            return found;
        }
        if (key.startsWith('coin:') || key.startsWith('тикер:')) {
            const coin = lower(raw.slice(raw.indexOf(':') + 1));
            const matches = entries.filter(entry => lower(entry.trade.coin) === coin);
            if (!matches.length) throw new CommandError(`Сделок ${coin.toUpperCase()} нет`);
            return matches;
        }
        const exactId = entries.filter(entry => String(entry.trade.id) === raw);
        if (exactId.length) return exactId;
        const exactCoin = entries.filter(entry => lower(entry.trade.coin) === key);
        if (exactCoin.length === 1 || options.allowMany) return exactCoin;
        if (exactCoin.length > 1) throw new CommandError(`Найдено несколько сделок ${raw}`, `Укажите #номер/ID или используйте coin:${raw} для всех`);
        const partialId = entries.filter(entry => lower(entry.trade.id).includes(key));
        if (partialId.length === 1) return partialId;
        throw new CommandError(`Сделка «${raw}» не найдена`);
    }

    function parseFixes(value) {
        const parts = String(value).split(',').map(part => part.trim()).filter(Boolean);
        if (!parts.length) throw new CommandError('Фиксации пусты', 'Формат: выходы=62000@50,64000@50');
        if (parts.length > 100) throw new CommandError('Максимум 100 фиксаций в сделке');
        let total = 0;
        const fixes = parts.map(part => {
            const [priceRaw, pctRaw = '100'] = part.split('@');
            const p = finiteNumber(priceRaw, 'Цена фиксации', { min: Number.EPSILON, max: 1e15 });
            const pct = finiteNumber(pctRaw, 'Доля фиксации', { min: Number.EPSILON, max: 100 });
            total += pct;
            return { p, pct: Number(pct.toFixed(4)) };
        });
        if (total > 100.0001) throw new CommandError(`Сумма фиксаций ${formatNumber(total, 4)}% превышает 100%`);
        return fixes;
    }

    function parseTradeSpec(tokens) {
        const parsed = parseArguments(tokens);
        const options = parsed.options;
        const positionals = [...parsed.positionals];

        let coin = options.coin;
        let dir = options.dir;
        let entry = options.entry;
        let exit = options.exit;
        let margin = options.margin;
        let pct = options.pct;

        if (!coin && positionals.length) coin = positionals.shift();
        if (!dir && positionals.length && DIRECTIONS.has(lower(positionals[0]))) dir = positionals.shift();
        if (entry == null && positionals.length && positionals[0] !== '->') entry = positionals.shift();
        const arrowIndex = positionals.indexOf('->');
        if (arrowIndex >= 0) {
            if (arrowIndex !== 0) throw new CommandError('Перед -> остались лишние параметры');
            positionals.shift();
            if (!positionals.length) throw new CommandError('После -> укажите цену выхода');
            if (exit == null) exit = positionals.shift();
        }
        if (margin == null && positionals.length && /^x\d+(?:[.,]\d+)?$/i.test(positionals[0])) margin = positionals.shift().slice(1);
        if (positionals.length) throw new CommandError(`Не удалось распознать: ${positionals.join(' ')}`, 'Текстовые значения заключайте в кавычки и задавайте как ключ=значение');

        coin = cleanText(coin, 32, 'Тикер').toUpperCase();
        if (!/^[\p{L}\p{N}][\p{L}\p{N}._/-]{0,31}$/u.test(coin)) throw new CommandError('Тикер содержит недопустимые символы');
        const direction = DIRECTIONS.get(lower(dir || 'long'));
        if (!direction) throw new CommandError('Направление: long/short или лонг/шорт');
        const entryNumber = finiteNumber(entry, 'Цена входа', { min: Number.EPSILON, max: 1e15 });
        const marginNumber = finiteNumber(margin == null || margin === '' ? 1 : margin, 'Плечо', { min: 0.0001, max: 1000 });
        const pctNumber = finiteNumber(pct == null || pct === '' ? 100 : pct, 'Доля', { min: Number.EPSILON, max: 100 });

        let fixes;
        if (options.fixes != null) fixes = parseFixes(options.fixes);
        else {
            if (options.pnl != null && (exit == null || exit === '')) {
                const pnl = finiteNumber(options.pnl, 'P&L', { min: -1e9, max: 1e9 });
                const sign = direction === 'long' ? 1 : -1;
                exit = entryNumber * (1 + sign * pnl / (100 * marginNumber * (pctNumber / 100)));
            }
            if (exit == null || exit === '') throw new CommandError('Укажите цену выхода, P&L или фиксации', 'Пример: BTC long 60000 -> 62000 x3');
            const exitNumber = finiteNumber(exit, 'Цена выхода', { min: Number.EPSILON, max: 1e15 });
            fixes = [{ p: exitNumber, pct: Number(pctNumber.toFixed(4)) }];
        }

        return {
            sessionSelector: options.session,
            trade: {
                coin,
                entry: entryNumber,
                margin: marginNumber,
                dir: direction,
                fixes,
                ts: parseDate(options.date),
                tag: options.tag == null ? '' : cleanText(options.tag, 40, 'Тег', true),
                note: options.note == null ? '' : cleanText(options.note, 500, 'Заметка', true)
            }
        };
    }

    function tradePnl(trade) {
        const entry = Number(trade.entry);
        const margin = Number(trade.margin) || 1;
        if (!(entry > 0) || !Array.isArray(trade.fixes)) return 0;
        let result = 0;
        for (const fix of trade.fixes) {
            const price = Number(fix.p ?? fix.price);
            const pct = Number(fix.pct ?? fix.percent);
            if (!Number.isFinite(price) || !Number.isFinite(pct)) continue;
            const move = ((price - entry) / entry) * 100;
            result += move * (trade.dir === 'short' ? -1 : 1) * margin * (pct / 100);
        }
        return Number.isFinite(result) ? result : 0;
    }

    function metrics(trades) {
        const values = (Array.isArray(trades) ? trades : []).map(tradePnl);
        const wins = values.filter(value => value > 0.05).length;
        const losses = values.filter(value => value < -0.05).length;
        const be = values.length - wins - losses;
        const decided = wins + losses;
        const pnl = values.reduce((sum, value) => sum + value, 0);
        const grossWin = values.filter(value => value > 0).reduce((sum, value) => sum + value, 0);
        const grossLoss = Math.abs(values.filter(value => value < 0).reduce((sum, value) => sum + value, 0));
        return {
            count: values.length,
            pnl,
            wins,
            losses,
            be,
            winrate: decided ? Math.round((wins / decided) * 100) : 0,
            avg: values.length ? pnl / values.length : 0,
            pf: grossLoss ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0
        };
    }

    function section(title, lines = [], options = {}) {
        return { title, lines, tone: options.tone || 'neutral', table: options.table || null, badges: options.badges || [] };
    }

    function ensureWritable(ctx, entity) {
        if (ctx.enhConfig?.locked && entity !== 'config') {
            throw new CommandError('Включён режим «только чтение»', 'Отключите: настройка установить толькочтение=false');
        }
    }

    function handleSession(ctx, action, args, meta) {
        const { options, positionals } = parseArguments(args);
        if (!action || action === 'show') action = 'list';
        if (action === 'list') {
            const rows = sessionEntries(ctx).map(([id, session], index) => {
                const m = metrics(session.trades);
                return [String(index + 1), session.name || 'Без названия', String((session.trades || []).length), `${m.pnl >= 0 ? '+' : ''}${formatNumber(m.pnl)}%`, `${m.winrate}%`, id];
            });
            meta.sections.push(section(`Сессии · ${rows.length}`, rows.length ? [] : ['Сессий пока нет.'], {
                table: rows.length ? { headers: ['#', 'Название', 'Сделки', 'P&L', 'Winrate', 'ID'], rows } : null
            }));
            return;
        }
        if (action === 'create' || action === 'add') {
            ensureWritable(ctx, 'session');
            if (sessionEntries(ctx).length >= MAX_SESSIONS) throw new CommandError(`Достигнут лимит ${MAX_SESSIONS} сессий`);
            const name = cleanText(options.name ?? positionals.join(' '), 100, 'Название');
            const balance = options.balance == null || options.balance === '' ? 0 : finiteNumber(options.balance, 'Баланс', { min: -1e15, max: 1e15 });
            const occupied = new Set(Object.keys(ctx.data));
            const id = uniqueId('s', occupied);
            ctx.data[id] = { name, balance, trades: [] };
            meta.mutations++;
            meta.sections.push(section('Создать сессию', [`«${name}»`, `Начальный баланс: ${formatNumber(balance)}`, `ID: ${id}`], { tone: 'positive' }));
            return;
        }
        if (action === 'open') {
            const selector = options.session ?? positionals.join(' ');
            const found = findSession(ctx, selector);
            ctx.currentId = found.id;
            ctx.openId = found.id;
            meta.effects++;
            meta.sections.push(section('Открыть сессию', [`«${found.session.name}»`, `${(found.session.trades || []).length} сделок`], { tone: 'positive' }));
            return;
        }
        if (action === 'rename' || action === 'edit') {
            ensureWritable(ctx, 'session');
            let selector = options.session;
            let name = options.name;
            if (!selector) selector = positionals.shift() || 'current';
            if (name == null) name = positionals.join(' ');
            const found = findSession(ctx, selector);
            const nextName = cleanText(name, 100, 'Новое название');
            const previous = found.session.name;
            found.session.name = nextName;
            if (options.balance != null) found.session.balance = finiteNumber(options.balance, 'Баланс', { min: -1e15, max: 1e15 });
            meta.mutations++;
            meta.sections.push(section('Изменить сессию', [`«${previous}» → «${nextName}»`], { tone: 'positive' }));
            return;
        }
        if (action === 'delete') {
            ensureWritable(ctx, 'session');
            const selector = options.session ?? (positionals.join(' ') || 'current');
            if (ALL_VALUES.has(lower(selector))) {
                const entries = sessionEntries(ctx);
                if (!entries.length) throw new CommandError('Сессий для удаления нет');
                entries.forEach(([id]) => delete ctx.data[id]);
                delete ctx.data.currentStatId;
                ctx.currentId = null;
                ctx.openId = null;
                meta.danger = true;
                meta.critical = true;
                meta.mutations++;
                meta.sections.push(section('Удалить все сессии', [`Будет удалено: ${entries.length}`, 'Все сделки и статистика исчезнут.'], { tone: 'danger' }));
                return;
            }
            const found = findSession(ctx, selector);
            delete ctx.data[found.id];
            if (ctx.currentId === found.id || ctx.data.currentStatId === found.id) {
                delete ctx.data.currentStatId;
                ctx.currentId = null;
                ctx.openId = null;
            }
            meta.danger = true;
            meta.mutations++;
            meta.sections.push(section('Удалить сессию', [`«${found.session.name}»`, `Внутри сделок: ${(found.session.trades || []).length}`], { tone: 'danger' }));
            return;
        }
        if (action === 'duplicate') {
            ensureWritable(ctx, 'session');
            const selector = options.session ?? positionals.shift() ?? 'current';
            const found = findSession(ctx, selector);
            const name = cleanText(options.name ?? (positionals.join(' ') || `${found.session.name} — копия`), 100, 'Название копии');
            const occupied = new Set(Object.keys(ctx.data));
            const id = uniqueId('s', occupied);
            ctx.data[id] = clone(found.session);
            ctx.data[id].name = name;
            const tradeIds = new Set((ctx.data[id].trades || []).map(trade => String(trade.id)));
            ctx.data[id].trades = (ctx.data[id].trades || []).map(trade => {
                const tradeId = uniqueId('t', tradeIds);
                tradeIds.add(tradeId);
                return { ...trade, id: tradeId };
            });
            meta.mutations++;
            meta.sections.push(section('Копировать сессию', [`«${found.session.name}» → «${name}»`, `Сделок: ${ctx.data[id].trades.length}`], { tone: 'positive' }));
            return;
        }
        throw new CommandError(`Неизвестное действие сессии «${action || ''}»`, 'Доступно: список, создать, открыть, переименовать, удалить, копировать');
    }

    function handleTradeAdd(ctx, args, meta) {
        ensureWritable(ctx, 'trade');
        if (meta.addedTrades >= MAX_BATCH_TRADES) throw new CommandError(`В одном пакете можно добавить не более ${MAX_BATCH_TRADES} сделок`);
        const parsed = parseTradeSpec(args);
        const target = findSession(ctx, parsed.sessionSelector || 'current');
        if (!Array.isArray(target.session.trades)) target.session.trades = [];
        if (target.session.trades.length >= MAX_TRADES_PER_SESSION) throw new CommandError(`В сессии достигнут лимит ${MAX_TRADES_PER_SESSION} сделок`);
        const occupied = new Set(target.session.trades.map(trade => String(trade.id)));
        parsed.trade.id = uniqueId('t', occupied);
        target.session.trades.push(parsed.trade);
        meta.addedTrades++;
        meta.mutations++;
        const pnl = tradePnl(parsed.trade);
        meta.sections.push(section(`Добавить ${parsed.trade.coin}`, [
            `${parsed.trade.dir === 'long' ? 'LONG' : 'SHORT'} · вход ${formatNumber(parsed.trade.entry, 8)} · x${formatNumber(parsed.trade.margin, 4)}`,
            `Расчётный P&L: ${pnl >= 0 ? '+' : ''}${formatNumber(pnl, 4)}%`,
            `Сессия: «${target.session.name}»`
        ], { tone: pnl >= 0 ? 'positive' : 'neutral' }));
    }

    function handleTrade(ctx, action, args, meta) {
        if (action === 'add' || action === 'create') return handleTradeAdd(ctx, args, meta);
        const parsed = parseArguments(args);
        const options = parsed.options;
        const positionals = parsed.positionals;
        const target = findSession(ctx, options.session || 'current');

        if (!action || action === 'show' || action === 'list') {
            let entries = tradeEntries(target.session);
            const limit = options.limit == null ? 50 : Math.floor(finiteNumber(options.limit, 'Лимит', { min: 1, max: 500 }));
            if (options.sort === 'profit' || options.sort === 'прибыль') entries.sort((a, b) => tradePnl(b.trade) - tradePnl(a.trade));
            else if (options.sort === 'oldest' || options.sort === 'старые') entries.sort((a, b) => Number(a.trade.ts) - Number(b.trade.ts));
            else entries.sort((a, b) => Number(b.trade.ts) - Number(a.trade.ts));
            const rows = entries.slice(0, limit).map(entry => {
                const pnl = tradePnl(entry.trade);
                return [`#${entry.number}`, entry.trade.coin || '—', String(entry.trade.dir || 'long').toUpperCase(), formatDate(entry.trade.ts), `${pnl >= 0 ? '+' : ''}${formatNumber(pnl, 4)}%`, entry.trade.id];
            });
            meta.sections.push(section(`Сделки · «${target.session.name}» · ${entries.length}`, rows.length ? [] : ['В этой сессии пока нет сделок.'], {
                table: rows.length ? { headers: ['#', 'Тикер', 'Dir', 'Дата', 'P&L', 'ID'], rows } : null
            }));
            return;
        }

        if (action === 'delete') {
            ensureWritable(ctx, 'trade');
            const selector = options.ids ?? positionals.join(',');
            const matches = findTrades(target.session, selector, { allowMany: true });
            if (!matches.length) throw new CommandError('Подходящих сделок нет');
            const originalCount = target.session.trades.length;
            const ids = new Set(matches.map(entry => String(entry.trade.id)));
            target.session.trades = target.session.trades.filter(trade => !ids.has(String(trade.id)));
            meta.danger = true;
            if (matches.length === originalCount || matches.length >= 20) meta.critical = true;
            meta.mutations++;
            meta.sections.push(section(`Удалить сделки · ${matches.length}`, matches.slice(0, 8).map(entry => `${entry.trade.coin} · ${entry.trade.id}`), { tone: 'danger' }));
            return;
        }

        if (action === 'duplicate') {
            ensureWritable(ctx, 'trade');
            const selector = positionals.shift();
            const matches = findTrades(target.session, selector);
            if (target.session.trades.length + matches.length > MAX_TRADES_PER_SESSION) throw new CommandError('Превышен лимит сделок');
            const occupied = new Set(target.session.trades.map(trade => String(trade.id)));
            matches.forEach(entry => {
                const copy = clone(entry.trade);
                copy.id = uniqueId('t', occupied);
                copy.ts = Date.now();
                occupied.add(copy.id);
                target.session.trades.push(copy);
            });
            meta.mutations++;
            meta.sections.push(section('Копировать сделки', [`Создано копий: ${matches.length}`, `Сессия: «${target.session.name}»`], { tone: 'positive' }));
            return;
        }

        if (action === 'edit' || action === 'set') {
            ensureWritable(ctx, 'trade');
            const selector = options.ids ?? positionals.shift();
            if (positionals.length) throw new CommandError(`Лишние параметры: ${positionals.join(' ')}`);
            const matches = findTrades(target.session, selector);
            if (matches.length !== 1) throw new CommandError('Редактировать можно одну сделку за команду');
            const trade = matches[0].trade;
            const beforeCoin = trade.coin;
            if (options.coin != null) {
                const coin = cleanText(options.coin, 32, 'Тикер').toUpperCase();
                if (!/^[\p{L}\p{N}][\p{L}\p{N}._/-]{0,31}$/u.test(coin)) throw new CommandError('Тикер содержит недопустимые символы');
                trade.coin = coin;
            }
            if (options.dir != null) {
                const dir = DIRECTIONS.get(lower(options.dir));
                if (!dir) throw new CommandError('Направление: long/short или лонг/шорт');
                trade.dir = dir;
            }
            if (options.entry != null) trade.entry = finiteNumber(options.entry, 'Цена входа', { min: Number.EPSILON, max: 1e15 });
            if (options.margin != null) trade.margin = finiteNumber(options.margin, 'Плечо', { min: 0.0001, max: 1000 });
            if (options.date != null) trade.ts = parseDate(options.date);
            if (options.tag != null) trade.tag = cleanText(options.tag, 40, 'Тег', true);
            if (options.note != null) trade.note = cleanText(options.note, 500, 'Заметка', true);
            if (options.fixes != null) trade.fixes = parseFixes(options.fixes);
            else if (options.exit != null || options.pnl != null) {
                const pct = finiteNumber(options.pct == null ? 100 : options.pct, 'Доля', { min: Number.EPSILON, max: 100 });
                let exit = options.exit;
                if (options.pnl != null && exit == null) {
                    const pnl = finiteNumber(options.pnl, 'P&L', { min: -1e9, max: 1e9 });
                    const sign = trade.dir === 'short' ? -1 : 1;
                    exit = trade.entry * (1 + sign * pnl / (100 * trade.margin * (pct / 100)));
                }
                trade.fixes = [{ p: finiteNumber(exit, 'Цена выхода', { min: Number.EPSILON, max: 1e15 }), pct }];
            } else if (options.pct != null) {
                const pct = finiteNumber(options.pct, 'Доля', { min: Number.EPSILON, max: 100 });
                if (!Array.isArray(trade.fixes) || trade.fixes.length !== 1) throw new CommandError('Для нескольких фиксаций задайте выходы=цена@доля,...');
                trade.fixes[0].pct = pct;
            }
            const changedKeys = Object.keys(options).filter(key => key !== 'session');
            if (!changedKeys.length) throw new CommandError('Укажите хотя бы одно изменяемое поле');
            meta.mutations++;
            meta.sections.push(section('Изменить сделку', [
                `${beforeCoin} · ${trade.id}`,
                `Поля: ${changedKeys.join(', ')}`,
                `Новый P&L: ${tradePnl(trade) >= 0 ? '+' : ''}${formatNumber(tradePnl(trade), 4)}%`
            ], { tone: 'positive' }));
            return;
        }
        throw new CommandError(`Неизвестное действие сделки «${action || ''}»`, 'Доступно: список, добавить, изменить, удалить, копировать');
    }

    function handleStats(ctx, action, args, meta) {
        const { options, positionals } = parseArguments(args);
        if (!action || action === 'list' || action === 'show') {
            const selector = options.session ?? (positionals.join(' ') || 'current');
            if (ALL_VALUES.has(lower(selector))) {
                const allTrades = sessionEntries(ctx).flatMap(([, session]) => Array.isArray(session.trades) ? session.trades : []);
                const m = metrics(allTrades);
                meta.sections.push(statsSection('Вся статистика', m, sessionEntries(ctx).length));
                return;
            }
            const found = findSession(ctx, selector);
            meta.sections.push(statsSection(`Статистика · «${found.session.name}»`, metrics(found.session.trades)));
            return;
        }
        if (action === 'clear' || action === 'reset' || action === 'delete') {
            ensureWritable(ctx, 'stats');
            const selector = options.session ?? (positionals.join(' ') || 'current');
            if (ALL_VALUES.has(lower(selector))) {
                const total = sessionEntries(ctx).reduce((sum, [, session]) => sum + (session.trades || []).length, 0);
                sessionEntries(ctx).forEach(([, session]) => { session.trades = []; });
                if (!total) throw new CommandError('Сделок для очистки нет');
                meta.sections.push(section('Очистить всю статистику', [`Будет удалено сделок: ${total}`, 'Сами сессии сохранятся.'], { tone: 'danger' }));
                meta.critical = true;
            } else {
                const found = findSession(ctx, selector);
                const total = (found.session.trades || []).length;
                if (!total) throw new CommandError('В сессии нет сделок');
                found.session.trades = [];
                meta.sections.push(section('Очистить статистику', [`Сессия: «${found.session.name}»`, `Будет удалено сделок: ${total}`], { tone: 'danger' }));
                if (total >= 20) meta.critical = true;
            }
            meta.danger = true;
            meta.mutations++;
            return;
        }
        throw new CommandError(`Неизвестное действие статистики «${action || ''}»`, 'Доступно: показать, очистить');
    }

    function statsSection(title, m, sessionsCount) {
        const rows = [];
        if (sessionsCount != null) rows.push(['Сессии', String(sessionsCount)]);
        rows.push(
            ['Сделки', String(m.count)],
            ['P&L', `${m.pnl >= 0 ? '+' : ''}${formatNumber(m.pnl, 4)}%`],
            ['Winrate', `${m.winrate}%`],
            ['Win / Loss / BE', `${m.wins} / ${m.losses} / ${m.be}`],
            ['Средняя', `${m.avg >= 0 ? '+' : ''}${formatNumber(m.avg, 4)}%`],
            ['Profit Factor', Number.isFinite(m.pf) ? formatNumber(m.pf, 3) : '∞']
        );
        return section(title, [], { table: { headers: ['Метрика', 'Значение'], rows } });
    }

    function handleConfig(ctx, action, args, meta) {
        const { options, positionals } = parseArguments(args);
        if (!action || action === 'list' || action === 'show') {
            const rows = [
                ['theme / тема', ctx.config.theme || 'dark'],
                ['sort / сортировка', ctx.config.sort || 'newest'],
                ['accent / акцент', ctx.enhConfig?.accent || 'по умолчанию'],
                ['dense / компактно', String(ctx.enhConfig?.dense === true)],
                ['focus / фокус', String(ctx.enhConfig?.focus === true)],
                ['locked / толькочтение', String(ctx.enhConfig?.locked === true)],
                ['archive / архив', String(ctx.enhConfig?.showArchived === true)],
                ['sessionSort', ctx.enhConfig?.sessionSort || 'newest']
            ];
            meta.sections.push(section('Настройки', [], { table: { headers: ['Ключ', 'Значение'], rows } }));
            return;
        }
        if (action === 'set' || action === 'edit') {
            if (positionals.length) throw new CommandError(`Не удалось распознать: ${positionals.join(' ')}`, 'Используйте ключ=значение');
            const keys = Object.keys(options);
            if (!keys.length) throw new CommandError('Укажите настройки как ключ=значение');
            for (const key of keys) {
                const value = options[key];
                if (key === 'theme') {
                    const theme = lower(value);
                    if (!['dark', 'light'].includes(theme)) throw new CommandError('Тема: dark или light');
                    ctx.config.theme = theme;
                } else if (key === 'sort') {
                    const sort = lower(value);
                    if (!['newest', 'oldest', 'profit'].includes(sort)) throw new CommandError('Сортировка сделок: newest, oldest или profit');
                    ctx.config.sort = sort;
                } else if (key === 'accent') {
                    if (value !== '' && !/^#[0-9a-f]{6}$/i.test(value)) throw new CommandError('Акцент задаётся как #RRGGBB');
                    ctx.enhConfig.accent = value;
                } else if (['dense', 'focus', 'locked', 'showArchived'].includes(key)) {
                    ctx.enhConfig[key] = boolValue(value, key);
                } else if (key === 'sessionSort') {
                    const sort = lower(value);
                    if (!['newest', 'oldest', 'profit', 'winrate', 'trades', 'name', 'favorites'].includes(sort)) throw new CommandError('Неизвестная сортировка сессий');
                    ctx.enhConfig.sessionSort = sort;
                } else {
                    throw new CommandError(`Настройка «${key}» здесь недоступна`);
                }
            }
            meta.mutations++;
            meta.configMutation = true;
            meta.sections.push(section('Изменить настройки', keys.map(key => `${key} = ${String(options[key])}`), { tone: 'positive' }));
            return;
        }
        if (action === 'reset') {
            ctx.config.theme = 'dark';
            ctx.config.sort = 'newest';
            Object.assign(ctx.enhConfig, { accent: '', dense: false, focus: false, locked: false, showArchived: false, sessionSort: 'newest' });
            meta.mutations++;
            meta.configMutation = true;
            meta.sections.push(section('Сбросить внешний вид', ['Будут возвращены стандартные визуальные настройки.'], { tone: 'neutral' }));
            return;
        }
        throw new CommandError(`Неизвестное действие настройки «${action || ''}»`, 'Доступно: показать, установить, сбросить');
    }

    function helpSections() {
        return [
            section('Как устроены команды', [
                'Формат: сущность действие параметры.',
                'RU/EN можно смешивать. Текст с пробелами заключайте в кавычки.',
                'Несколько команд разделяйте ; или переносом строки — пакет применится атомарно.',
                'Любое изменение сначала показывает preview. --dry-run запрещает применение.',
                'Для удаления и очистки обязательно добавьте --confirm.'
            ], { tone: 'positive' }),
            section('Быстрые примеры', [
                'сессия создать "Июль · неделя 3" баланс=1000',
                'сделка добавить BTC long 60000 -> 62000 x3',
                'trade add ETH short entry=3400 exit=3250 margin=2 date=2026-07-16',
                'сделка изменить #1 тег=scalp заметка="Чёткий вход"',
                'статистика показать current',
                'сделка удалить #1 --confirm'
            ]),
            section('Пакет из трёх сделок', [
                'trade add BTC long 60000 -> 62000 x3;',
                'trade add ETH short 3400 -> 3250 x2;',
                'trade add SOL long 145 -> 154 x2'
            ])
        ];
    }

    function parseProgram(source, app, enhancementConfig) {
        const rawCommands = tokenizeProgram(source);
        const normalizedCommands = [];
        let previousTradeAdd = false;
        let dryRun = false;
        let confirmed = false;

        for (const rawTokens of rawCommands) {
            const tokens = rawTokens.filter(token => {
                const flag = lower(token);
                if (flag === '--dry-run' || flag === '--preview' || flag === '--тест') { dryRun = true; return false; }
                if (flag === '--confirm' || flag === '--подтвердить') { confirmed = true; return false; }
                return true;
            });
            if (!tokens.length) continue;
            const firstEntity = canonicalEntity(tokens[0]);
            const top = lower(tokens[0]);
            const isTopCommand = firstEntity || ['help', 'помощь', '?', 'history', 'история', 'clear', 'очиститьэкран', 'examples', 'примеры'].includes(top);
            if (!isTopCommand && previousTradeAdd) tokens.unshift('add'), tokens.unshift('trade');
            normalizedCommands.push(tokens);
            previousTradeAdd = canonicalEntity(tokens[0]) === 'trade' && canonicalAction(tokens[1]) === 'add';
        }
        if (!normalizedCommands.length) throw new CommandError('После флагов не осталось команды');

        const sourceState = {
            data: clone(app.data || {}),
            config: clone(app.config || {}),
            enhConfig: clone(enhancementConfig || {})
        };
        const ctx = {
            data: clone(sourceState.data),
            config: clone(sourceState.config),
            enhConfig: clone(sourceState.enhConfig),
            currentId: app.state?.currentId || sourceState.data.currentStatId || null,
            openId: null
        };
        const meta = {
            sections: [], mutations: 0, effects: 0, danger: false, critical: false,
            configMutation: false, addedTrades: 0
        };

        for (const tokens of normalizedCommands) {
            const top = lower(tokens[0]);
            if (['help', 'помощь', '?', 'examples', 'примеры'].includes(top)) {
                meta.sections.push(...helpSections());
                continue;
            }
            if (['history', 'история'].includes(top)) {
                meta.showHistory = true;
                continue;
            }
            if (['clear', 'очиститьэкран'].includes(top)) {
                meta.clearOutput = true;
                continue;
            }
            const entity = canonicalEntity(tokens.shift());
            if (!entity) throw new CommandError(`Неизвестная сущность «${tokens[0] || top}»`, 'Начните с: сессия, сделка, статистика или настройка');
            const actionToken = tokens.length ? tokens.shift() : '';
            const action = canonicalAction(actionToken) || (entity === 'stats' || entity === 'config' ? 'show' : actionToken ? null : 'list');
            if (actionToken && !action) throw new CommandError(`Неизвестное действие «${actionToken}»`);
            if (entity === 'session') handleSession(ctx, action, tokens, meta);
            else if (entity === 'trade') handleTrade(ctx, action, tokens, meta);
            else if (entity === 'stats') handleStats(ctx, action, tokens, meta);
            else if (entity === 'config') handleConfig(ctx, action, tokens, meta);
        }

        return {
            source,
            sourceSnapshot: JSON.stringify(sourceState),
            ctx,
            meta,
            dryRun,
            confirmed,
            commandCount: normalizedCommands.length
        };
    }

    const CommandCenter = {
        app: null,
        mounted: false,
        opened: false,
        pending: null,
        history: [],
        historyIndex: -1,
        historyDraft: '',
        suggestionIndex: 0,

        mount() {
            if (this.mounted) return true;
            if (!global.app || typeof global.app.save !== 'function' || !document.body) {
                global.setTimeout(() => this.mount(), 80);
                return false;
            }
            this.app = global.app;
            this.loadHistory();
            this.injectStyles();
            this.injectButton();
            this.injectDialog();
            this.bindEvents();
            this.mounted = true;
            return true;
        },

        injectStyles() {
            if ($('#wl-cc-styles')) return;
            const style = document.createElement('style');
            style.id = 'wl-cc-styles';
            style.textContent = `
                body.wl-cc-open{overflow:hidden}
                #wl-command-trigger{display:inline-flex;align-items:center;gap:.5rem;min-height:40px;padding:.5rem .72rem;border:1px solid color-mix(in srgb,var(--border,#334155) 82%,transparent);border-radius:13px;background:color-mix(in srgb,var(--bg-card,#0f172a) 76%,transparent);color:var(--text-main,#f8fafc);font:700 12px/1 Inter,system-ui,sans-serif;letter-spacing:.01em;box-shadow:0 8px 24px rgba(15,23,42,.08);transition:transform .18s ease,border-color .18s ease,background .18s ease}
                #wl-command-trigger:hover{transform:translateY(-1px);border-color:color-mix(in srgb,var(--accent,#6366f1) 55%,var(--border,#334155));background:var(--bg-hover,#1e293b)}
                #wl-command-trigger:active{transform:translateY(0) scale(.98)}
                #wl-command-trigger svg{width:17px;height:17px;color:var(--accent,#6366f1)}
                #wl-command-trigger kbd{padding:.18rem .38rem;border:1px solid var(--border,#334155);border-radius:6px;color:var(--text-muted,#94a3b8);background:var(--bg-main,#020617);font:600 9px/1 Inter,system-ui,sans-serif}
                .wl-cc-fixed-trigger{position:fixed;right:1rem;top:1rem;z-index:90}
                #wl-command-center{position:fixed;inset:0;z-index:2147483000;display:none;align-items:flex-start;justify-content:center;padding:clamp(4.75rem,9vh,7rem) 1rem 1rem;font-family:Inter,system-ui,-apple-system,sans-serif}
                #wl-command-center[data-open="1"]{display:flex}
                .wl-cc-backdrop{position:absolute;inset:0;background:rgba(2,6,23,.62);backdrop-filter:blur(15px) saturate(.9);animation:wlCcFade .16s ease-out}
                .wl-cc-dialog{position:relative;display:flex;flex-direction:column;width:min(900px,100%);max-height:min(760px,calc(100vh - 6rem));overflow:hidden;border:1px solid color-mix(in srgb,var(--border,#334155) 82%,white 8%);border-radius:24px;background:color-mix(in srgb,var(--bg-card,#0f172a) 96%,transparent);color:var(--text-main,#f8fafc);box-shadow:0 35px 100px rgba(2,6,23,.5),0 2px 12px rgba(2,6,23,.18);animation:wlCcPop .2s cubic-bezier(.2,.8,.2,1)}
                .wl-cc-head{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 1.1rem .75rem}
                .wl-cc-brand{display:flex;align-items:center;gap:.7rem;min-width:0}
                .wl-cc-logo{display:grid;place-items:center;width:36px;height:36px;flex:0 0 auto;border-radius:12px;background:linear-gradient(135deg,color-mix(in srgb,var(--accent,#6366f1) 90%,white),color-mix(in srgb,var(--accent,#6366f1) 58%,#a855f7));color:white;box-shadow:0 8px 24px color-mix(in srgb,var(--accent,#6366f1) 25%,transparent)}
                .wl-cc-logo svg{width:18px;height:18px}.wl-cc-title{font-size:.88rem;font-weight:800;letter-spacing:-.01em}.wl-cc-subtitle{margin-top:.18rem;color:var(--text-muted,#94a3b8);font-size:.68rem;font-weight:550;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
                .wl-cc-close{display:grid;place-items:center;width:36px;height:36px;border:0;border-radius:11px;background:transparent;color:var(--text-muted,#94a3b8);transition:.16s ease}.wl-cc-close:hover{background:var(--bg-hover,#1e293b);color:var(--text-main,#fff)}.wl-cc-close svg{width:18px;height:18px}
                .wl-cc-compose{padding:.45rem 1.1rem .95rem;border-bottom:1px solid var(--border,#334155)}
                .wl-cc-input-shell{display:flex;align-items:flex-start;gap:.7rem;padding:.72rem .72rem .72rem .85rem;border:1px solid color-mix(in srgb,var(--border,#334155) 92%,transparent);border-radius:17px;background:var(--bg-main,#020617);box-shadow:inset 0 1px 0 rgba(255,255,255,.02);transition:border-color .16s ease,box-shadow .16s ease}
                .wl-cc-input-shell:focus-within{border-color:color-mix(in srgb,var(--accent,#6366f1) 75%,white 5%);box-shadow:0 0 0 4px color-mix(in srgb,var(--accent,#6366f1) 13%,transparent)}
                .wl-cc-prompt{display:grid;place-items:center;width:25px;height:25px;flex:0 0 auto;margin-top:.05rem;border-radius:8px;background:color-mix(in srgb,var(--accent,#6366f1) 14%,transparent);color:var(--accent,#818cf8);font-size:.76rem;font-weight:900}
                #wl-cc-input{display:block;flex:1;min-width:0;min-height:26px;max-height:144px;resize:none;overflow-y:auto;border:0;outline:0;background:transparent;color:var(--text-main,#f8fafc);font:600 .82rem/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;caret-color:var(--accent,#818cf8)}
                #wl-cc-input::placeholder{color:color-mix(in srgb,var(--text-muted,#94a3b8) 68%,transparent)}
                .wl-cc-run{display:inline-flex;align-items:center;gap:.42rem;min-height:34px;padding:.5rem .7rem;border:0;border-radius:11px;background:var(--accent,#6366f1);color:#fff;font-size:.7rem;font-weight:800;box-shadow:0 8px 20px color-mix(in srgb,var(--accent,#6366f1) 20%,transparent);transition:.16s ease}.wl-cc-run:hover{filter:brightness(1.08);transform:translateY(-1px)}.wl-cc-run svg{width:14px;height:14px}
                .wl-cc-tips{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-top:.58rem;padding:0 .2rem;color:var(--text-muted,#94a3b8);font-size:.64rem}.wl-cc-tips span{display:inline-flex;align-items:center;gap:.3rem}.wl-cc-tips kbd{padding:.16rem .32rem;border:1px solid var(--border,#334155);border-radius:5px;background:var(--bg-main,#020617);font:650 .58rem/1 Inter,system-ui}
                #wl-cc-suggestions{display:none;margin-top:.55rem;padding:.35rem;border:1px solid var(--border,#334155);border-radius:14px;background:color-mix(in srgb,var(--bg-card,#0f172a) 98%,transparent);box-shadow:0 18px 35px rgba(2,6,23,.22)}
                #wl-cc-suggestions[data-visible="1"]{display:block}
                .wl-cc-suggestion{display:flex;width:100%;align-items:center;justify-content:space-between;gap:1rem;padding:.58rem .66rem;border:0;border-radius:10px;background:transparent;color:var(--text-main,#fff);text-align:left}.wl-cc-suggestion:hover,.wl-cc-suggestion[data-active="1"]{background:var(--bg-hover,#1e293b)}
                .wl-cc-suggestion code{overflow:hidden;text-overflow:ellipsis;color:inherit;font:650 .69rem/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:nowrap}.wl-cc-suggestion small{flex:0 0 auto;color:var(--text-muted,#94a3b8);font-size:.61rem}
                #wl-cc-output{flex:1;min-height:170px;overflow:auto;padding:1rem 1.1rem 1.1rem;overscroll-behavior:contain}
                .wl-cc-welcome{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.65rem}.wl-cc-example{display:flex;flex-direction:column;gap:.38rem;min-height:76px;padding:.75rem;border:1px solid var(--border,#334155);border-radius:14px;background:color-mix(in srgb,var(--bg-main,#020617) 45%,transparent);color:var(--text-main,#fff);text-align:left;transition:.16s ease}.wl-cc-example:hover{border-color:color-mix(in srgb,var(--accent,#6366f1) 55%,var(--border,#334155));background:color-mix(in srgb,var(--accent,#6366f1) 7%,var(--bg-main,#020617));transform:translateY(-1px)}.wl-cc-example code{font:650 .67rem/1.45 ui-monospace,SFMono-Regular,Consolas,monospace}.wl-cc-example span{color:var(--text-muted,#94a3b8);font-size:.63rem;line-height:1.35}
                .wl-cc-output-head{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:.75rem}.wl-cc-output-head h3{font-size:.82rem;font-weight:800}.wl-cc-output-head p{margin-top:.22rem;color:var(--text-muted,#94a3b8);font-size:.66rem}.wl-cc-badges{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:.35rem}.wl-cc-badge{padding:.28rem .48rem;border-radius:999px;background:color-mix(in srgb,var(--accent,#6366f1) 12%,transparent);color:color-mix(in srgb,var(--accent,#818cf8) 80%,var(--text-main,#fff));font-size:.58rem;font-weight:800}
                .wl-cc-section{padding:.78rem .82rem;border:1px solid var(--border,#334155);border-radius:15px;background:color-mix(in srgb,var(--bg-main,#020617) 42%,transparent)}.wl-cc-section+.wl-cc-section{margin-top:.55rem}.wl-cc-section[data-tone="positive"]{border-color:color-mix(in srgb,#22c55e 28%,var(--border,#334155))}.wl-cc-section[data-tone="danger"]{border-color:color-mix(in srgb,#ef4444 38%,var(--border,#334155));background:color-mix(in srgb,#ef4444 5%,var(--bg-main,#020617))}.wl-cc-section h4{margin:0 0 .48rem;font-size:.71rem;font-weight:800}.wl-cc-section ul{display:grid;gap:.28rem;margin:0;padding:0;list-style:none}.wl-cc-section li{color:var(--text-muted,#94a3b8);font-size:.68rem;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
                .wl-cc-table-wrap{overflow:auto;margin-top:.3rem}.wl-cc-table{width:100%;border-collapse:collapse;font-size:.64rem;white-space:nowrap}.wl-cc-table th,.wl-cc-table td{padding:.48rem .52rem;border-bottom:1px solid color-mix(in srgb,var(--border,#334155) 72%,transparent);text-align:left}.wl-cc-table th{color:var(--text-muted,#94a3b8);font-size:.56rem;text-transform:uppercase;letter-spacing:.06em}.wl-cc-table td{max-width:260px;overflow:hidden;text-overflow:ellipsis}.wl-cc-table tr:last-child td{border-bottom:0}
                .wl-cc-error{padding:.9rem;border:1px solid color-mix(in srgb,#ef4444 45%,var(--border,#334155));border-radius:15px;background:color-mix(in srgb,#ef4444 7%,var(--bg-main,#020617))}.wl-cc-error strong{display:block;color:#f87171;font-size:.76rem}.wl-cc-error p{margin:.35rem 0 0;color:var(--text-muted,#94a3b8);font-size:.67rem;line-height:1.5}
                .wl-cc-apply{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.82rem 1.1rem;border-top:1px solid var(--border,#334155);background:color-mix(in srgb,var(--bg-card,#0f172a) 98%,transparent)}.wl-cc-apply[hidden]{display:none}.wl-cc-apply-copy strong{display:block;font-size:.7rem}.wl-cc-apply-copy span{display:block;margin-top:.18rem;color:var(--text-muted,#94a3b8);font-size:.61rem}.wl-cc-apply-actions{display:flex;align-items:center;gap:.45rem}.wl-cc-secondary,.wl-cc-primary{min-height:35px;padding:.52rem .78rem;border-radius:11px;font-size:.66rem;font-weight:800;transition:.16s ease}.wl-cc-secondary{border:1px solid var(--border,#334155);background:transparent;color:var(--text-muted,#94a3b8)}.wl-cc-secondary:hover{color:var(--text-main,#fff);background:var(--bg-hover,#1e293b)}.wl-cc-primary{border:0;background:var(--accent,#6366f1);color:#fff}.wl-cc-primary[data-danger="1"]{background:#dc2626}.wl-cc-primary:disabled{cursor:not-allowed;opacity:.4}.wl-cc-primary:not(:disabled):hover{filter:brightness(1.08);transform:translateY(-1px)}
                .wl-cc-check{display:flex;align-items:center;gap:.42rem;margin-top:.45rem;color:var(--text-muted,#94a3b8);font-size:.59rem}.wl-cc-check input{accent-color:#dc2626}
                .wl-cc-footer{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.55rem 1.1rem;border-top:1px solid color-mix(in srgb,var(--border,#334155) 70%,transparent);color:var(--text-muted,#94a3b8);font-size:.57rem}.wl-cc-footer button{border:0;background:transparent;color:inherit;font-weight:700}.wl-cc-footer button:hover{color:var(--text-main,#fff)}
                @keyframes wlCcFade{from{opacity:0}to{opacity:1}}@keyframes wlCcPop{from{opacity:0;transform:translateY(-10px) scale(.985)}to{opacity:1;transform:none}}
                @media(max-width:720px){#wl-command-trigger .wl-cc-trigger-label,#wl-command-trigger kbd{display:none}#wl-command-trigger{padding:.55rem}#wl-command-center{align-items:flex-end;padding:0}.wl-cc-dialog{width:100%;max-height:92dvh;border-radius:24px 24px 0 0}.wl-cc-welcome{grid-template-columns:1fr}.wl-cc-run span{display:none}.wl-cc-head{padding-top:.8rem}.wl-cc-tips span:last-child{display:none}.wl-cc-apply{align-items:flex-end}.wl-cc-apply-copy{min-width:0}.wl-cc-output{padding-bottom:max(1rem,env(safe-area-inset-bottom))}}
                @media(prefers-reduced-motion:reduce){.wl-cc-backdrop,.wl-cc-dialog{animation:none!important}}
            `;
            document.head.appendChild(style);
        },

        injectButton() {
            if ($('#wl-command-trigger')) return;
            const button = document.createElement('button');
            button.id = 'wl-command-trigger';
            button.type = 'button';
            button.title = 'Командный центр · Ctrl/⌘ + K';
            button.setAttribute('aria-label', 'Открыть командный центр');
            button.setAttribute('aria-haspopup', 'dialog');
            button.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 9l3 3-3 3m5 0h3M5 4h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z"/></svg><span class="wl-cc-trigger-label">Команды</span><kbd>Ctrl K</kbd>`;
            const settingsButton = document.querySelector('nav button[onclick*="openSettings"]');
            const actions = settingsButton?.parentElement;
            if (actions) actions.insertBefore(button, settingsButton);
            else {
                button.classList.add('wl-cc-fixed-trigger');
                document.body.appendChild(button);
            }
        },

        injectDialog() {
            if ($('#wl-command-center')) return;
            const root = document.createElement('div');
            root.id = 'wl-command-center';
            root.setAttribute('aria-hidden', 'true');
            root.innerHTML = `
                <div class="wl-cc-backdrop" data-wl-cc-close></div>
                <section class="wl-cc-dialog" role="dialog" aria-modal="true" aria-labelledby="wl-cc-title">
                    <header class="wl-cc-head">
                        <div class="wl-cc-brand"><div class="wl-cc-logo"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 9l3 3-3 3m5 0h3M5 4h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z"/></svg></div><div><div class="wl-cc-title" id="wl-cc-title">Command Center</div><div class="wl-cc-subtitle">Управляйте журналом одной понятной командой</div></div></div>
                        <button type="button" class="wl-cc-close" data-wl-cc-close aria-label="Закрыть"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg></button>
                    </header>
                    <div class="wl-cc-compose">
                        <div class="wl-cc-input-shell"><span class="wl-cc-prompt" aria-hidden="true">›</span><textarea id="wl-cc-input" rows="1" spellcheck="false" autocomplete="off" aria-label="Команда" aria-controls="wl-cc-suggestions" placeholder="Например: сделка добавить BTC long 60000 -> 62000 x3"></textarea><button type="button" class="wl-cc-run" id="wl-cc-run"><span>Preview</span><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14m-5-5l5 5-5 5"/></svg></button></div>
                        <div id="wl-cc-suggestions" role="listbox" aria-label="Подсказки"></div>
                        <div class="wl-cc-tips"><span><kbd>Enter</kbd> preview · <kbd>Shift Enter</kbd> новая строка</span><span><kbd>↑ ↓</kbd> подсказки · <kbd>Esc</kbd> закрыть</span></div>
                    </div>
                    <main id="wl-cc-output" aria-live="polite"></main>
                    <div class="wl-cc-apply" id="wl-cc-apply" hidden><div class="wl-cc-apply-copy"><strong id="wl-cc-apply-title">План готов</strong><span id="wl-cc-apply-note">Изменения ещё не внесены</span><label class="wl-cc-check" id="wl-cc-critical" hidden><input type="checkbox" id="wl-cc-critical-check"> Я понимаю, что это массовое удаление</label></div><div class="wl-cc-apply-actions"><button type="button" class="wl-cc-secondary" id="wl-cc-cancel">Отменить</button><button type="button" class="wl-cc-primary" id="wl-cc-commit">Применить</button></div></div>
                    <footer class="wl-cc-footer"><span>Без eval · пакетные изменения атомарны</span><span><button type="button" data-wl-command="история">История</button> · <button type="button" data-wl-command="помощь">Помощь</button></span></footer>
                </section>`;
            document.body.appendChild(root);
            this.renderWelcome();
        },

        bindEvents() {
            $('#wl-command-trigger')?.addEventListener('click', () => this.open());
            document.addEventListener('click', event => {
                if (event.target.closest('[data-wl-cc-close]')) this.close();
                const commandButton = event.target.closest('[data-wl-command]');
                if (commandButton) {
                    this.setInput(commandButton.dataset.wlCommand || '');
                    this.run();
                }
                const suggestion = event.target.closest('[data-wl-suggestion]');
                if (suggestion) this.acceptSuggestion(Number(suggestion.dataset.wlSuggestion));
                const example = event.target.closest('[data-wl-example]');
                if (example) {
                    this.setInput(example.dataset.wlExample || '');
                    $('#wl-cc-input')?.focus();
                    this.updateSuggestions();
                }
            });
            $('#wl-cc-run')?.addEventListener('click', () => this.run());
            $('#wl-cc-cancel')?.addEventListener('click', () => { this.pending = null; this.renderWelcome(); this.updateApplyBar(); });
            $('#wl-cc-commit')?.addEventListener('click', () => this.commit());
            $('#wl-cc-critical-check')?.addEventListener('change', () => this.updateCommitState());
            const input = $('#wl-cc-input');
            input?.addEventListener('input', () => {
                this.pending = null;
                this.historyIndex = -1;
                this.autoSizeInput();
                this.updateSuggestions();
                this.updateApplyBar();
            });
            input?.addEventListener('keydown', event => this.onInputKeydown(event));
            document.addEventListener('keydown', event => {
                if ((event.ctrlKey || event.metaKey) && lower(event.key) === 'k') {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    this.open();
                    return;
                }
                if (!this.opened) return;
                if (event.key === 'Escape') { event.preventDefault(); this.close(); }
                if (event.key === 'Tab' && !event.target.closest('#wl-cc-input')) this.keepFocus(event);
            }, true);
        },

        keepFocus(event) {
            const dialog = $('.wl-cc-dialog');
            if (!dialog) return;
            const focusable = Array.from(dialog.querySelectorAll('button:not(:disabled),textarea,input:not(:disabled)')).filter(node => node.offsetParent !== null);
            if (!focusable.length) return;
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        },

        onInputKeydown(event) {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                const suggestions = $('#wl-cc-suggestions');
                if (suggestions?.dataset.visible === '1' && !event.ctrlKey && !event.metaKey) {
                    const query = $('#wl-cc-input').value.trim();
                    if (query && !TEMPLATES.some(([command]) => command === query) && this._suggestions?.length) {
                        this.acceptSuggestion(this.suggestionIndex);
                        return;
                    }
                }
                this.run();
                return;
            }
            if (event.key === 'Tab' && this._suggestions?.length) {
                event.preventDefault();
                this.acceptSuggestion(this.suggestionIndex);
                return;
            }
            if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && this._suggestions?.length && !event.ctrlKey && !event.metaKey) {
                event.preventDefault();
                const delta = event.key === 'ArrowDown' ? 1 : -1;
                this.suggestionIndex = (this.suggestionIndex + delta + this._suggestions.length) % this._suggestions.length;
                this.paintSuggestionActive();
                return;
            }
            if ((event.ctrlKey || event.metaKey || !$('#wl-cc-input').value.trim()) && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                event.preventDefault();
                this.navigateHistory(event.key === 'ArrowUp' ? -1 : 1);
            }
        },

        open() {
            if (!this.mounted) this.mount();
            const root = $('#wl-command-center');
            if (!root) return;
            this.opened = true;
            root.dataset.open = '1';
            root.setAttribute('aria-hidden', 'false');
            document.body.classList.add('wl-cc-open');
            $('#wl-command-trigger')?.setAttribute('aria-expanded', 'true');
            global.setTimeout(() => $('#wl-cc-input')?.focus(), 20);
            this.updateSuggestions();
        },

        close() {
            const root = $('#wl-command-center');
            if (!root) return;
            this.opened = false;
            root.dataset.open = '0';
            root.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('wl-cc-open');
            $('#wl-command-trigger')?.setAttribute('aria-expanded', 'false');
            $('#wl-command-trigger')?.focus();
        },

        setInput(value) {
            const input = $('#wl-cc-input');
            if (!input) return;
            input.value = String(value).slice(0, MAX_INPUT);
            this.autoSizeInput();
        },

        autoSizeInput() {
            const input = $('#wl-cc-input');
            if (!input) return;
            input.style.height = 'auto';
            input.style.height = `${Math.min(144, Math.max(26, input.scrollHeight))}px`;
        },

        loadHistory() {
            try {
                const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
                this.history = Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(-MAX_HISTORY) : [];
            } catch (_) { this.history = []; }
        },

        saveHistory(command) {
            const value = String(command || '').trim();
            if (!value) return;
            this.history = this.history.filter(item => item !== value);
            this.history.push(value.slice(0, MAX_INPUT));
            if (this.history.length > MAX_HISTORY) this.history = this.history.slice(-MAX_HISTORY);
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
                    pool.push([`сессия открыть ${quoted}`, `Открыть · ${id}`]);
                    pool.push([`статистика показать ${quoted}`, 'Посмотреть метрики']);
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
            return section(`История · ${this.history.length}`, lines.length ? lines : ['История пока пуста.']);
        },

        renderWelcome() {
            const output = $('#wl-cc-output');
            if (!output) return;
            output.replaceChildren();
            const head = document.createElement('div');
            head.className = 'wl-cc-output-head';
            const copy = document.createElement('div');
            const title = document.createElement('h3'); title.textContent = 'Начните с готовой команды';
            const note = document.createElement('p'); note.textContent = 'Русский и English можно свободно смешивать';
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
            title.textContent = plan.meta.mutations ? 'Preview изменений' : 'Результат';
            const note = document.createElement('p');
            note.textContent = `${plan.commandCount} команд · ${plan.meta.mutations} изменений${plan.meta.addedTrades ? ` · +${plan.meta.addedTrades} сделок` : ''}`;
            copy.append(title, note);
            const badges = document.createElement('div'); badges.className = 'wl-cc-badges';
            const badgeTexts = [];
            if (plan.commandCount > 1) badgeTexts.push('Atomic batch');
            if (plan.dryRun) badgeTexts.push('Dry run');
            if (plan.meta.danger) badgeTexts.push('Опасная операция');
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
            const title = document.createElement('strong'); title.textContent = error instanceof CommandError ? error.message : 'Команда не выполнена';
            block.append(title);
            const note = document.createElement('p');
            note.textContent = error instanceof CommandError && error.hint ? error.hint : error instanceof CommandError ? 'Введите «помощь», чтобы увидеть примеры.' : 'Данные не менялись. Попробуйте ещё раз или откройте справку.';
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
            title.textContent = plan.dryRun ? 'Dry run завершён' : plan.meta.danger ? 'Нужно подтверждение' : 'План готов к применению';
            if (plan.dryRun) note.textContent = 'Режим --dry-run: применение отключено';
            else if (plan.meta.danger && !plan.confirmed) note.textContent = 'Добавьте --confirm в команду и запустите preview снова';
            else note.textContent = `Будет применено атомарно: ${plan.meta.mutations} изменений`;
            critical.hidden = !plan.meta.critical || plan.dryRun || !plan.confirmed;
            if (check) check.checked = false;
            button.dataset.danger = plan.meta.danger ? '1' : '0';
            button.textContent = plan.meta.danger ? 'Подтвердить' : 'Применить';
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
                this.renderError(new CommandError('Данные изменились после preview', 'Запустите команду ещё раз — старый план безопасно отменён.'));
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
                this.renderError(new CommandError('Не удалось применить пакет', 'Все изменения были отменены. Проверьте доступность локального хранилища.'));
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
            const title = document.createElement('h3'); title.textContent = 'Готово';
            const note = document.createElement('p'); note.textContent = `Атомарно применено изменений: ${plan.meta.mutations}`;
            copy.append(title, note); head.append(copy); output.append(head);
            this.renderSection(output, section('Команда выполнена', [
                plan.meta.addedTrades ? `Добавлено сделок: ${plan.meta.addedTrades}` : 'Данные сохранены.',
                'Изменения уже отражены в журнале.'
            ], { tone: 'positive' }));
            this.app.showToast?.(plan.meta.addedTrades ? `Добавлено сделок: ${plan.meta.addedTrades}` : 'Команда выполнена');
        }
    };

    // Small public surface for integration tests and other optional modules.
    CommandCenter.version = VERSION;
    CommandCenter.tokenize = tokenizeProgram;
    CommandCenter.parse = function (source) {
        if (!this.app) throw new CommandError('Command Center ещё не подключён к приложению');
        return parseProgram(source, this.app, this.currentEnhConfig());
    };
    CommandCenter.execute = function (source) { this.open(); this.run(source); };
    global.weeloserCommandConsole = CommandCenter;

    const boot = () => global.setTimeout(() => CommandCenter.mount(), 0);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
})(window);
