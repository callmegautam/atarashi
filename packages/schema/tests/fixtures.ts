import type { JsonValue } from '../src/index.js';

export const validBlueprint = () => ({
    manifestVersion: 1,
    id: 'db/postgres',
    name: 'PostgreSQL',
    version: '1.0.0',
    description: 'PostgreSQL connection with pooling and health check.',
    category: 'database',
    tags: ['sql', 'postgres'],
    provides: ['database', 'database:sql'],
    requires: ['runtime:node'],
    conflicts: ['database'],
    after: ['core/node-ts'],
    priority: 50,
    engines: { atarashi: '>=1.0.0 <2.0.0', node: '>=20' },
    prompts: [
        {
            name: 'db.name',
            type: 'input',
            message: 'Database name',
            default: '{{ project.slug }}',
            flag: '--db-name',
            validate: { pattern: '^[a-z][a-z0-9_]*$', message: 'lowercase and underscores' },
        },
        {
            name: 'db.migrationTool',
            type: 'select',
            message: 'Migration tool',
            choices: [
                { value: 'drizzle-kit', label: 'Drizzle Kit', when: "has('orm/drizzle')" },
                { value: 'none', label: 'None' },
            ],
            default: 'none',
            flag: '--migrations',
        },
    ],
    files: [
        { from: 'files/src/db/index.ts.hbs', to: 'src/db/index.ts' },
        { from: 'files/src/db/pool.ts.hbs', to: 'src/db/pool.ts', when: 'answers.usePool' },
        { from: 'files/seed.sql', to: 'db/seed.sql', render: false },
    ],
    dependencies: { pg: '^8.14.1' },
    devDependencies: { '@types/pg': '^8.11.0' },
    scripts: { 'db:up': 'docker compose up -d db' },
    env: [
        {
            key: 'DATABASE_URL',
            sample: 'postgresql://postgres:postgres@localhost:5432/{{ answers.db.name }}',
            description: 'PostgreSQL connection string',
            required: true,
            secret: true,
            schema: 'z.string().url()',
        },
    ],
    contributions: [
        { target: 'src/app.ts', slot: 'imports', value: "import { db } from '@/db';" },
        {
            target: 'tsconfig.json',
            merge: 'json-deep',
            value: { compilerOptions: { types: ['pg'] } } as JsonValue,
        },
    ],
    gitignore: ['/pgdata'],
    nextSteps: ['Start the database:  {{ pm.run }} db:up'],
});

export const validPreset = () => ({
    manifestVersion: 1,
    kind: 'preset',
    id: 'preset/backend-ts',
    name: 'TypeScript REST API',
    description: 'Express + TypeScript + Postgres + Drizzle + JWT + Docker',
    recommended: true,
    blueprints: ['core/node-ts', 'http/express', 'db/postgres'],
    answers: { 'db.usePool': true },
});

export const validSpec = () => ({
    specVersion: 1,
    name: 'my-api',
    targetDir: '/tmp/my-api',
    blueprints: [
        { id: 'core/node-ts' },
        { id: 'db/postgres', reason: 'auto', requiredBy: 'orm/drizzle' },
    ],
    answers: { 'db.name': 'my_api' },
    options: { packageManager: 'pnpm', git: true },
});
