/* ============================================================================
 * Структурированное логгирование.
 *
 * Уровни: error < warn < info < debug < trace.
 *
 * Поведение:
 *   - error и warn эмитятся всегда.
 *   - info эмитится всегда.
 *   - debug и trace — только при Memory.debug === true.
 *   - warn и error дополнительно отправляются в Game.notify с дедупликацией
 *     (Memory._notified, TTL = NOTIFY_DEDUP_TTL тиков), чтобы не спамить
 *     в почту при повторяющихся ошибках.
 *
 * Уровень по умолчанию читается из Memory.logLevel; если не задан — 'info'.
 *
 * Формат: [<tick>] [<LEVEL>] [<scope>] <msg> [JSON.stringify(data)].
 * ==========================================================================*/

const LEVELS: Record<LogLevel, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
    trace: 4
};

const NOTIFY_DEDUP_TTL = 500;
const NOTIFY_MAX_ENTRIES = 200;

/**
 * Возвращает текущий глобальный уровень логгирования.
 * Если `Memory.logLevel` не задан, возвращает `'info'`.
 */
export function getLevel(): LogLevel {
    return Memory.logLevel || 'info';
}

/**
 * Устанавливает глобальный уровень логгирования, сохраняя его в `Memory.logLevel`.
 *
 * @param level Один из уровней `LogLevel`. Более высокие по номеру уровни
 *              (`debug`, `trace`) не будут эмититься, если `Memory.debug !== true`.
 */
export function setLevel(level: LogLevel): void {
    Memory.logLevel = level;
}

/**
 * Проверяет, должен ли уровень `level` быть эмитирован с учётом текущего
 * режима (`Memory.debug`) и установленного порога (`getLevel`).
 *
 * @remarks
 * `error`/`warn`/`info` эмитятся всегда; `debug`/`trace` — только при
 * `Memory.debug === true` и при этом не выше текущего порога.
 */
function shouldEmit(level: LogLevel): boolean {
    if (level === 'error' || level === 'warn' || level === 'info') {
        return true;
    }

    if (!Memory.debug) {
        return false;
    }

    return LEVELS[level] <= LEVELS[getLevel()];
}

/**
 * Форматирует строку лога заданного вида: `[<tick>] [<LEVEL>] [<scope>] <msg>`
 * с опциональным JSON-дампом `data` (или `[unserializable data]`, если объект
 * не сериализуется).
 */
function format(scope: string, level: LogLevel, msg: string, data: unknown): string {
    const base = `[${Game.time}] [${level.toUpperCase()}] [${scope}] ${msg}`;

    if (data === undefined) {
        return base;
    }

    try {
        return `${base} ${JSON.stringify(data)}`;
    } catch {
        return `${base} [unserializable data]`;
    }
}

/**
 * Отправляет событие в `Game.notify` не чаще одного раза в `NOTIFY_DEDUP_TTL`
 * тиков для одного ключа `level|scope|msg`. При переполнении кэша
 * `Memory._notified` сверх `NOTIFY_MAX_ENTRIES` записи старше TTL удаляются.
 */
function notifyOnce(scope: string, level: LogLevel, msg: string): void {
    if (typeof Game.notify !== 'function') {
        return;
    }

    if (!Memory._notified) {
        Memory._notified = {};
    }

    const key = `${level}|${scope}|${msg}`;
    const lastTick = Memory._notified[key];

    if (lastTick !== undefined && Game.time - lastTick < NOTIFY_DEDUP_TTL) {
        return;
    }

    Memory._notified[key] = Game.time;

    if (Object.keys(Memory._notified).length > NOTIFY_MAX_ENTRIES) {
        const cutoff = Game.time - NOTIFY_DEDUP_TTL;

        for (const k in Memory._notified) {
            if ((Memory._notified[k] ?? 0) < cutoff) {
                delete Memory._notified[k];
            }
        }
    }

    Game.notify(`[${level}] ${scope}: ${msg}`, NOTIFY_DEDUP_TTL);
}

/**
 * Внутренний эмиттер: применяет фильтр `shouldEmit`, печатает строку в
 * консоль и, для `error`/`warn`, дополнительно отправляет уведомление
 * через `notifyOnce`.
 */
function emit(level: LogLevel, scope: string, msg: string, data?: unknown): void {
    if (!shouldEmit(level)) {
        return;
    }

    console.log(format(scope, level, msg, data));

    if (level === 'error' || level === 'warn') {
        notifyOnce(scope, level, msg);
    }
}

/**
 * Логирует сообщение уровня `error` (эмитится всегда, дополнительно уходит в `Game.notify`).
 *
 * @param scope Метка модуля/подсистемы (используется в формате и дедупликации).
 * @param msg   Текст сообщения.
 * @param data  Опциональный контекст: объект сериализуется в JSON и добавляется к строке.
 */
export function error(scope: string, msg: string, data?: unknown): void {
    emit('error', scope, msg, data);
}

/**
 * Логирует сообщение уровня `warn` (эмитится всегда, дополнительно уходит в `Game.notify`).
 *
 * @param scope Метка модуля/подсистемы.
 * @param msg   Текст сообщения.
 * @param data  Опциональный контекст для JSON-дaмпа.
 */
export function warn(scope: string, msg: string, data?: unknown): void {
    emit('warn', scope, msg, data);
}

/**
 * Логирует сообщение уровня `info` (эмитится всегда, но не уходит в `Game.notify`).
 */
export function info(scope: string, msg: string, data?: unknown): void {
    emit('info', scope, msg, data);
}

/**
 * Логирует сообщение уровня `debug`. Эмитится только при `Memory.debug === true`
 * и не выше текущего установленного порога.
 */
export function debug(scope: string, msg: string, data?: unknown): void {
    emit('debug', scope, msg, data);
}

/**
 * Логирует сообщение уровня `trace`. Эмитится только при `Memory.debug === true`
 * и только если порог >= `trace`.
 */
export function trace(scope: string, msg: string, data?: unknown): void {
    emit('trace', scope, msg, data);
}
