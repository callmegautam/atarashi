import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        name: 'core',
        include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
        environment: 'node',
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            // Barrels re-export; type-only modules emit nothing. Neither can be
            // covered, and counting them would only dilute the number.
            exclude: ['src/**/index.ts', 'src/types.ts', 'src/context.ts'],
            reporter: ['text', 'html', 'lcov'],
            thresholds: {
                lines: 90,
                statements: 90,
                functions: 90,
                branches: 85,
            },
        },
    },
});
