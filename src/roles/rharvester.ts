/* ============================================================================
 * Роль `rharvester`: удалённая добыча энергии.
 *
 * Тело: задаётся в `EXPANSION.rharvesterBody` (по умолчанию
 * [WORK, WORK, CARRY, MOVE, MOVE]).
 * Маршрут: `home` → `targetRoom` → активный источник → `home` → сдача.
 *
 * Кэш пути: на удалённых переходах используется `REMOTE_PATH_TTL` (50 тиков),
 * на коротком плече `home` → `SPAWN/EXTENSION` — `HOME_PATH_TTL` (25 тиков).
 * Сдача в `SPAWN`/`EXTENSION` приоритетна; при их отсутствии — в `storage`;
 * если и storage заполнен — энергия роняется на пол.
 * ==========================================================================*/

import {
    moveCached,
    harvestEnergy,
    findClosestSource,
    transferEnergy,
    findEnergyTransferTarget
} from '../utilities';
import { HOME_PATH_TTL, REMOTE_PATH_TTL } from '../constants';

/**
 * Выполняет один шаг rharvester-а. См. описание модуля.
 *
 * @param creep Крип с `role === ROLE.RHARVESTER`. Требует заполненных
 *              `memory.homeRoom` и `memory.targetRoom`.
 */
export function run(creep: Creep): void {
    if (!creep.memory.targetRoom) {
        return;
    }

    const home = Game.rooms[creep.memory.homeRoom];

    if (!home) {
        return;
    }

    if (creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        if (creep.room.name !== creep.memory.targetRoom) {
            moveCached(
                creep,
                new RoomPosition(25, 25, creep.memory.targetRoom),
                { reusePath: REMOTE_PATH_TTL }
            );
            return;
        }

        const source = findClosestSource(creep, true);

        if (source) {
            harvestEnergy(creep, source, { reusePath: REMOTE_PATH_TTL });
        }

        return;
    }

    if (creep.room.name !== home.name) {
        moveCached(
            creep,
            home.controller || new RoomPosition(25, 25, home.name),
            { reusePath: REMOTE_PATH_TTL }
        );
        return;
    }

    const transferTarget = findEnergyTransferTarget(creep, [
        STRUCTURE_SPAWN,
        STRUCTURE_EXTENSION
    ]);

    if (transferTarget) {
        transferEnergy(creep, transferTarget, { reusePath: HOME_PATH_TTL });

        return;
    }

    if (home.storage && home.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        transferEnergy(creep, home.storage, { reusePath: HOME_PATH_TTL });

        return;
    }

    creep.drop(RESOURCE_ENERGY);
}
