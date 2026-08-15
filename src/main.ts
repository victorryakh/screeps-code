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
 * 6. Если owned-комнат нет — `metrics.tickEnd()` и выход.
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
        metrics.tickEnd();
        return;
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
