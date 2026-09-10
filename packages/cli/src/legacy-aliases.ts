/**
 * v0.6 template-name compatibility, doc 10 § Breaking changes for users. Kept
 * for one minor cycle and removed in v1.2.
 */
export interface LegacyAlias {
    preset: string;
    add: string[];
    /**
     * Blueprints the target preset already carries that the old template did
     * not. `backend-ts` ships Postgres, so mapping `backend-mysql` onto it
     * without dropping that produces two databases and a conflict.
     */
    remove: string[];
}

const ALIASES: Record<string, LegacyAlias> = {
    // `backend-ts` already provides Postgres and Drizzle, so this one is a
    // straight rename.
    'backend-pgsql': { preset: 'backend-ts', add: [], remove: [] },
    'backend-mysql': {
        preset: 'backend-ts',
        add: ['db/mysql'],
        remove: ['db/postgres'],
    },
    'backend-mongo': {
        preset: 'backend-ts',
        add: ['db/mongodb', 'orm/mongoose'],
        remove: ['db/postgres', 'orm/drizzle'],
    },
    'angular-tailwind': { preset: 'fullstack-angular', add: [], remove: [] },
};

export function resolveLegacyPreset(input: string): LegacyAlias & { notice?: string } {
    const alias = ALIASES[input];
    if (!alias) return { preset: input, add: [], remove: [] };

    const flags = [
        alias.add.length > 0 ? ` --add ${alias.add.join(',')}` : '',
        alias.remove.length > 0 ? ` --remove ${alias.remove.join(',')}` : '',
    ].join('');
    const changes = [...alias.remove.map((id) => `-${id}`), ...alias.add.map((id) => `+${id}`)];

    return {
        ...alias,
        notice: [
            `\`${input}\` is now the \`${alias.preset}\` preset${changes.length ? ` (${changes.join(', ')})` : ''}.`,
            `  Run:  atarashi new <name> --preset ${alias.preset}${flags}`,
            '  Continuing with the equivalent configuration…',
        ].join('\n'),
    };
}
