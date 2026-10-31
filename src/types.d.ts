/**
 * Расширение типов глобальной памяти Screeps.
 *
 * Здесь объявляются поля, которые бот хранит поверх стандартных типов
 * из `@types/screeps`. Поля с префиксом `_` — приватный кэш/runtime-данные,
 * которые не являются частью «логической» памяти крипов/комнат и обновляются
 * автоматически служебными модулями (`utilities`, `strategy`, `log`,
 * `metrics`).
 */
declare global {
    /**
     * Расширение `global` для runtime-данных, которые не должны
     * персистироваться через `Memory` (т.е. сбрасываются при перезагрузке
     * VM). Это позволяет избежать «замусоривания» `Memory` служебными
     * полями, которые не нужны между тиками.
     */
    namespace NodeJS {
        interface Global {
            /** Значение `Game.cpu.getUsed()` в начале текущего тика; парный вызов — `metrics.tickEnd`. */
            _tickStartCpu?: number;
        }
    }

    /**
     * Память крипа. Хранит логическое состояние, используемое ролью:
     * целевой источник, целевая комната для удалённых ролей и флаги
     * двухфазных стейт-машин (`upgrading`, `building`, `repairing`).
     */
    interface CreepMemory {
        /** Имя роли из {@link ROLE}. Тип `string` для обратной совместимости с устаревшими данными. */
        role: string;
        /** Имя «домашней» комнаты крипа, по которой идёт учёт состава и планирование. */
        homeRoom: string;
        /** Id назначенного источника (используется `harvester`-ом; чередуется через `room.memory._harvesterIndex`). */
        sourceId?: Id<Source>;
        /** Имя целевой комнаты для ролей экспансии (`rharvester`, `reserver`, `claimer`). */
        targetRoom?: string;
        /** Флаг стейт-машины `upgrader`-а: `true` — крип сливает энергию в контроллер. */
        upgrading?: boolean;
        /** Флаг стейт-машины `builder`-а: `true` — крип строит, иначе пополняет запас. */
        building?: boolean;
        /** Флаг стейт-машины `repairer`-а: `true` — крип чинит, иначе пополняет запас. */
        repairing?: boolean;
        /**
         * `true` — крипов такой роли в комнате больше, чем комната может
         * прокормить (см. `markExcessWorkers`). Такой крип не берёт энергию из
         * структур: он работает на том, что уже в рюкзаке, и не отнимает
         * энергию у тех, кто в бюджете уложился.
         */
        _excess?: boolean;
        /** Тик спавна крипа; используется `metrics.recordCreepDeath` для оценки возраста. */
        _birthTick?: number;
        /** Счётчик тиков, проведённых крипом в целевой комнате (см. `roles/claimer.ts`). */
        _targetTicks?: number;
        /**
         * Клетка, с которой крип апгрейдит контроллер, когда источник насыщен и
         * энергия берётся из спавна (см. `findUpgradeSpot`). Кэш, чтобы не
         * искать место каждый тик и не метаться по комнате.
         */
        _upgradeSpot?: {
            x: number;
            y: number;
            roomName: string;
        };
        /**
         * Клетка, с которой крип строит construction site (см.
         * `findBuildSpot`). Кэш, чтобы не искать место каждый тик. Выбирается
         * так, чтобы не занимать клетку добычи и не закрывать клетку
         * рождения.
         */
        _buildSpot?: {
            x: number;
            y: number;
            roomName: string;
            siteId: string;
        };
        /**
         * Кэш маршрута, используемый {@link moveCached} для экономии CPU.
         * Содержит путь, конечную точку и момент последнего вычисления; при
         * совпадении координат и `Game.time - time < reusePath` путь
         * воспроизводится через `Creep.moveByPath`.
         */
        _move?: {
            path: RoomPosition[];
            dest: { x: number; y: number; roomName: string };
            time: number;
        };
    }

    /**
     * Структура в комнате.
     *
     * @remarks
     * Движок Screeps умеет сносить собственные структуры: `Structure.destroy()`
     * отправляет intent `room/destroyStructure`, который обрабатывается на
     * сервере (`screeps/engine`, `src/processor/intents/room/destroy-structure.js`).
     * Метод не документирован в публичном API, поэтому объявлен здесь
     * опциональным: бот использует его только как крайнюю меру — снести
     * расширение, если из-за него спавн оказался запечатан.
     */
    interface Structure<_T extends StructureConstant = StructureConstant> {
        /** Сносит структуру. Возвращает `OK` или код ошибки. */
        destroy?(): ScreepsReturnCode;
    }

    /**
     * Память комнаты. Содержит как пользовательские данные (метрики),
     * так и служебный кэш/таймеры, помеченные `_`-префиксом.
     */
    interface RoomMemory {
        /** Тик последней проверки необходимости новых extensions (см. `ensureExtensions`). */
        _extensionCheckTick?: number;
        /** Тик последней проверки доступности спавна для появления крипов (см. `ensureSpawnAccessible`). */
        _spawnAccessCheckTick?: number;
        /** Тик последней проверки запаса свободных клеток рождения (см. `ensureSpawnRingReserve`). */
        _ringReserveCheckTick?: number;
        /** Диагностический снимок состояния кольца клеток рождения (пишется, когда кольцо тесное). */
        _ringDebug?: {
            tick: number;
            spawn: string;
            terrain: string;
            free: string;
            freeNoCreeps: number;
            creeps: string;
        };
        /** Тик, с которого спавн считается запечатанным; сбрасывается, как только свободная клетка появилась. */
        _sealedSpawnTick?: number;
        /** Тик последней попытки освободить клетку у запечатанного спавна (см. `ensureSpawnAccessible`). */
        _sealedSpawnHealTick?: number;
        /** Тик последней проверки необходимости construction site для спавна (см. `ensureSpawn`). */
        _spawnCheckTick?: number;
        /** Тик последней проверки насыщенности источника (см. `updateSourceSaturation`). */
        _sourceCheckTick?: number;
        /** Тик последнего пересчёта бюджета энергии комнаты (см. `computeWorkBudget`). */
        _budgetCheckTick?: number;
        /** Сколько энергии в тик комната может тратить на работу (см. `computeWorkBudget`). */
        _workBudget?: number;
        /** Тик последнего замера энергии в источнике комнаты. */
        _incomeSampleTick?: number;
        /** Энергия в источнике на момент последнего замера. */
        _incomeSampleEnergy?: number;
        /**
         * Измеренный доход комнаты в энергиях за тик.
         *
         * @remarks
         * Значение, которому доверяет `computeWorkBudget`: модельный расчёт
         * по числу клеток добычи завышал доход втрое (см. `updateIncomeRate`).
         */
        _incomeRate?: number;
        /**
         * `true`, если клеток добычи не хватает на всех харвестеров комнаты.
         *
         * @remarks
         * В такой комнате апгрейдер, билдер и ремонтник не вытесняют
         * харвестеров с клеток добычи, а берут энергию из спавна/расширений
         * (см. `roles/upgrader.ts`).
         */
        _sourceSaturated?: boolean;
        /** Тик, на котором был создан последний крип; используется как однотиковый кулдаун спавна. */
        _spawnCooldown?: number;
        /** Счётчик чередования источников между харвестерами для равномерной нагрузки. */
        _harvesterIndex?: number;
        /** Per-room метрики: кольцевой буфер замеров рейсов и снимки состава ролей. */
        metrics?: {
            /** Кольцевой буфер последних `TRIP_SAMPLES_LIMIT` (20) сэмплов экономики рейса. */
            tripSamples: {
                ts: number;
                role: string;
                distance: number;
                roundTripTicks: number;
                energyPerTick: number;
            }[];
            /** Снимок состава ролей комнаты из последнего `recordRoomCounts`. */
            lastRoleCounts?: Record<string, number>;
            /** RCL комнаты из последнего `init()`; обновляется только при `Memory.debug === true`. */
            lastRcl?: number;
        };
    }

    /**
     * Уровни логгирования, поддерживаемые модулем {@link log}.
     * Упорядочены по возрастанию детализации: `error < warn < info < debug < trace`.
     */
    type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

    /**
     * Глобальная память бота. Помимо штатных полей Screeps, хранит
     * настройки (`debug`, `logLevel`) и сервисные кэши (`_exitsCache`,
     * `_notified`, `_tickStartCpu`).
     */
    interface Memory {
        /** Имя выбранной целевой комнаты для экспансии; используется ролями `rharvester`/`reserver`/`claimer`. */
        targetRoom?: string;
        /** Чёрный список комнат-кандидатов на экспансию; перекрывает `EXPANSION.blacklist`. */
        expansionBlacklist?: string[];
        /** Предпочтительная целевая комната; если присутствует и доступна, выбирается без перебора. */
        expansionPreferredTarget?: string;
        /** Флаг отладочного режима: включает частые сэмплы метрик и подробный лог. */
        debug?: boolean;
        /** Текущий уровень логгирования, читается {@link getLevel}. */
        logLevel?: LogLevel;
        /**
         * Id спавнов, которые бот видел хотя бы раз. Используется для
         * восстановления доступа к комнате через `Game.getObjectById`, когда
         * vision временно отсутствует (см. `main.ts`).
         */
        _knownSpawnIds?: Record<string, true>;
        /**
         * Кэш `Game.map.describeExits` на тик последнего обновления.
         * Используется `pickExpansionTarget`; TTL — `EXITS_CACHE_TTL` тиков.
         */
        _exitsCache?: {
            [roomName: string]: {
                tick: number;
                exits: Partial<Record<ExitKey, string>>;
            };
        };
        /**
         * Карта дедупликации уведомлений `Game.notify` по ключу
         * `level|scope|msg` → тик последнего отправления. TTL — `NOTIFY_DEDUP_TTL`.
         * Не превышает `NOTIFY_MAX_ENTRIES` записей.
         */
        _notified?: Record<string, number>;
        /** Глобальные счётчики: тики, CPU прошлого тика, bucket, число спавнов/смертей по ролям, общий расход энергии. */
        metrics?: {
            ticks: number;
            lastTickCpu: number;
            lastBucket: number;
            spawnsByRole: Record<string, number>;
            deathsByRole: Record<string, number>;
            totalSpawnEnergy: number;
        };
    }
}

export {};
