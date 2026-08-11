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

export function getLevel(): LogLevel {
    return Memory.logLevel || 'info';
}

export function setLevel(level: LogLevel): void {
    Memory.logLevel = level;
}

function shouldEmit(level: LogLevel): boolean {
    if (level === 'error' || level === 'warn' || level === 'info') {
        return true;
    }

    if (!Memory.debug) {
        return false;
    }

    return LEVELS[level] <= LEVELS[getLevel()];
}

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

function emit(level: LogLevel, scope: string, msg: string, data?: unknown): void {
    if (!shouldEmit(level)) {
        return;
    }

    console.log(format(scope, level, msg, data));

    if (level === 'error' || level === 'warn') {
        notifyOnce(scope, level, msg);
    }
}

export function error(scope: string, msg: string, data?: unknown): void {
    emit('error', scope, msg, data);
}

export function warn(scope: string, msg: string, data?: unknown): void {
    emit('warn', scope, msg, data);
}

export function info(scope: string, msg: string, data?: unknown): void {
    emit('info', scope, msg, data);
}

export function debug(scope: string, msg: string, data?: unknown): void {
    emit('debug', scope, msg, data);
}

export function trace(scope: string, msg: string, data?: unknown): void {
    emit('trace', scope, msg, data);
}
