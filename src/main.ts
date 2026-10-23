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
import * as claimer from './roles/claimer';
import { ROLE } from './constants';
import { EXPANSION } from './strategy';
import { bodyCost } from './utilities';

console.log("Started script at", new Date().toISOString())


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

    // Vision есть, но owned-комнат может не быть. Тогда у нас наверняка
    // остался свой спавн в комнате, контроллер которой больше не наш
    // (например, он даунгрейднулся до уровня 0). Такой спавн — последняя
    // точка опоры: если контроллер свободен (уровень 0, без владельца и без
    // резервации), из спавна можно завести CLAIM-крипа и вернуть комнату.
    // Без этого аккаунт остаётся без комнаты и без крипов, и движок Screeps
    // перестаёт запускать скрипт вовсе (см. STRATEGY.md, раздел «Простой
    // аккаунта без комнат»).
    const reclaiming = tryReclaimRoom();

    if (ownedRoomNames.length === 0 && !reclaiming) {
        log.warn('main', 'no owned rooms — bot is idle, respawn or claim a new room to recover');
        metrics.tickEnd();
        return;
    }

    // Клэймер живёт в комнате, которая ещё не наша, поэтому `room.run()`
    // его не выполняет — делаем это здесь.
    runReclaimClaimers();

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
    // Чистим записи о спавнах, из которых восстановление уже невозможно:
    // в комнате нет контроллера либо контроллер занят (наш контроллер
    // даунгрейднулся не до нуля, либо комнату перехватили). Спавны в комнате
    // со свободным контроллером, наоборот, оставляем: из них бот переклеймит
    // комнату (см. `tryReclaimRoom`). Раньше очистка удаляла id спавна при
    // любом `controller.my === false` — то есть ровно тот id, который был
    // нужен для восстановления.
    for (const spawnId in Memory._knownSpawnIds) {
        const spawn = Game.getObjectById(spawnId as Id<StructureSpawn>);
        if (!spawn) {
            continue;
        }
        const controller = spawn.room.controller;

        if (!controller) {
            delete Memory._knownSpawnIds[spawnId];
            continue;
        }

        if (controller.my || isFreeController(controller)) {
            continue;
        }

        delete Memory._knownSpawnIds[spawnId];
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

/**
 * Проверяет, что контроллер комнаты можно переклеймить: уровень 0, без
 * владельца и без резервации.
 *
 * @param controller Контроллер комнаты.
 * @returns `true`, если комната свободна для клейма.
 */
function isFreeController(controller: StructureController): boolean {
    return (
        controller.level === 0 &&
        !controller.owner &&
        !controller.reservation
    );
}

/**
 * Пытается вернуть комнату, в которой у нас остался спавн, но контроллер
 * больше не наш.
 *
 * Сценарий: контроллер нашей комнаты даунгрейднулся до уровня 0 (или был
 * перехвачен другим игроком). Спавн при этом остаётся нашим, и его ещё
 * можно использовать: если контроллер свободен, из спавна заводится
 * CLAIM-крип, который доходит до контроллера и клеймит комнату обратно.
 *
 * @remarks
 * Это единственный путь, который позволяет боту выбраться из состояния
 * «есть спавн, но нет комнаты» без участия игрока. Работает, только если
 * в комнате ещё есть крипы (иначе движок Screeps не запустит скрипт —
 * тогда аккаунт спасает внешний сторож `tools/screeps-watchdog.mjs`).
 *
 * @returns `true`, если переклейм уже идёт или только что запущен.
 */
function tryReclaimRoom(): boolean {
    const known = Memory._knownSpawnIds;

    if (!known) {
        return false;
    }

    for (const spawnId in known) {
        const spawn = Game.getObjectById(spawnId as Id<StructureSpawn>);

        if (!spawn) {
            continue;
        }

        const targetRoom = spawn.room;
        const controller = targetRoom.controller;

        if (!controller || controller.my || !isFreeController(controller)) {
            continue;
        }

        // Если клэймер к этой комнате уже идёт, нового не заводим.
        let inFlight = false;

        for (const name in Game.creeps) {
            const creep = Game.creeps[name];

            if (
                creep &&
                creep.memory.role === ROLE.CLAIMER &&
                creep.memory.targetRoom === targetRoom.name
            ) {
                inFlight = true;
                break;
            }
        }

        if (inFlight) {
            return true;
        }

        const body = EXPANSION.claimerBody;
        const name = `${ROLE.CLAIMER}_${Game.time}_${Math.floor(Math.random() * 1000)}`;
        const result = spawn.spawnCreep(body, name, {
            memory: {
                role: ROLE.CLAIMER,
                homeRoom: targetRoom.name,
                targetRoom: targetRoom.name
            }
        });

        if (result === OK) {
            metrics.recordSpawn(ROLE.CLAIMER, bodyCost(body), body.length);
            log.info('main', `reclaiming ${targetRoom.name}: claimer spawned from orphaned spawn`);
            return true;
        }
    }

    return false;
}

/**
 * Выполняет шаг крипов-клэймеров, которые работают в комнатах, ещё не
 * принадлежащих нам.
 *
 * @remarks
 * Обычно клэймеров обслуживает `room.run()`, но там перебираются только
 * owned-комнаты. Пока комната не отклеймана, её нужно вести вручную —
 * иначе клэймер будет стоять на месте.
 */
function runReclaimClaimers(): void {
    for (const name in Game.creeps) {
        const creep = Game.creeps[name];

        if (!creep || creep.spawning) {
            continue;
        }

        if (creep.memory.role !== ROLE.CLAIMER) {
            continue;
        }

        const targetRoom = creep.memory.targetRoom;

        if (!targetRoom) {
            continue;
        }

        const room = Game.rooms[targetRoom];

        if (room && room.controller && room.controller.my) {
            // Комната уже наша — её обработает `room.run()`.
            continue;
        }

        claimer.run(creep);
    }
}
