import { CliUsageError } from './errors.js';

export interface ShorthandFlags {
    runtime?: string;
    http?: string;
    db?: string;
    orm?: string;
    auth?: string;
    ci?: string;
    docker?: boolean;
    tests?: string;
    lint?: string;
}

const MAPS: Record<string, Record<string, string | null>> = {
    http: { express: 'http/express', fastify: 'http/fastify', hono: 'http/hono', none: null },
    db: {
        postgres: 'db/postgres',
        mysql: 'db/mysql',
        mongodb: 'db/mongodb',
        sqlite: 'db/sqlite',
        none: null,
    },
    orm: { drizzle: 'orm/drizzle', prisma: 'orm/prisma', mongoose: 'orm/mongoose', none: null },
    auth: { jwt: 'auth/jwt', session: 'auth/session', none: null },
    ci: { github: 'ci/github', gitlab: 'ci/gitlab', none: null },
    tests: { vitest: 'test/vitest', jest: 'test/jest', none: null },
    lint: { eslint: 'lint/eslint-prettier', biome: 'lint/biome', none: null },
};

/**
 * Sugar over `--add`/`--remove` — doc 04 § `atarashi new` › Shorthands. Only
 * `runtime node` is backed by a real blueprint today (`bun`/`deno` have no
 * first-party `core/*` blueprint in the v1 catalogue yet).
 */
export function expandShorthand(flags: ShorthandFlags): { add: string[]; remove: string[] } {
    const add: string[] = [];
    const remove: string[] = [];

    if (flags.runtime !== undefined && flags.runtime !== 'node') {
        throw new CliUsageError(
            `--runtime ${flags.runtime} is not available yet — only "node" has a core blueprint in this catalogue`
        );
    }

    for (const [flag, map] of Object.entries(MAPS)) {
        const value = (flags as Record<string, string | undefined>)[flag];
        if (value === undefined) continue;
        if (!(value in map)) {
            throw new CliUsageError(
                `--${flag} ${value} is not one of: ${Object.keys(map).join(', ')}`
            );
        }
        const id = map[value];
        if (id) add.push(id);
    }

    if (flags.docker === true) add.push('infra/docker');
    if (flags.docker === false) remove.push('infra/docker');

    return { add, remove };
}
