/* ============================================================================
 * Точка входа Screeps.
 *
 * Экспортирует функцию `loop()`, которую движок Screeps вызывает каждый тик.
 * Содержит только оркестрацию верхнего уровня и не выполняет никаких
 * стратегических решений (они делегированы в `room.ts`, `expansion.ts`,
 * `metrics.ts`, `utils/pixels.ts`).
 * ==========================================================================*/

import * as room from './room';
import * as expansion from './expansion';
import * as metrics from './metrics';
import * as pixels from './utils/pixels';
import * as log from './log';

console.log("Started script at", new Date().toISOString())

/**
 * Ключи `Memory`, которые бот считает своими.
 *
 * @remarks
 * Всё, чего в этом списке нет, при очистке отладочного мусора удаляется
 * только если попадает под {@link DEBUG_MEMORY_KEYS}. Список — страховка:
 * чистка не должна съесть ничего, чем бот пользуется.
 */
const MEMORY_KEYS_OWNED = new Set<string>([
    'targetRoom',
    'expansionBlacklist',
    'expansionPreferredTarget',
    'debug',
    'logLevel',
    '_knownSpawnIds',
    '_exitsCache',
    '_notified',
    '_debugKeysPurged',
    'metrics',
    'rooms',
    'creeps'
]);

/**
 * Отладочные ключи `Memory`, оставшиеся от ручной отладки.
 *
 * @remarks
 * Каждый такой ключ движок сериализует в память и разбирает обратно на
 * каждом тике. В E34S53 к 27.11.2026 в `Memory` накопилось 130 таких ключей
 * (`_pA`, `__d_h5`, `_tr`, `_inc`, `_map` и прочие) — больше, чем весит вся
 * остальная память бота. Они никем не читаются (проверено поиском по
 * `src/`), но каждую тик оплачиваются разбором и хранением.
 *
 * Имена отладочных ключей менялись от сессии к сессии, поэтому шаблон
 * закрывает семейства: `_p*`, `_probe*`, `__p*`, `__probe*`, `__d_*`,
 * `__rate*`, `_tr*`, `_zz*` и ещё несколько одиночных.
 */
const DEBUG_MEMORY_KEYS =
    /^_{1,2}(p[A-Za-z0-9]*|probe[A-Za-z0-9]*|d_[a-z0-9]+|rate[A-Za-z0-9]*|tr[a-z]*|zz[0-9]*|inc|m2|f|z|map|api[0-9]*|v[0-9]|done|trace|srcTrace|repair)$/;

/**
 * Одноразовая чистка отладочных ключей из `Memory`.
 *
 * @remarks
 * Чистка выполняется один раз: после неё выставляется
 * `Memory._debugKeysPurged`, и на следующих тиках функция выходит сразу.
 * Стоит это один вызов `for…in` по `Memory` за всё время жизни скрипта.
 */
function purgeDebugMemoryKeys(): void {
    if (Memory._debugKeysPurged) {
        return;
    }

    Memory._debugKeysPurged = true;

    let removed = 0;

    for (const key in Memory) {
        if (MEMORY_KEYS_OWNED.has(key)) {
            continue;
        }

        if (!DEBUG_MEMORY_KEYS.test(key)) {
            continue;
        }

        delete (Memory as unknown as Record<string, unknown>)[key];
        removed++;
    }

    if (removed > 0) {
        log.info('main', `purged ${removed} stale debug key(s) from Memory`);
    }
}


/**
 * Главная функция тика. Контракт с движком Screeps:
 * вызывается каждый тик, должна вернуть управление до окончания бюджета CPU.
 *
 * Алгоритм:
 * 1. `metrics.tickStart()` — засечь `Game.cpu.getUsed()`.
 * 2. `metrics.init()` — инициализировать глобальные/per-room счётчики.
 * 3. Очистить `Memory.creeps` от мёртвых крипов.
 * 4. Проставить `memory.homeRoom` крипам, у которых его нет.
 * 5. Собрать owned-комнаты (с `controller.my`).
 * 6. Если owned-комнат нет — залогировать `warn` (с дедупликацией через
 *    `log.notifyOnce`) для оповещения пользователя о простое, `metrics.tickEnd()` и выход.
 * 7. Для каждой owned-комнаты вызвать `room.run(r)`.
 * 8. `expansion.run()` — попытка одного шага экспансии.
 * 9. `pixels.generatePixel()` — выпустить пиксели при достаточном bucket.
 * 10. `metrics.tickEnd()` — посчитать длительность тика и обновить счётчики.
 */
export function loop(): void {
    metrics.tickStart();
    metrics.init();

    // Одноразовая чистка отладочных ключей из `Memory` (см.
    // `purgeDebugMemoryKeys`): они не читаются никем, но движок сериализует
    // и разбирает их каждый тик.
    purgeDebugMemoryKeys();

    for (const name in Memory.creeps) {
        const mem = Memory.creeps[name];
        if (!Game.creeps[name] && mem) {
            const age = Game.time - (mem._birthTick || Game.time);
            metrics.recordCreepDeath(mem.role, age);
            delete Memory.creeps[name];
        }
    }

    for (const name in Game.creeps) {
        const creep = Game.creeps[name];

        if (!creep) {
            continue;
        }

        if (!creep.memory.homeRoom) {
            creep.memory.homeRoom = creep.room.name;
        }

        if (creep.memory._birthTick === undefined) {
            creep.memory._birthTick = Game.time;
        }
    }

    // Чистим устаревшие записи `Memory.rooms`, для которых в `Game.rooms`
    // нет живой `Room` и ни один крип не считает её своей home. Без этой
    // чистки старые комнаты (например, потерянный home) накапливаются и
    // ежегодно сериализуются/парсятся впустую.
    for (const roomName in Memory.rooms) {
        if (Game.rooms[roomName]) {
            continue;
        }
        const hasCreepWithHome = Object.values(Game.creeps).some(
            (c) => c && c.memory && c.memory.homeRoom === roomName
        );
        if (!hasCreepWithHome) {
            delete Memory.rooms[roomName];
        }
    }

    // Чистим `Memory._exitsCache` от комнат, которых больше нет в `Game.rooms`.
    // Кэш накапливается со временем (TTL 5000 тиков, но если home сменился —
    // старые ключи висят бесконечно).
    if (Memory._exitsCache) {
        for (const roomName in Memory._exitsCache) {
            if (!Game.rooms[roomName]) {
                delete Memory._exitsCache[roomName];
            }
        }
    }

    // Одноразовая чистка: убираем `Memory._tickStartCpu`, который раньше
    // использовался как runtime-переменная в `metrics.ts`. Теперь она
    // хранится в `global`, и в `Memory` ей делать нечего. Без явного
    // `delete` Screeps будет хранить это поле вечно (сериализуется весь
    // `Memory`-объект).
    if ('_tickStartCpu' in Memory) {
        delete (Memory as { _tickStartCpu?: number })._tickStartCpu;
    }

    const ownedRoomNames: string[] = [];

    for (const roomName in Game.rooms) {
        const r = Game.rooms[roomName];

        if (!r) {
            continue;
        }

        if (r.controller && r.controller.my) {
            ownedRoomNames.push(roomName);
        }
    }

    if (ownedRoomNames.length === 0) {
        // Нет owned-комнат в `Game.rooms` — но это ещё не значит, что у нас
        // нет ни одного спавна. `Game.rooms` доступен только при наличии
        // vision (свои крипы в комнате, активный safeMode, observer и т.д.).
        // Ситуация, в которой спавн наш, но vision временно отсутствует
        // (например, последний крип погиб и safeMode ещё активен), приводит
        // к deadlock: бот не видит комнату → не спавнит крипов → vision
        // пропадает навсегда. Поэтому при пустом `Game.rooms` пробуем
        // воскресить спавн через `Memory._knownSpawnIds` (id спавнов,
        // которые бот видел хотя бы раз). `Game.getObjectById()` вернёт
        // объект, если vision есть (например, через safeMode), и вернёт
        // null если нет — тогда остаётся только алерт.
        if (!Memory._knownSpawnIds) {
            Memory._knownSpawnIds = {} as Record<string, true>;
        }
        let rescued = 0;
        for (const spawnId in Memory._knownSpawnIds) {
            const spawn = Game.getObjectById(spawnId as Id<StructureSpawn>);
            if (!spawn) {
                continue;
            }
            // Vision появилась — закрепляем комнату за ownedRoomNames и
            // удаляем из known (после `room.run` мы заново её добавим).
            const roomName = spawn.room.name;
            ownedRoomNames.push(roomName);
            rescued++;
        }
        if (rescued === 0) {
            // Нет ни одной комнаты с vision. Сообщаем один раз в ~83 минуты
            // (дедупликация в log.ts), чтобы пользователь знал о потере базы.
            // Авто-восстановление намеренно не реализовано (см. STRATEGY.md,
            // раздел «Что отсутствует»): без spawn нельзя создать крипов, а
            // claim/reserve требуют предварительно заспавненных крипов. Поэтому
            // единственный безопасный сигнал — алерт.
            log.warn('main', 'no owned rooms — bot is idle, respawn or claim a new room to recover');
            metrics.tickEnd();
            return;
        }
    }

    // Регистрируем id всех спавнов наших owned-комнат, чтобы в будущем
    // (после потери vision) можно было воскресить доступ через
    // `Game.getObjectById` (см. блок выше).
    if (!Memory._knownSpawnIds) {
        Memory._knownSpawnIds = {} as Record<string, true>;
    }
    for (const roomName of ownedRoomNames) {
        const r = Game.rooms[roomName];
        if (!r) {
            continue;
        }
        for (const spawn of r.find(FIND_MY_SPAWNS)) {
            Memory._knownSpawnIds[spawn.id] = true;
        }
    }
    // Чистим записи о спавнах, которые больше не наши (controller.my === false
    // или комната потеряна). Без чистки `_knownSpawnIds` будет расти вечно.
    for (const spawnId in Memory._knownSpawnIds) {
        const spawn = Game.getObjectById(spawnId as Id<StructureSpawn>);
        if (!spawn) {
            continue;
        }
        const room = spawn.room;
        if (room.controller && !room.controller.my) {
            delete Memory._knownSpawnIds[spawnId];
        }
    }

    for (const roomName of ownedRoomNames) {
        const r = Game.rooms[roomName];
        if (r) {
            room.run(r);
        }
    }

    expansion.run();
    pixels.generatePixel();
    metrics.tickEnd();
}
