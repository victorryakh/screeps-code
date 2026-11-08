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
    withdrawEnergy,
    upgradeRoomController,
    tryUpgradeInPlace,
    isSourceSaturated,
    upgradeFromWorkSpot,
    runStepAside
} from '../utilities';

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
    // В режиме донора крип не добывает: энергию он берёт из структур. Значит,
    // клетка добычи ему не нужна, и закрепление за ней надо снять — иначе
    // апгрейдер занимает клетку у источника вхолостую, и харвестер до неё
    // не доходит. В E34S53 апгрейдер держал закрепление на клетке (20,24),
    // и третья клетка добычи простаивала.
    delete creep.memory._harvestTile;

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

    // Кольцо рождения — не место для постоянной работы.
    //
    // В E34S53 апгрейдер стоял на клетке (19,25) — это кольцо рождения
    // вокруг спавна, и одновременно один из двух выходов из «кармана», где
    // лежат клетки добычи. Крипы — препятствия для движения, поэтому
    // апгрейдер на кольце перекрывал коридор: харвестер с полным рюкзаком
    // не мог пройти к спавну и обходил полкомнаты через болото. Доход
    // комнаты падал до 0.64 энергии в тик при потолке в 6.
    //
    // Своя клетка апгрейда у апгрейдера есть — `findUpgradeSpot` выбирает
    // её по длине пути до клеток добычи, то есть в E34S53 это (19,21), в
    // одном шаге от клетки добычи и вне кольца. Но апгрейд с текущей
    // клетки удаётся (контроллер виден с расстояния 3), поэтому крип
    // удовлетворялся апгрейдом на месте и никогда не переходил на
    // выбранную клетку.
    //
    // Порядок действий (см. `upgradeFromWorkSpot`): уйти с занятой клетки
    // на выбранную, а если пути нет — работать на месте: контроллер без
    // прогресса хуже, чем лишний шаг.
    upgradeFromWorkSpot(creep, {
        visualizePathStyle: { stroke: '#00ff00' }
    });
}

/**
 * Выполняет один шаг upgrader-а. См. описание модуля.
 *
 * @param creep Крип с `role === ROLE.UPGRADER`.
 */
export function run(creep: Creep): void {
    // Сдвиг в сторону — исключение из правил роли: он важнее апгрейда,
    // потому что без него другой наш крип простаивает взаперти (см.
    // `ensureCreepsNotConfined` в `room.ts`).
    if (runStepAside(creep)) {
        return;
    }

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
