import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        name: 'registry',
        include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
        environment: 'node',
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/index.ts', 'src/loaders/index.ts'],
            reporter: ['text', 'html', 'lcov'],
            thresholds: {
                lines: 88,
                statements: 88,
                functions: 88,
                branches: 85,
            },
        },
    },
});
