import { describe, expect, it } from 'vitest';
import {
    ExpressionEvaluationError,
    ExpressionSyntaxError,
    evaluateExpression,
    parseExpression,
} from '../src/expr/index.js';
import { makeContext } from './helpers.js';

/**
 * Deterministic PRNG so a failure is reproducible from the seed printed in the
 * assertion message.
 */
function makeRandom(seed: number) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x1_0000_0000;
    };
}

const ALPHABET = [
    'answers',
    'project',
    'options',
    'pm',
    'has',
    'provides',
    'true',
    'false',
    'null',
    '.',
    '(',
    ')',
    ',',
    "'x'",
    '"y"',
    '1',
    '2.5',
    '&&',
    '||',
    '===',
    '!==',
    '<',
    '>=',
    '+',
    '-',
    '!',
    'in',
    ' ',
    '@',
    '$',
    '{',
    '}',
    '[',
    ']',
    '`',
    '\\',
    '=',
    ';',
    'name',
    'slug',
];

const ctx = makeContext({ answers: { a: 1, b: 'two', c: true } });

describe('expression fuzzing', () => {
    it('never throws anything but our own error types, and never hangs', () => {
        const random = makeRandom(20260907);

        for (let iteration = 0; iteration < 4000; iteration += 1) {
            const length = 1 + Math.floor(random() * 12);
            const source = Array.from(
                { length },
                () => ALPHABET[Math.floor(random() * ALPHABET.length)]
            ).join('');

            const started = Date.now();
            try {
                evaluateExpression(source, ctx);
            } catch (error) {
                const expected =
                    error instanceof ExpressionSyntaxError ||
                    error instanceof ExpressionEvaluationError;
                expect(expected, `unexpected ${(error as Error).name} for \`${source}\``).toBe(
                    true
                );
            }
            expect(Date.now() - started, `slow parse for \`${source}\``).toBeLessThan(250);
        }
    });

    it('is stable: parsing the same source twice gives the same outcome', () => {
        const random = makeRandom(7);
        for (let iteration = 0; iteration < 500; iteration += 1) {
            const length = 1 + Math.floor(random() * 8);
            const source = Array.from(
                { length },
                () => ALPHABET[Math.floor(random() * ALPHABET.length)]
            ).join(' ');

            const first = safeParse(source);
            const second = safeParse(source);
            expect(second).toEqual(first);
        }
    });
});

function safeParse(source: string): string {
    try {
        return JSON.stringify(parseExpression(source));
    } catch (error) {
        return `error:${(error as Error).message}`;
    }
}
