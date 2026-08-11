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
     * Память комнаты. Содержит как пользовательские данные (метрики),
     * так и служебный кэш/таймеры, помеченные `_`-префиксом.
     */
    interface RoomMemory {
        /** Тик последней проверки необходимости новых extensions (см. `ensureExtensions`). */
        _extensionCheckTick?: number;
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
        /** Значение `Game.cpu.getUsed()` в начале текущего тика; используется `tickEnd` для подсчёта дельты. */
        _tickStartCpu?: number;
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
