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
import { recordSpawn } from './metrics';
import * as log from './log';

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

    const body = bodyFor(role, room.controller?.level ?? 1);

    if (!body) {
        return false;
    }

    const cost = bodyCost(body);

    // `spawnCreep` берёт энергию **из спавна**, а не из комнаты: ёмкость
    // хранилища спавна — 300 энергий. Поэтому проверять надо запас спавна,
    // а не `room.energyAvailable` (спавн + расширения).
    //
    // Прежняя проверка по комнате создавала иллюзию, что крипа можно
    // заказать: в E34S53 в комнате было 327 энергии, а апгрейдер стоил
    // 350 — и бот сутки подряд пытался заказать апгрейдера, которого
    // невозможно было создать ни при каком запасе. Тело дороже ёмкости
    // спавна не создаётся вообще никогда.
    if (spawn.store.energy < cost) {
        // Энергия в комнате есть, но она лежит в расширениях, а спавн
        // их не видит. Это не «нет денег», это «деньги не там» — и
        // сообщить об этом стоит, иначе комната выглядит платёжеспособной.
        if (spawn.room.energyAvailable >= cost) {
            log.warn(
                'spawn',
                `cannot spawn ${role} in ${room.name}: the spawn holds only ` +
                `${spawn.store.energy} of ${cost} energy — the rest sits in ` +
                'extensions, and spawnCreep only draws from the spawn itself'
            );
        }

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
        recordSpawn(role, bodyCost(body), body.length);
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
    const body = bodyFor(role, room.controller?.level ?? 1);

    if (!body) {
        return false;
    }

    return room.energyCapacityAvailable >= bodyCost(body);
}
