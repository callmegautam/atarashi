import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        name: 'testing',
        include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
        environment: 'node',
    },
});
