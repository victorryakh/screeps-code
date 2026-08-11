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
    }

    interface Memory {
        targetRoom?: string;
        expansionBlacklist?: string[];
        expansionPreferredTarget?: string;
        debug?: boolean;
        _exitsCache?: {
            [roomName: string]: {
                tick: number;
                exits: Partial<Record<ExitKey, string>>;
            };
        };
    }
}

export {};
