import type { JsonValue } from '@atarashi/schema';
import type { RenderContext } from '../src/context.js';

export function makeContext(overrides: Partial<RenderContext> = {}): RenderContext {
    const ids = new Set(overrides.blueprints?.map((b) => b.id) ?? []);
    const capabilities = new Set<string>();

    return {
        project: {
            name: 'my-api',
            slug: 'my-api',
            pascal: 'MyApi',
            camel: 'myApi',
            kebab: 'my-api',
            constant: 'MY_API',
            description: '',
            year: 2026,
        },
        answers: {} as Record<string, JsonValue>,
        options: {
            packageManager: 'pnpm',
            git: true,
            install: true,
            format: true,
            initialCommit: true,
            license: 'MIT',
            author: null,
            writeEnv: false,
            force: false,
        },
        pm: {
            name: 'pnpm',
            install: 'pnpm install',
            run: 'pnpm run',
            exec: 'pnpm dlx',
            add: 'pnpm add',
            addDev: 'pnpm add -D',
            lockfile: 'pnpm-lock.yaml',
        },
        blueprints: [],
        atarashi: { version: '1.0.0', generatedAt: '2026-09-07T00:00:00.000Z' },
        has: (id: string) => ids.has(id),
        provides: (capability: string) => capabilities.has(capability),
        ...overrides,
    };
}
