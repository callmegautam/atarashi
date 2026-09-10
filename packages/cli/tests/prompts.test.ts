import type { Prompt } from '@atarashi/schema';
import { describe, expect, it } from 'vitest';
import { CliUsageError } from '../src/errors.js';
import { type DeclaredPrompt, parseDeclaredFlags, validateAnswer } from '../src/prompts.js';

const dbName: DeclaredPrompt = {
    name: 'db.name',
    type: 'input',
    message: 'Database name',
    flag: '--db-name',
    validate: {
        pattern: '^[a-z][a-z0-9_]*$',
        message: 'lowercase letters, digits and underscores',
    },
    secret: false,
    blueprintId: 'db/postgres',
};

const dbPool: DeclaredPrompt = {
    name: 'db.pool',
    type: 'confirm',
    message: 'Use a connection pool?',
    default: true,
    flag: '--db-pool',
    secret: false,
    blueprintId: 'db/postgres',
};

const migrationTool: DeclaredPrompt = {
    name: 'migrationTool',
    type: 'select',
    message: 'Migration tool',
    choices: [
        { value: 'drizzle-kit', label: 'Drizzle Kit' },
        { value: 'none', label: 'None' },
    ],
    secret: false,
    blueprintId: 'orm/drizzle',
};

describe('parseDeclaredFlags', () => {
    it('matches a declared --flag value pair and leaves the rest unknown', () => {
        const { answers, unknown } = parseDeclaredFlags(
            ['--db-name', 'my_app', '--totally-unrelated', 'x'],
            [dbName, dbPool]
        );
        expect(answers).toEqual({ 'db.name': 'my_app' });
        expect(unknown).toEqual(['--totally-unrelated', 'x']);
    });

    it('a bare confirm flag defaults to true without consuming the next token', () => {
        const { answers, unknown } = parseDeclaredFlags(
            ['--db-pool', '--db-name', 'app'],
            [dbName, dbPool]
        );
        expect(answers).toEqual({ 'db.pool': true, 'db.name': 'app' });
        expect(unknown).toEqual([]);
    });

    it('the = form works for both known static and prompt flags', () => {
        const { answers } = parseDeclaredFlags(['--db-name=app'], [dbName]);
        expect(answers).toEqual({ 'db.name': 'app' });
    });

    it('rejects a value that fails the declared validate pattern', () => {
        expect(() => parseDeclaredFlags(['--db-name', 'Not Valid'], [dbName])).toThrow(
            CliUsageError
        );
    });

    it('rejects a select value outside its declared choices', () => {
        expect(() => parseDeclaredFlags([], [migrationTool], ['migrationTool=knex'])).toThrow(
            CliUsageError
        );
    });

    it('--set answers a prompt with no dedicated flag', () => {
        const { answers } = parseDeclaredFlags([], [migrationTool], ['migrationTool=drizzle-kit']);
        expect(answers).toEqual({ migrationTool: 'drizzle-kit' });
    });

    it('--set on an unknown prompt name is a usage error', () => {
        expect(() => parseDeclaredFlags([], [dbName], ['nope=1'])).toThrow(CliUsageError);
    });
});

describe('validateAnswer', () => {
    it('accepts a value matching the pattern', () => {
        expect(() => validateAnswer(dbName as unknown as Prompt, 'my_app')).not.toThrow();
    });

    it('accepts any of the declared choices', () => {
        expect(() => validateAnswer(migrationTool as unknown as Prompt, 'none')).not.toThrow();
    });
});
