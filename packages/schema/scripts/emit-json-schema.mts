/**
 * Emits JSON Schema for the files humans hand-write — `blueprint.json`,
 * preset manifests and `atarashi.json` — so editors autocomplete them.
 * Run as part of the package build; output lands in `schemas/`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Imported from the build output so this script needs no TS loader of its own.
import {
    blueprintManifestSchema,
    presetManifestSchema,
    projectConfigSchema,
    projectSpecSchema,
    registryIndexSchema,
    userConfigSchema,
} from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'schemas');

const targets: { file: string; name: string; schema: ZodTypeAny }[] = [
    {
        file: 'blueprint.schema.json',
        name: 'AtarashiBlueprintManifest',
        schema: blueprintManifestSchema,
    },
    { file: 'preset.schema.json', name: 'AtarashiPresetManifest', schema: presetManifestSchema },
    { file: 'project-spec.schema.json', name: 'AtarashiProjectSpec', schema: projectSpecSchema },
    { file: 'atarashi.schema.json', name: 'AtarashiProjectConfig', schema: projectConfigSchema },
    {
        file: 'registry-index.schema.json',
        name: 'AtarashiRegistryIndex',
        schema: registryIndexSchema,
    },
    { file: 'user-config.schema.json', name: 'AtarashiUserConfig', schema: userConfigSchema },
];

mkdirSync(outDir, { recursive: true });

for (const target of targets) {
    const json = zodToJsonSchema(target.schema, {
        name: target.name,
        $refStrategy: 'root',
    });
    writeFileSync(join(outDir, target.file), `${JSON.stringify(json, null, 2)}\n`);
    console.log(`schemas/${target.file}`);
}
