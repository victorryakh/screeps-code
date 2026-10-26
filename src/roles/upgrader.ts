/* ============================================================================
 * Роль `upgrader`: апгрейд контроллера комнаты.
 *
 * Тело: [WORK, WORK, CARRY, MOVE] (2 WORK для эффективности).
 * Стейт-машина:
 *   - `memory.upgrading === true`  → апгрейдит контроллер.
 *   - `memory.upgrading === false` → набирает энергию.
 *   - Переход `true → false`: энергия кончилась или контроллер чужой/потерян.
 *   - Переход `false → true`: store полон и контроллер свой.
 * Если контроллер не наш — апгрейд невозможен, крип молча простаивает.
 *
 * Источник энергии зависит от насыщенности источника в комнате:
 *   - источник не насыщен (клеток добычи хватает всем) — крип добывает
 *     энергию сам, как и раньше;
 *   - источник насыщен (клеток добычи хватает только харвестерам) — крип
 *     забирает энергию из спавна/расширений, а клетки добычи оставляет
 *     харвестерам. Иначе харвестеры остаются с пустым рюкзаком, и колония
 *     не получает ни единицы энергии (инцидент в E34S53).
 * ==========================================================================*/

import {
    harvestEnergy,
    findClosestSource,
    findEnergyDonor,
    findUpgradeSpot,
    withdrawEnergy,
    upgradeRoomController,
    isSourceSaturated,
    moveCached
} from '../utilities';

/**
 * Возвращает клетку, с которой крипу удобно апгрейдить контроллер, и
 * запоминает её, чтобы не искать заново каждый тик.
 *
 * @param creep Крип-апгрейдер.
 * @returns Клетка для апгрейда или `null`, если подходящей нет.
 */
function ensureUpgradeSpot(creep: Creep): RoomPosition | null {
    const room = creep.room;
    const cached = creep.memory._upgradeSpot;

    if (cached && cached.roomName === room.name) {
        const busy = room.find(FIND_CREEPS, {
            filter: (c) =>
                c.name !== creep.name && c.pos.x === cached.x && c.pos.y === cached.y
        });

        if (busy.length === 0) {
            return new RoomPosition(cached.x, cached.y, cached.roomName);
        }
    }

    const spot = findUpgradeSpot(room, creep);

    if (spot) {
        creep.memory._upgradeSpot = { x: spot.x, y: spot.y, roomName: spot.roomName };
    } else {
        delete creep.memory._upgradeSpot;
    }

    return spot;
}

/**
 * Режим «источник насыщен»: энергия берётся из спавна/расширений.
 *
 * @remarks
 * Энергию из структуры берут только те, у кого она есть: ждать, пока
 * рюкзак наполнится, бессмысленно — сначала нужно донести то, что уже
 * есть, до контроллера. Стоять при этом на кольце рождения нельзя (крип на
 * клетке рождения закрывает спавн), поэтому апгрейдер уходит на отдельную
 * клетку: апгрейд работает и с расстояния 3.
 *
 * @param creep Крип-апгрейдер.
 */
function runDonorMode(creep: Creep): void {
    if (creep.store[RESOURCE_ENERGY] === 0) {
        if (creep.memory._excess) {
            // Лишний рабочий не забирает энергию: она нужна тем, кто в
            // бюджете комнаты.
            return;
        }

        const donor = findEnergyDonor(creep);

        if (!donor) {
            return;
        }

        withdrawEnergy(creep, donor, {
            visualizePathStyle: { stroke: '#ffaa00' }
        });

        return;
    }

    creep.memory.upgrading = true;

    const spot = ensureUpgradeSpot(creep);

    if (spot && !creep.pos.isEqualTo(spot)) {
        moveCached(creep, spot, {
            visualizePathStyle: { stroke: '#00ff00' }
        });

        return;
    }

    upgradeRoomController(creep, {
        visualizePathStyle: { stroke: '#00ff00' }
    });
}

/**
 * Выполняет один шаг upgrader-а. См. описание модуля.
 *
 * @param creep Крип с `role === ROLE.UPGRADER`.
 */
export function run(creep: Creep): void {
    if (typeof creep.memory.upgrading !== 'boolean') {
        creep.memory.upgrading = false;
    }

    const energy = creep.store[RESOURCE_ENERGY];
    const freeCapacity = creep.store.getFreeCapacity(RESOURCE_ENERGY);
    const controller = creep.room.controller;

    if (
        creep.memory.upgrading &&
        (energy === 0 || !controller || !controller.my)
    ) {
        creep.memory.upgrading = false;
    }

    if (
        !creep.memory.upgrading &&
        freeCapacity === 0 &&
        controller &&
        controller.my
    ) {
        creep.memory.upgrading = true;
    }

    if (isSourceSaturated(creep.room)) {
        runDonorMode(creep);

        return;
    }

    if (creep.memory.upgrading) {
        upgradeRoomController(creep, {
            visualizePathStyle: { stroke: '#00ff00' }
        });

        return;
    }

    const source = findClosestSource(creep);

    if (!source) {
        return;
    }

    harvestEnergy(creep, source, {
        visualizePathStyle: { stroke: '#ffaa00' }
    });
}
