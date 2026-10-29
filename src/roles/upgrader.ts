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
    moveCached,
    blocksBirthRing,
    collectHarvestSlotKeys
} from '../utilities';
import { UPGRADE_RANGE, UPGRADE_SPOT_VERSION } from '../constants';

/**
 * Проверяет, что клетка занята не под крипа: клетки добычи принадлежат
 * харвестерам, клетки рождения — спавну.
 *
 * @param room Комната.
 * @param x    X клетки.
 * @param y    Y клетки.
 * @returns `true`, если на клетке нельзя стоять рабочему крипу.
 */
function isReservedTile(room: Room, x: number, y: number): boolean {
    if (blocksBirthRing(room, x, y)) {
        return true;
    }

    return collectHarvestSlotKeys(room).has(`${x},${y}`);
}

/**
 * Апгрейдит контроллер «здесь и сейчас», если крип уже в зоне апгрейда.
 *
 * @remarks
 * Апгрейд работает с расстояния 3 (`upgradeController` проверяет
 * `inRangeTo(pos, 3)`), поэтому идти ради апгрейда в другую часть комнаты
 * незачем. Раньше апгрейдер шёл к заранее выбранной клетке и апгрейдил
 * контроллер только после того, как до неё добрался. В E34S53 клетка
 * оказывалась в пятнадцати шагах по пути, крип туда не доходил — и
 * контроллер не получал ни единицы прогресса, хотя энергия у крипа была.
 *
 * На клетке добычи апгрейдить нельзя: она принадлежит харвестерам, и
 * занять её — значит отнять у комнаты треть дохода.
 *
 * @param creep Крип-апгрейдер.
 * @returns `true`, если контроллер был апгрейднут.
 */
function tryUpgradeInPlace(creep: Creep): boolean {
    const controller = creep.room.controller;

    if (!controller || !controller.my) {
        return false;
    }

    // Расстояние считаем сами (шквал Хеви): движок проверяет ровно это же
    // условие в `upgradeController`, а считать его явно позволяет работать
    // и оффлайн-тестам, где у позиции нет метода `inRangeTo`.
    const dx = Math.abs(creep.pos.x - controller.pos.x);
    const dy = Math.abs(creep.pos.y - controller.pos.y);

    if (Math.max(dx, dy) > UPGRADE_RANGE) {
        return false;
    }
    if (isReservedTile(creep.room, creep.pos.x, creep.pos.y)) {
        return false;
    }

    return creep.upgradeController(controller) === OK;
}

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

    if (
        cached &&
        cached.roomName === room.name &&
        creep.memory._upgradeSpotVersion === UPGRADE_SPOT_VERSION
    ) {
        const built =
            room.find(FIND_STRUCTURES, {
                filter: (s) => s.pos.x === cached.x && s.pos.y === cached.y
            }).length > 0 ||
            room.find(FIND_CONSTRUCTION_SITES, {
                filter: (s) => s.pos.x === cached.x && s.pos.y === cached.y
            }).length > 0;

        // Кэш живёт дольше одного вызова: за это время клетку могли занять
        // другой крип, построить на ней расширение или закрыть стройкой.
        // Проверяем все три случая — иначе апгрейдер ходил бы в
        // недостижимую клетку, не апгрейдя контроллер.
        //
        // Занятый живым крипом кэш НЕ обнуляем: крип подвижен, клетка
        // освободится, а обнуление кэша означало бы пересчёт клетки
        // апгрейда каждый тик (PathFinder стоит CPU, а клетка всё равно
        // та же самая).
        if (!built && !isReservedTile(room, cached.x, cached.y)) {
            return new RoomPosition(cached.x, cached.y, cached.roomName);
        }
    }

    const spot = findUpgradeSpot(room, creep);

    if (spot) {
        creep.memory._upgradeSpot = { x: spot.x, y: spot.y, roomName: spot.roomName };
        creep.memory._upgradeSpotVersion = UPGRADE_SPOT_VERSION;
    } else {
        delete creep.memory._upgradeSpot;
        delete creep.memory._upgradeSpotVersion;
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

    // Уже в зоне апгрейда — апгрейдим немедленно. Дорога до «идеальной»
    // клетки съедает больше энергии, чем сам апгрейд: в E34S53 апгрейдер
    // шёл пятнадцать клеток к клетке (16,25) и не доходил, и контроллер
    // не получал ни единицы прогресса.
    if (tryUpgradeInPlace(creep)) {
        return;
    }

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
        if (tryUpgradeInPlace(creep)) {
            return;
        }

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
