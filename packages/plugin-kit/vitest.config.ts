import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        name: 'plugin-kit',
        include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
        environment: 'node',
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/index.ts'],
            reporter: ['text', 'html', 'lcov'],
            thresholds: {
                lines: 93,
                statements: 93,
                functions: 95,
                branches: 84,
            },
        },
    },
});
