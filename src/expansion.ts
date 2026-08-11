/* ============================================================================
 * Экспансия: оркестрация выбора цели и спавна удалённых ролей.
 *
 * Модуль связывает между собой {@link strategy} (решения о фазе и желаемой
 * роли) и {@link spawn} (исполнение). Сам никаких решений не принимает —
 * только кэширует `Memory.targetRoom`/`Memory._exitsCache` и применяет
 * результаты `planExpansion` к спавну.
 * ==========================================================================*/

import { trySpawn, canAffordBody } from './spawn';
import {
    EXPANSION,
    findHomeRoom,
    pickExpansionTarget,
    planExpansion,
    getExpansionGates,
    countExpansionCreeps
} from './strategy';

/**
 * Делает один шаг экспансии за тик:
 * 1. Применяет `Memory.expansionBlacklist` (поверх `EXPANSION.blacklist`).
 * 2. Инициализирует `Memory._exitsCache`, если он не существует.
 * 3. Находит домашнюю комнату через {@link findHomeRoom}.
 * 4. Проверяет {@link getExpansionGates} (RCL/GCL).
 * 5. Если целевой комнаты ещё нет — выбирает через {@link pickExpansionTarget}
 *    и сохраняет в `Memory.targetRoom`.
 * 6. Запрашивает решение у {@link planExpansion} и при `enabled` пытается
 *    создать крипа через {@link trySpawn}.
 *
 * @remarks
 * Вызывается один раз за тик из {@link loop} (после прохода по owned-комнатам).
 * Функция идемпотентна в пределах одного тика: кулдаун `room.memory._spawnCooldown`
 * ограничивает фактическое создание крипа.
 */
export function run(): void {
    const blacklist = Memory.expansionBlacklist || EXPANSION.blacklist || [];

    if (Memory.targetRoom && blacklist.indexOf(Memory.targetRoom) !== -1) {
        delete Memory.targetRoom;
    }

    if (!Memory._exitsCache) {
        Memory._exitsCache = {};
    }

    const home = findHomeRoom(Game.rooms);

    if (!home) {
        return;
    }

    if (!getExpansionGates(home, Game.gcl?.level)) {
        return;
    }

    if (!Memory.targetRoom) {
        const preferred = Memory.expansionPreferredTarget || EXPANSION.preferredTarget;
        const picked = pickExpansionTarget(
            home.name,
            Memory._exitsCache,
            blacklist,
            preferred,
            undefined
        );

        if (picked) {
            Memory.targetRoom = picked;
        }

        if (!Memory.targetRoom) {
            return;
        }
    }

    const targetRoomObject = Game.rooms[Memory.targetRoom];

    const counts = countExpansionCreeps(Memory.targetRoom);

    const decision = planExpansion(
        home,
        Memory.targetRoom,
        targetRoomObject,
        counts.rharvester,
        counts.reserver,
        counts.claimer
    );

    if (!decision.enabled || !decision.desiredRole) {
        return;
    }

    if (!canAffordBody(home, decision.desiredRole)) {
        return;
    }

    trySpawn(home, decision.desiredRole);
}
