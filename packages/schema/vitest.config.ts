import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        name: 'schema',
        include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
        environment: 'node',
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            // Barrels re-export and emit nothing of their own.
            exclude: ['src/index.ts'],
            reporter: ['text', 'html', 'lcov'],
            thresholds: {
                lines: 95,
                statements: 95,
                functions: 80,
                branches: 88,
            },
        },
    },
});
