export interface FlagSpec {
    /** Long form, e.g. `--dry-run`. */
    flag: string;
    alias?: string;
    takesValue: boolean;
    /** `--add`/`--remove`/`--set`: repeatable and comma-splittable. */
    collect?: boolean;
}

export interface RawParse {
    opts: Record<string, string | boolean | string[]>;
    positionals: string[];
    /** Tokens matching nothing in the table — candidate blueprint-declared flags. */
    unknown: string[];
}

const camel = (flag: string): string =>
    flag
        .replace(/^--?(no-)?/, '')
        .replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());

/**
 * A hand-rolled parser for commands whose flag surface is only partly known
 * ahead of time (`new`, `add` — the rest comes from whichever blueprints get
 * resolved). Doing this ourselves, once, is far less fragile than coaxing a
 * framework's option parser into tolerating flags it has never heard of.
 */
export function parseRawArgs(argv: string[], table: FlagSpec[]): RawParse {
    const byToken = new Map<string, FlagSpec>();
    for (const spec of table) {
        byToken.set(spec.flag, spec);
        if (spec.alias) byToken.set(spec.alias, spec);
    }

    const opts: Record<string, string | boolean | string[]> = {};
    const positionals: string[] = [];
    const unknown: string[] = [];

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index]!;

        if (!token.startsWith('-')) {
            positionals.push(token);
            continue;
        }

        const eq = token.indexOf('=');
        const flagPart = eq !== -1 ? token.slice(0, eq) : token;
        const spec = byToken.get(flagPart);

        if (!spec) {
            unknown.push(token);
            const next = argv[index + 1];
            if (eq === -1 && next !== undefined && !next.startsWith('-')) {
                unknown.push(next);
                index += 1;
            }
            continue;
        }

        const name = camel(spec.flag);
        if (!spec.takesValue) {
            opts[name] = !spec.flag.startsWith('--no-');
            continue;
        }

        let value: string;
        if (eq !== -1) {
            value = token.slice(eq + 1);
        } else {
            value = argv[index + 1] ?? '';
            index += 1;
        }

        if (spec.collect) {
            const list = (opts[name] as string[] | undefined) ?? [];
            list.push(
                ...value
                    .split(',')
                    .map((entry) => entry.trim())
                    .filter(Boolean)
            );
            opts[name] = list;
        } else {
            opts[name] = value;
        }
    }

    return { opts, positionals, unknown };
}
