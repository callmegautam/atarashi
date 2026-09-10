import { describe, expect, it } from 'vitest';
import { NEW_FLAGS } from '../src/command-flags.js';
import { parseRawArgs } from '../src/raw-args.js';

describe('parseRawArgs', () => {
    it('parses boolean flags without consuming the next token', () => {
        const { opts, positionals } = parseRawArgs(['my-api', '--yes', '--dry-run'], NEW_FLAGS);
        expect(opts.yes).toBe(true);
        expect(opts.dryRun).toBe(true);
        expect(positionals).toEqual(['my-api']);
    });

    it('parses value flags, including the = form', () => {
        const { opts } = parseRawArgs(['--preset', 'backend-ts', '--dir=./here'], NEW_FLAGS);
        expect(opts.preset).toBe('backend-ts');
        expect(opts.dir).toBe('./here');
    });

    it('negated flags (--no-x) resolve to false under the base key', () => {
        const { opts } = parseRawArgs(['--no-git', '--no-install'], NEW_FLAGS);
        expect(opts.git).toBe(false);
        expect(opts.install).toBe(false);
    });

    it('collects repeatable, comma-splittable flags', () => {
        const { opts } = parseRawArgs(
            ['--add', 'db/postgres,orm/drizzle', '--add', 'auth/jwt'],
            NEW_FLAGS
        );
        expect(opts.add).toEqual(['db/postgres', 'orm/drizzle', 'auth/jwt']);
    });

    it('routes unrecognized flags (and their inline value) to unknown', () => {
        const { unknown, positionals } = parseRawArgs(
            ['my-api', '--db-name', 'my_app', '--db-pool'],
            NEW_FLAGS
        );
        expect(positionals).toEqual(['my-api']);
        expect(unknown).toEqual(['--db-name', 'my_app', '--db-pool']);
    });

    it('does not swallow a positional that follows an unknown boolean-like flag', () => {
        const { unknown, positionals } = parseRawArgs(['--db-pool', 'my-api'], NEW_FLAGS);
        // the raw parser cannot know db-pool takes no value ahead of resolving
        // the blueprint graph, so it conservatively pairs it with the next
        // token — parseDeclaredFlags resolves this once prompt types are known.
        expect(unknown).toEqual(['--db-pool', 'my-api']);
        expect(positionals).toEqual([]);
    });

    it('an aliased short flag behaves like its long form', () => {
        const { opts } = parseRawArgs(['-y', '-p', 'backend-ts'], NEW_FLAGS);
        expect(opts.yes).toBe(true);
        expect(opts.preset).toBe('backend-ts');
    });
});
