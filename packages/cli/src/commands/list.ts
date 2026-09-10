import { reportError } from '../errors.js';
import { EXIT } from '../exit-codes.js';
import { Printer } from '../output.js';
import { buildRegistry } from '../registry-context.js';
import { readUserConfig, resolveConfigPath } from '../user-config.js';

export interface ListFlags {
    category?: string;
    json?: boolean;
    color?: boolean;
    offline?: boolean;
    registry?: string;
}

export async function runList(kind: string | undefined, flags: ListFlags): Promise<number> {
    const cwd = process.cwd();
    const printer = new Printer({
        json: Boolean(flags.json),
        quiet: false,
        verbose: false,
        color: flags.color !== false && !flags.json,
    });

    try {
        const userConfig = await readUserConfig(resolveConfigPath());
        const registry = buildRegistry(
            { cwd, offline: flags.offline, registry: flags.registry },
            userConfig
        );

        if (kind === 'presets') {
            const presets = await registry.presets();
            if (printer.options.json) {
                printer.emitJson({ ok: true, presets });
                return EXIT.OK;
            }
            for (const preset of presets.sort((a, b) => (a.id < b.id ? -1 : 1))) {
                const flag = preset.recommended ? ' (recommended)' : '';
                printer.line(`${preset.id}${flag}`);
                printer.line(`  ${preset.description}`);
            }
            return EXIT.OK;
        }

        const summaries = await registry.summaries();
        const loaded = await Promise.all(summaries.map((summary) => registry.load(summary.id)));
        const manifests = loaded
            .filter((blueprint) => blueprint !== undefined)
            .map((blueprint) => blueprint.manifest)
            .filter((manifest) => !flags.category || manifest.category === flags.category);

        if (printer.options.json) {
            printer.emitJson({
                ok: true,
                blueprints: manifests.map((manifest) => ({
                    id: manifest.id,
                    name: manifest.name,
                    version: manifest.version,
                    category: manifest.category,
                    description: manifest.description,
                    tags: manifest.tags,
                    deprecated: Boolean(manifest.deprecated),
                    experimental: manifest.experimental,
                })),
            });
            return EXIT.OK;
        }

        const grouped = new Map<string, typeof manifests>();
        for (const manifest of manifests) {
            const bucket = grouped.get(manifest.category) ?? [];
            bucket.push(manifest);
            grouped.set(manifest.category, bucket);
        }

        for (const [category, items] of [...grouped.entries()].sort(([a], [b]) =>
            a < b ? -1 : 1
        )) {
            printer.line(category);
            for (const item of items.sort((a, b) => (a.id < b.id ? -1 : 1))) {
                const flags_ = item.deprecated
                    ? ' [deprecated]'
                    : item.experimental
                      ? ' [experimental]'
                      : '';
                printer.line(`  ${item.id.padEnd(26)} ${item.description}${flags_}`);
            }
            printer.line('');
        }

        return EXIT.OK;
    } catch (thrown) {
        return reportError(printer, thrown);
    }
}
