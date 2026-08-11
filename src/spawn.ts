/* ============================================================================
 * Спавн крипов.
 *
 * Тонкая обёртка над `StructureSpawn.spawnCreep`: проверяет кулдаун,
 * энергетическую обеспеченность, проставляет роли и служебные поля
 * памяти (для harvester — индекс источника, для remote-ролей — targetRoom).
 * ==========================================================================*/

import { ROLE } from './constants';
import { REMOTE_ROLES } from './strategy';
import { bodyFor, bodyCost } from './utilities';

/**
 * Пытается создать крипа заданной роли в комнате. Алгоритм:
 * 1. Возвращает `false`, если в этой комнате на текущем тике уже был
 *    спавн (`room.memory._spawnCooldown === Game.time`).
 * 2. Ищет свободный спавн (`!spawning`) в комнате.
 * 3. Подбирает тело через {@link bodyFor} и проверяет
 *    `room.energyAvailable >= bodyCost(body)`.
 * 4. Для ролей из {@link REMOTE_ROLES} требуется `Memory.targetRoom` —
 *    иначе спавн отменяется.
 * 5. Для `ROLE.HARVESTER` циклически выбирает источник комнаты по
 *    `room.memory._harvesterIndex`.
 * 6. Спавнит крипа; при успехе проставляет `_spawnCooldown = Game.time`.
 *
 * @param room Комната, в которой создаётся крип.
 * @param role Имя роли. Расширено до `string` ради совместимости с
 *             устаревшими данными в `Memory.creeps`; для неизвестных ролей
 *             {@link bodyFor} вернёт минимальное тело.
 * @returns `true`, если спавн успешно поставлен в очередь; `false` в остальных
 *          случаях (кулдаун, нет спавна, не хватает энергии, ошибка `spawnCreep`).
 */
export function trySpawn(room: Room, role: string): boolean {
    if (room.memory._spawnCooldown === Game.time) {
        return false;
    }

    const spawn = room.find(FIND_MY_SPAWNS, {
        filter: (s) => !s.spawning
    })[0];

    if (!spawn) {
        return false;
    }

    const body = bodyFor(role);

    if (!body) {
        return false;
    }

    if (spawn.room.energyAvailable < bodyCost(body)) {
        return false;
    }

    const name = `${role}_${Game.time}_${Math.floor(Math.random() * 1000)}`;

    const memory: CreepMemory = {
        role: role,
        homeRoom: room.name
    };

    if (REMOTE_ROLES.indexOf(role as (typeof REMOTE_ROLES)[number]) !== -1) {
        if (!Memory.targetRoom) {
            return false;
        }

        memory.targetRoom = Memory.targetRoom;
    }

    if (role === ROLE.HARVESTER) {
        const sources = room.find(FIND_SOURCES);

        if (sources.length > 0) {
            room.memory._harvesterIndex = (room.memory._harvesterIndex || 0) + 1;
            const source = sources[room.memory._harvesterIndex % sources.length];
            if (source) {
                memory.sourceId = source.id;
            }
        }
    }

    const result = spawn.spawnCreep(body, name, { memory: memory });

    if (result === OK) {
        room.memory._spawnCooldown = Game.time;
        return true;
    }

    return false;
}

/**
 * Проверяет, может ли комната позволить себе спавн крипа заданной роли
 * по `energyCapacityAvailable` (ёмкость, а не текущий запас).
 *
 * @param room Комната.
 * @param role Имя роли (расширено до `string`; см. {@link trySpawn}).
 * @returns `true`, если `room.energyCapacityAvailable >= bodyCost(bodyFor(role))`.
 */
export function canAffordBody(room: Room, role: string): boolean {
    const body = bodyFor(role);

    if (!body) {
        return false;
    }

    return room.energyCapacityAvailable >= bodyCost(body);
}
