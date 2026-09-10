import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        name: 'blueprints',
        include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
        environment: 'node',
    },
});
