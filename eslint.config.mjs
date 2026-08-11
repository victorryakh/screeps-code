import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

// eslint-disable-next-line deprecation
export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    languageOptions: {
      globals: {
        // Screeps globals provided via @types/screeps are already loaded by
        // tseslint's parser, but runtime helpers exposed by the engine are not
        // declared in the typings. List them here so ESLint does not flag
        // references inside source files.
        Game: "readonly",
        Memory: "readonly",
        RawMemory: "readonly",
        PathFinder: "readonly",
        Room: "readonly",
        Spawn: "readonly",
        Creep: "readonly",
        Source: "readonly",
        Structure: "readonly",
        StructureSpawn: "readonly",
        StructureExtension: "readonly",
        StructureTower: "readonly",
        StructureRoad: "readonly",
        StructureContainer: "readonly",
        StructureStorage: "readonly",
        StructureTerminal: "readonly",
        StructureLink: "readonly",
        StructureRampart: "readonly",
        StructureWall: "readonly",
        ConstructionSite: "readonly",
        Flag: "readonly",
        _: "readonly",
      },
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", ".kilo/**", "Gruntfile.js"],
  },
);
