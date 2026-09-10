import type { Conflict } from '@atarashi/schema';

export interface TextFragment {
    contents: string;
    source: string;
}

const stripComments = (line: string) => line.replace(/^\s*#.*$/, '');

/**
 * `.gitignore`-style union: keep the first occurrence of every line, and label
 * each contributing blueprint's block so a reader can see where a rule came
 * from.
 */
export function mergeLinesUnique(fragments: TextFragment[]): string {
    const seen = new Set<string>();
    const blocks: string[] = [];

    for (const fragment of fragments) {
        const lines: string[] = [];
        for (const raw of fragment.contents.split('\n')) {
            const line = raw.trimEnd();
            if (line === '' || stripComments(line) === '') {
                // Keep a blueprint's own comments, drop its blank padding.
                if (line !== '') lines.push(line);
                continue;
            }
            if (seen.has(line)) continue;
            seen.add(line);
            lines.push(line);
        }
        if (lines.length > 0) blocks.push(`# ${fragment.source}\n${lines.join('\n')}`);
    }

    return `${blocks.join('\n\n')}\n`;
}

export interface EnvEntryFragment {
    key: string;
    value: string;
    description?: string;
    source: string;
}

export interface EnvMergeResult {
    contents: string;
    conflicts: Conflict[];
}

/**
 * `.env` union at the key level. A duplicate key with the same value is fine —
 * two blueprints agreeing on `PORT=3000` is not a problem. A duplicate with a
 * different value is a conflict, because silently picking one would ship a
 * project that connects to the wrong thing.
 */
export function mergeEnv(entries: EnvEntryFragment[]): EnvMergeResult {
    const conflicts: Conflict[] = [];
    const owners = new Map<string, EnvEntryFragment>();
    const bySource = new Map<string, EnvEntryFragment[]>();

    for (const entry of entries) {
        const existing = owners.get(entry.key);
        if (existing) {
            if (existing.value !== entry.value) {
                conflicts.push({
                    kind: 'env-value',
                    subject: entry.key,
                    blueprints: [existing.source, entry.source].sort(),
                    message: `${existing.source} and ${entry.source} both set ${entry.key} to different values`,
                    suggestions: [`Keep one of: \`${existing.value}\` or \`${entry.value}\``],
                });
            }
            continue;
        }

        owners.set(entry.key, entry);
        bySource.set(entry.source, [...(bySource.get(entry.source) ?? []), entry]);
    }

    const blocks = [...bySource.entries()].map(([source, group]) => {
        const lines = group.flatMap((entry) => [
            ...(entry.description ? [`# ${entry.description}`] : []),
            `${entry.key}=${entry.value}`,
        ]);
        return `# ${source}\n${lines.join('\n')}`;
    });

    return { contents: `${blocks.join('\n\n')}\n`, conflicts };
}

/** Parses an existing `.env` body into entries, for merging with contributions. */
export function parseEnv(contents: string, source: string): EnvEntryFragment[] {
    const entries: EnvEntryFragment[] = [];
    let description: string | undefined;

    for (const raw of contents.split('\n')) {
        const line = raw.trim();
        if (line === '') {
            description = undefined;
            continue;
        }
        if (line.startsWith('#')) {
            description = line.slice(1).trim();
            continue;
        }

        const index = line.indexOf('=');
        if (index === -1) continue;

        const entry: EnvEntryFragment = {
            key: line.slice(0, index).trim(),
            value: line.slice(index + 1).trim(),
            source,
        };
        if (description) entry.description = description;
        entries.push(entry);
        description = undefined;
    }

    return entries;
}

/** `append` / `prepend`: concatenate in graph order with a blank-line separator. */
export function concatenate(fragments: TextFragment[], direction: 'append' | 'prepend'): string {
    const ordered = direction === 'append' ? fragments : [...fragments].reverse();
    return ordered
        .map((fragment) => fragment.contents.replace(/\n+$/, ''))
        .join('\n\n')
        .concat('\n');
}
