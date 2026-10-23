#!/usr/bin/env node
/**
 * Screeps Watchdog — внешний сторож аккаунта.
 *
 * Зачем он нужен
 * --------------
 * Скрипт игрока в Screeps выполняется только для «активных» аккаунтов:
 * активность определяется наличием комнаты или крипа. Как только у аккаунта
 * не остаётся ни комнаты, ни крипа, движок перестаёт запускать код —
 * `Memory` замораживается, `Memory.metrics.ticks` перестаёт расти, и бот
 * больше не может ничего сделать: ни заспавнить крипа (нужен спавн),
 * ни подать заявку на комнату (нужен крип).
 *
 * Типичный сценарий потери аккаунта:
 *   1. Игрок нажимает «Respawn» в игре (или комнату захватили).
 *      Сервер обнуляет принадлежность к комнатам → `world-status` = `empty`
 *      («респавн прошёл, спавн ещё не поставлен»).
 *   2. Игрок не ставит спавн (закрыл игру / не понял, что произошло).
 *   3. Аккаунт остаётся в статусе `empty` неограниченно долго: скрипт не
 *      запускается, уведомление пришло один раз и всё.
 *
 * Именно так выглядела остановка 25.09–23.10.2026: аккаунт `katarsin`
 * (GCL 118408) провисел 28 суток в статусе `empty`, бот не отработал ни
 * одного тика, а починить это мог только внешний процесс.
 *
 * Что делает этот скрипт
 * ----------------------
 *   • `world-status` = `normal` → всё в порядке, выходим.
 *   • `world-status` = `lost`    → `POST /api/user/respawn`, ждём
 *     `respawnPenalty` + 5 с и продолжаем как в случае `empty`.
 *   • `world-status` = `empty`    → подбираем комнату со свободным
 *     контроллером и ставим спавн: `POST /api/game/place-spawn`.
 *
 * Скрипт не зависит от npm-пакетов (только глобальный `fetch` из Node 18+),
 * поэтому его можно запускать и в GitHub Actions, и по cron.
 *
 * Использование
 * -------------
 *   SCREEPS_TOKEN=<токен> node tools/screeps-watchdog.mjs           # проверить и починить
 *   SCREEPS_TOKEN=<токен> node tools/screeps-watchdog.mjs --check   # только диагностика
 *   SCREEPS_TOKEN=<токен> node tools/screeps-watchdog.mjs --json    # машинный вывод
 *
 * Коды возврата: 0 — всё в порядке (или починили), 1 — не удалось починить,
 * 2 — аккаунт в неизвестном статусе.
 */

/* eslint-disable no-console */

const HOST = process.env.SCREEPS_HOST || 'https://screeps.com';
const TOKEN = process.env.SCREEPS_TOKEN || '';

/** Режим: только диагностика, без изменения состояния аккаунта. */
const CHECK_ONLY = process.argv.includes('--check');
/** Режим: машинно-читаемый вывод вместо человекочитаемого лога. */
const AS_JSON = process.argv.includes('--json');

/** Радиус кольца соседних комнат, которые тоже пробуем при выборе комнаты. */
const NEIGHBOUR_RADIUS = 2;

/** Имя спавна, который ставим при восстановлении. */
const SPAWN_NAME = 'Spawn1';

/** Таймаут HTTP-запроса, мс. */
const HTTP_TIMEOUT_MS = 30_000;

/** Разбор координатного суффикса комнаты: `E34S53` → `{ x: 34, y: 53 }`. */
const ROOM_COORD_RE = /^([WE])(\d+)([NS])(\d+)$/;

/**
 * Класс ошибки API Screeps: сервер вернул `{ error: "..." }`.
 */
class ScreepsApiError extends Error {
    /** @param {string} message Текст ошибки от сервера. */
    constructor(message) {
        super(message);
        this.name = 'ScreepsApiError';
    }
}

/**
 * Выполняет HTTP-запрос к API Screeps.
 *
 * @param {string} path Путь относительно хоста, например `/api/user/world-status`.
 * @param {object} [options] Опции запроса.
 * @param {string} [options.method] HTTP-метод, по умолчанию `GET`.
 * @param {object} [options.body] JSON-тело запроса.
 * @returns {Promise<object>} Разобранный JSON-ответ.
 * @throws {ScreepsApiError} Если сервер вернул `{ error: ... }` или не-JSON.
 */
async function api(path, options = {}) {
    const { method = 'GET', body } = options;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

    let response;

    try {
        response = await fetch(`${HOST}${path}`, {
            method,
            signal: controller.signal,
            headers: {
                'X-Token': TOKEN,
                'Content-Type': 'application/json'
            },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
    } finally {
        clearTimeout(timer);
    }

    const text = await response.text();
    let payload;

    try {
        payload = JSON.parse(text);
    } catch {
        throw new ScreepsApiError(`non-JSON response (${response.status}): ${text.slice(0, 200)}`);
    }

    if (payload && payload.error) {
        throw new ScreepsApiError(String(payload.error));
    }

    return payload;
}

/**
 * Печатает строку статуса. В JSON-режиме ничего не печатает.
 *
 * @param {string} message Текст.
 * @param {object} [extra] Дополнительные поля для JSON-вывода.
 */
function report(message, extra) {
    if (AS_JSON) {
        return;
    }

    console.log(`[watchdog] ${message}`);

    if (extra) {
        console.log(`[watchdog]   ${JSON.stringify(extra)}`);
    }
}

/**
 * Возвращает текущий статус аккаунта в мире.
 *
 * @returns {Promise<'normal'|'lost'|'empty'|string>} Статус.
 */
async function worldStatus() {
    const payload = await api('/api/user/world-status');
    return String(payload.status);
}

/**
 * Возвращает список комнат, предложенных сервером для старта/респавна.
 *
 * @returns {Promise<Array<{shard: string, room: string}>>} Комнаты.
 */
async function worldStartRooms() {
    const payload = await api('/api/user/world-start-room');
    const rooms = Array.isArray(payload.room) ? payload.room : [];

    return rooms
        .map((entry) => {
            const [shard, room] = String(entry).split('/');
            return room ? { shard, room } : null;
        })
        .filter(Boolean);
}

/**
 * Разбирает имя комнаты в координатный суффикс.
 *
 * @param {string} room Имя комнаты, например `E34S53`.
 * @returns {{x: number, y: number}|null} Координаты или `null`.
 */
function roomCoords(room) {
    const match = ROOM_COORD_RE.exec(room);
    return match ? { x: Number(match[2]), y: Number(match[4]) } : null;
}

/**
 * Формирует список комнат-кандидатов: предложенные сервером и их соседи.
 *
 * @param {Array<{shard: string, room: string}>} startRooms Стартовые комнаты.
 * @returns {Array<{shard: string, room: string}>} Кандидаты (уникальные).
 */
function candidateRooms(startRooms) {
    const result = [];
    const seen = new Set();

    const push = (shard, room) => {
        const key = `${shard}/${room}`;
        if (!seen.has(key)) {
            seen.add(key);
            result.push({ shard, room });
        }
    };

    for (const start of startRooms) {
        push(start.shard, start.room);

        const coords = roomCoords(start.room);
        if (!coords) {
            continue;
        }

        for (let dx = -NEIGHBOUR_RADIUS; dx <= NEIGHBOUR_RADIUS; dx++) {
            for (let dy = -NEIGHBOUR_RADIUS; dy <= NEIGHBOUR_RADIUS; dy++) {
                const x = coords.x + dx;
                const y = coords.y + dy;
                if (x < 1 || x > 90 || y < 1 || y > 90) {
                    continue;
                }
                push(start.shard, `${start.room[0]}${x}${start.room[3]}${y}`);
            }
        }
    }

    return result;
}

/**
 * Возвращает объекты комнаты.
 *
 * @param {string} room Имя комнаты.
 * @param {string} shard Имя шарда.
 * @returns {Promise<object[]>} Объекты комнаты.
 */
async function roomObjects(room, shard) {
    const payload = await api(`/api/game/room-objects?room=${room}&shard=${shard}`);
    return Array.isArray(payload.objects) ? payload.objects : [];
}

/**
 * Возвращает карту рельефа комнаты: занятые клетки и их тип.
 *
 * @param {string} room Имя комнаты.
 * @param {string} shard Имя шарда.
 * @returns {Promise<Map<string, string>>} Клетка → тип рельефа.
 */
async function roomTerrain(room, shard) {
    const payload = await api(`/api/game/room-terrain?room=${room}&shard=${shard}`);
    const tiles = new Map();
    const list = Array.isArray(payload.terrain) ? payload.terrain : [];

    for (const tile of list) {
        if (typeof tile === 'object' && typeof tile.x === 'number') {
            tiles.set(`${tile.x},${tile.y}`, tile.type);
            continue;
        }

        // Закодированный вид: одна строка на 2500 клеток.
        if (typeof tile?.terrain === 'string') {
            const codes = tile.terrain;
            for (let i = 0; i < codes.length; i++) {
                const type = TERRAIN_BY_CODE[codes[i]];
                if (type) {
                    tiles.set(`${i % 50},${Math.floor(i / 50)}`, type);
                }
            }
        }
    }

    return tiles;
}

/** Соответствие символов закодированного рельефа его названиям. */
const TERRAIN_BY_CODE = {
    '1': 'wall',
    '2': 'swamp',
    '3': 'road',
    '4': 'exit',
    '5': 'wall2',
    '6': 'wall3'
};

/**
 * Проверяет, что в комнате есть свободный контроллер (уровень 0, без владельца
 * и без резервации) — только такой контроллер можно «забрать» при place-spawn.
 *
 * @param {object[]} objects Объекты комнаты.
 * @returns {object|null} Контроллер или `null`.
 */
function freeController(objects) {
    const controller = objects.find((o) => o.type === 'controller');

    if (!controller) {
        return null;
    }

    if (controller.level !== 0 || controller.user || controller.reservation) {
        return null;
    }

    return controller;
}

/**
 * Выбирает позицию для спавна.
 *
 * Требования сервера: клетка в пределах [1..48]×[1..48], не стена, не занята
 * объектом, не ближе двух клеток к выходу из комнаты.
 *
 * Дополнительно оптимизируем под колонию: рядом должен быть источник (чтобы
 * харвестер быстро возил энергию) и контроллер (чтобы апгрейдер не таскал
 * энергию через полкомнаты), а вокруг должно быть место под extensions.
 *
 * @param {Map<string, string>} terrain Рельеф комнаты.
 * @param {object[]} objects Объекты комнаты.
 * @param {object} controller Контроллер комнаты.
 * @returns {{x: number, y: number}|null} Позиция или `null`.
 */
function pickSpawnPosition(terrain, objects, controller) {
    const sources = objects
        .filter((o) => o.type === 'source' || o.type === 'mineral')
        .map((o) => ({ x: o.x, y: o.y }));
    const occupied = new Set(
        objects
            .filter((o) => o.type !== 'source' && o.type !== 'mineral')
            .map((o) => `${o.x},${o.y}`)
    );

    const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    const isFree = (x, y) => {
        const key = `${x},${y}`;
        if (occupied.has(key)) {
            return false;
        }
        const type = terrain.get(key);
        return type === undefined || type === 'plain' || type === 'road';
    };

    const candidates = [];

    for (let x = 1; x <= 48; x++) {
        for (let y = 1; y <= 48; y++) {
            if (!isFree(x, y)) {
                continue;
            }

            // Спавн не должен стоять вплотную к выходу из комнаты.
            let nearExit = false;
            for (let dx = -2; dx <= 2 && !nearExit; dx++) {
                for (let dy = -2; dy <= 2 && !nearExit; dy++) {
                    const type = terrain.get(`${x + dx},${y + dy}`);
                    if (type === 'exit') {
                        nearExit = true;
                    }
                }
            }

            if (nearExit) {
                continue;
            }

            const pos = { x, y };

            // К источнику — не ближе двух клеток: иначе харвестеру негде встать.
            const sourceDist = sources.length
                ? Math.min(...sources.map((s) => chebyshev(pos, s)))
                : 6;
            if (sourceDist < 2) {
                continue;
            }

            const controllerDist = chebyshev(pos, controller);

            // Свободных клеток в кольце 2..6 — потенциальные места под extensions.
            let freeRing = 0;
            for (let dx = -6; dx <= 6; dx++) {
                for (let dy = -6; dy <= 6; dy++) {
                    const dist = Math.max(Math.abs(dx), Math.abs(dy));
                    if (dist < 2 || dist > 6) {
                        continue;
                    }
                    if (isFree(x + dx, y + dy)) {
                        freeRing++;
                    }
                }
            }

            candidates.push({
                x,
                y,
                sourceDist,
                controllerDist,
                freeRing,
                score:
                    40 / (1 + sourceDist) +
                    25 / (1 + controllerDist) +
                    freeRing / 20
            });
        }
    }

    if (!candidates.length) {
        return null;
    }

    // Две ступени отбора: сначала держим базу компактной (источник рядом,
    // контроллер не слишком далеко, есть место под extensions), при неудаче —
    // ослабляем ограничения.
    for (const limits of [
        { maxSource: 8, maxController: 12, minFreeRing: 40 },
        { maxSource: 14, maxController: 20, minFreeRing: 25 }
    ]) {
        const filtered = candidates.filter(
            (c) =>
                c.sourceDist <= limits.maxSource &&
                c.controllerDist <= limits.maxController &&
                c.freeRing >= limits.minFreeRing
        );

        if (!filtered.length) {
            continue;
        }

        filtered.sort((a, b) => b.score - a.score);
        return filtered[0];
    }

    return null;
}

/**
 * Ставит спавн в первую подходящую комнату.
 *
 * @param {Array<{shard: string, room: string}>} startRooms Стартовые комнаты.
 * @returns {Promise<object|null} Результат или `null`, если не вышло.
 */
async function placeSpawn(startRooms) {
    const candidates = candidateRooms(startRooms);
    const failures = [];

    for (const candidate of candidates) {
        let objects;

        try {
            objects = await roomObjects(candidate.room, candidate.shard);
        } catch (error) {
            failures.push(`${candidate.room}: ${error.message}`);
            continue;
        }

        const controller = freeController(objects);

        if (!controller) {
            failures.push(`${candidate.room}: нет свободного контроллера`);
            continue;
        }

        let terrain;

        try {
            terrain = await roomTerrain(candidate.room, candidate.shard);
        } catch (error) {
            failures.push(`${candidate.room}: рельеф недоступен (${error.message})`);
            continue;
        }

        const position = pickSpawnPosition(terrain, objects, controller);

        if (!position) {
            failures.push(`${candidate.room}: не найдено подходящее место для спавна`);
            continue;
        }

        report(
            `ставлю спавн в ${candidate.shard}/${candidate.room} @ (${position.x},${position.y}) ` +
            `(источник ~${position.sourceDist}, контроллер ~${position.controllerDist}, ` +
            `свободно в кольце 2..6: ${position.freeRing})`
        );

        try {
            await api('/api/game/place-spawn', {
                method: 'POST',
                body: {
                    room: candidate.room,
                    name: SPAWN_NAME,
                    x: position.x,
                    y: position.y,
                    shard: candidate.shard
                }
            });
        } catch (error) {
            failures.push(`${candidate.room}: ${error.message}`);
            continue;
        }

        return { ...candidate, position };
    }

    if (!AS_JSON) {
        console.log('[watchdog] не удалось поставить спавн:');
        for (const failure of failures.slice(0, 10)) {
            console.log(`[watchdog]   - ${failure}`);
        }
    }

    return null;
}

/**
 * Основной сценарий: проверяет статус и (если нужно) восстанавливает аккаунт.
 *
 * @returns {Promise<number>} Код возврата.
 */
async function main() {
    if (!TOKEN) {
        console.error('[watchdog] не задан SCREEPS_TOKEN');
        return 1;
    }

    let status;

    try {
        status = await worldStatus();
    } catch (error) {
        console.error(`[watchdog] не удалось получить world-status: ${error.message}`);
        return 1;
    }

    report(`world-status = ${status}`);

    if (status === 'normal') {
        if (AS_JSON) {
            console.log(JSON.stringify({ ok: true, status, action: 'none' }));
        }
        return 0;
    }

    if (status === 'lost') {
        report('комнаты потеряны — запрашиваю респавн');

        if (CHECK_ONLY) {
            return 0;
        }

        try {
            await api('/api/user/respawn', { method: 'POST' });
        } catch (error) {
            console.error(`[watchdog] респавн не выполнен: ${error.message}`);
            return 1;
        }

        // Серверу нужно время на применение респавна (respawnPenalty, 180 с).
        const penalty = 180_000;
        report(`жду ${Math.round(penalty / 1000) + 5} с, пока сервер применит респавн`);
        await new Promise((resolve) => setTimeout(resolve, penalty + 5_000));

        try {
            status = await worldStatus();
            report(`world-status после респавна = ${status}`);
        } catch (error) {
            console.error(`[watchdog] не удалось перепроверить статус: ${error.message}`);
            return 1;
        }

        if (status === 'normal') {
            if (AS_JSON) {
                console.log(JSON.stringify({ ok: true, status, action: 'respawned' }));
            }
            return 0;
        }
    }

    if (status !== 'empty') {
        console.error(`[watchdog] неожиданный статус: ${status}`);
        return 2;
    }

    // Статус `empty`: аккаунт респавнился, но спавн так и не поставили.
    // Именно этот статус означает, что скрипт игрока не запускается вовсе.
    report('аккаунт без спавна — ставлю спавн');

    if (CHECK_ONLY) {
        if (AS_JSON) {
            console.log(JSON.stringify({ ok: true, status, action: 'check-only' }));
        }
        return 0;
    }

    let startRooms = [];

    try {
        startRooms = await worldStartRooms();
    } catch (error) {
        console.error(`[watchdog] не удалось получить world-start-room: ${error.message}`);
        return 1;
    }

    if (!startRooms.length) {
        console.error('[watchdog] сервер не предложил ни одной комнаты для старта');
        return 1;
    }

    report(`комнаты-кандидаты: ${startRooms.map((r) => `${r.shard}/${r.room}`).join(', ')}`);

    const placed = await placeSpawn(startRooms);

    if (!placed) {
        if (AS_JSON) {
            console.log(JSON.stringify({ ok: false, status, action: 'failed' }));
        }
        return 1;
    }

    report(`спавн ${SPAWN_NAME} поставлен в ${placed.shard}/${placed.room}`);

    if (AS_JSON) {
        console.log(
            JSON.stringify({
                ok: true,
                status: 'normal',
                action: 'spawn-placed',
                room: placed.room,
                shard: placed.shard,
                x: placed.position.x,
                y: placed.position.y
            })
        );
    }

    return 0;
}

main()
    .then((code) => {
        process.exitCode = code;
    })
    .catch((error) => {
        console.error(`[watchdog] непойманная ошибка: ${error && error.stack ? error.stack : error}`);
        process.exitCode = 1;
    });
