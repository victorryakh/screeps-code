declare global {
    interface CreepMemory {
        role: string;
        homeRoom: string;
        sourceId?: Id<Source>;
        targetRoom?: string;
        upgrading?: boolean;
        building?: boolean;
        repairing?: boolean;
        _move?: {
            path: RoomPosition[];
            dest: { x: number; y: number; roomName: string };
            time: number;
        };
    }

    interface RoomMemory {
        _extensionCheckTick?: number;
        _spawnCooldown?: number;
        _harvesterIndex?: number;
        metrics?: {
            tripSamples: {
                ts: number;
                role: string;
                distance: number;
                roundTripTicks: number;
                energyPerTick: number;
            }[];
            lastRoleCounts?: Record<string, number>;
            lastRcl?: number;
        };
    }

    type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

    interface Memory {
        targetRoom?: string;
        expansionBlacklist?: string[];
        expansionPreferredTarget?: string;
        debug?: boolean;
        logLevel?: LogLevel;
        _exitsCache?: {
            [roomName: string]: {
                tick: number;
                exits: Partial<Record<ExitKey, string>>;
            };
        };
        _notified?: Record<string, number>;
        _tickStartCpu?: number;
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
