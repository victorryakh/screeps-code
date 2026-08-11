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
        if (!Game.creeps[name]) {
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
