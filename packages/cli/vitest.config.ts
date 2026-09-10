import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        name: 'cli',
        include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
        environment: 'node',
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            // Command modules are integration surface: they shell out, prompt
            // and write to disk, and are covered by the e2e matrix rather than
            // here. What is gated is the pure logic they are built from.
            exclude: [
                'src/index.ts',
                'src/cli.ts',
                'src/commands/**',
                'src/wizard.ts',
                'src/telemetry.ts',
                'src/engine.ts',
                'src/update-notifier.ts',
                'src/registry-context.ts',
                'src/project-options.ts',
                'src/package-manager.ts',
                'src/legacy-aliases.ts',
            ],
            reporter: ['text', 'html', 'lcov'],
            thresholds: {
                lines: 80,
                statements: 80,
                functions: 70,
                branches: 80,
            },
        },
    },
});
