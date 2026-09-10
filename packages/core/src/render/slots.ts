/**
 * Slot markers are left in generated output on purpose: they are how
 * `atarashi add` finds an insertion point later without parsing an AST.
 */
export const SLOT_PREFIX = 'atarashi:';

export interface SlotMarker {
    slot: string;
    /** Column the marker starts at, so injected lines inherit its indentation. */
    indent: string;
    startLine: number;
    endLine: number;
}

const COMMENT_STYLES: Record<string, { open: string; close?: string }> = {
    line: { open: '//' },
    hash: { open: '#' },
    html: { open: '<!--', close: '-->' },
    block: { open: '/*', close: '*/' },
};

/** Picks a comment syntax from the destination's extension. */
export function commentStyleFor(path: string): { open: string; close?: string } {
    const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    if (
        ['yml', 'yaml', 'sh', 'bash', 'toml', 'dockerfile', 'env', 'gitignore'].includes(extension)
    ) {
        return COMMENT_STYLES.hash!;
    }
    if (['html', 'htm', 'xml', 'svg', 'vue', 'md'].includes(extension)) return COMMENT_STYLES.html!;
    if (['css', 'scss', 'less'].includes(extension)) return COMMENT_STYLES.block!;
    return COMMENT_STYLES.line!;
}

export function renderSlotMarkers(slot: string, path: string, indent = ''): string {
    const { open, close } = commentStyleFor(path);
    const suffix = close ? ` ${close}` : '';
    return [
        `${indent}${open} #region ${SLOT_PREFIX}${slot}${suffix}`,
        `${indent}${open} #endregion${suffix}`,
    ].join('\n');
}

const REGION_START = new RegExp(
    `^(\\s*)(?://|#|<!--|/\\*)\\s*#region\\s+${SLOT_PREFIX}([a-z][a-z0-9-]*)`
);
const REGION_END = /^\s*(?:\/\/|#|<!--|\/\*)\s*#endregion/;

/** Finds every slot region in a rendered file. */
export function findSlots(contents: string): SlotMarker[] {
    const lines = contents.split('\n');
    const markers: SlotMarker[] = [];

    for (let index = 0; index < lines.length; index += 1) {
        const match = REGION_START.exec(lines[index]!);
        if (!match) continue;

        const end = lines.findIndex((line, offset) => offset > index && REGION_END.test(line));
        if (end === -1) continue;

        markers.push({
            slot: match[2]!,
            indent: match[1]!,
            startLine: index,
            endLine: end,
        });
        index = end;
    }

    return markers;
}

/**
 * Merges `import { a } from 'x'` and `import { b } from 'x'` into one statement,
 * so a project with six blueprints does not open with six imports of the same
 * module. Anything that is not a recognisable import passes through untouched.
 */
export function mergeImports(statements: string[]): string[] {
    const named = new Map<string, Set<string>>();
    const defaults = new Map<string, string>();
    const sideEffects = new Set<string>();
    const passthrough: string[] = [];
    const order: string[] = [];

    const remember = (module: string) => {
        if (!order.includes(module)) order.push(module);
    };

    for (const statement of statements) {
        const trimmed = statement.trim();

        const sideEffect = /^import\s+['"]([^'"]+)['"];?$/.exec(trimmed);
        if (sideEffect) {
            sideEffects.add(sideEffect[1]!);
            remember(sideEffect[1]!);
            continue;
        }

        const parsed = /^import\s+(.+?)\s+from\s+['"]([^'"]+)['"];?$/.exec(trimmed);
        if (!parsed) {
            if (!passthrough.includes(trimmed)) passthrough.push(trimmed);
            continue;
        }

        const clause = parsed[1]!.trim();
        const module = parsed[2]!;

        // A namespace import cannot be merged with anything, so keep it verbatim
        // and do not claim the module — another import of it still merges.
        if (clause.startsWith('*')) {
            if (!passthrough.includes(trimmed)) passthrough.push(trimmed);
            continue;
        }

        remember(module);

        const braces = /^(?:([A-Za-z_$][\w$]*)\s*,\s*)?\{([^}]*)\}$/.exec(clause);
        if (braces) {
            if (braces[1]) defaults.set(module, braces[1]);
            const specifiers = named.get(module) ?? new Set<string>();
            for (const specifier of braces[2]!.split(',')) {
                const name = specifier.trim();
                if (name) specifiers.add(name);
            }
            named.set(module, specifiers);
            continue;
        }

        defaults.set(module, clause);
    }

    const merged = order.map((module) => {
        const specifiers = named.get(module);
        const defaultImport = defaults.get(module);

        if (!specifiers && !defaultImport) return `import '${module}';`;

        const clause = [
            defaultImport,
            specifiers && specifiers.size > 0
                ? `{ ${[...specifiers].sort().join(', ')} }`
                : undefined,
        ]
            .filter(Boolean)
            .join(', ');

        return `import ${clause} from '${module}';`;
    });

    return [...merged, ...passthrough];
}

/** Injects collected contributions into a file's slot regions. */
export function injectSlots(
    contents: string,
    contributions: Map<string, string[]>
): { contents: string; filled: string[]; missing: string[] } {
    const markers = findSlots(contents);
    if (markers.length === 0) {
        return { contents, filled: [], missing: [...contributions.keys()] };
    }

    const lines = contents.split('\n');
    const filled: string[] = [];
    const declared = new Set(markers.map((marker) => marker.slot));

    // Back to front, so earlier line numbers stay valid as we splice.
    for (const marker of [...markers].sort((a, b) => b.startLine - a.startLine)) {
        const values = contributions.get(marker.slot);
        if (!values || values.length === 0) continue;

        const deduped = [...new Set(values)];
        const body = marker.slot === 'imports' ? mergeImports(deduped) : deduped;
        const injected = body.flatMap((value) =>
            value.split('\n').map((line) => (line ? `${marker.indent}${line}` : line))
        );

        // A comment binds to the statement below it, so with the `#endregion`
        // marker sitting directly under the last import, formatters read the
        // file as imports followed immediately by code and demand a separating
        // blank line (`biome check` fails on it). Put it inside the region, so
        // it survives; normalise first, so re-injecting an already-filled
        // region on `atarashi add` does not stack blank lines.
        if (marker.slot === 'imports') {
            while (injected.length > 0 && injected[injected.length - 1]!.trim() === '') {
                injected.pop();
            }
            if (injected.length > 0) injected.push('');
        }

        lines.splice(marker.startLine + 1, marker.endLine - marker.startLine - 1, ...injected);
        filled.push(marker.slot);
    }

    return {
        contents: lines.join('\n'),
        filled,
        missing: [...contributions.keys()].filter((slot) => !declared.has(slot)),
    };
}
