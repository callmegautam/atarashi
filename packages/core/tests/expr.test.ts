import { describe, expect, it } from 'vitest';
import {
    ExpressionEvaluationError,
    ExpressionSyntaxError,
    evaluateCondition,
    evaluateExpression,
    parseExpression,
    truthy,
} from '../src/expr/index.js';
import { makeContext } from './helpers.js';

const ctx = makeContext({
    answers: {
        'db.usePool': true,
        'db.name': 'my_api',
        'db.replicas': 3,
        'auth.strategies': ['jwt', 'session'],
        empty: '',
    },
    blueprints: [
        { id: 'orm/drizzle', version: '1.0.0' },
        { id: 'db/postgres', version: '1.0.0' },
    ],
    has: (id) => ['orm/drizzle', 'db/postgres'].includes(id),
    provides: (cap) => ['database', 'database:sql'].includes(cap),
});

const evaluate = (source: string) => evaluateExpression(source, ctx);

describe('literals and bindings', () => {
    it.each([
        ["'postgres'", 'postgres'],
        ['42', 42],
        ['4.5', 4.5],
        ['true', true],
        ['false', false],
        ['null', null],
        ['answers.db.usePool', true],
        ['answers.db.name', 'my_api'],
        ['answers.missing', undefined],
        ['project.slug', 'my-api'],
        ['project.pascal', 'MyApi'],
        ['options.packageManager', 'pnpm'],
        ['pm.run', 'pnpm run'],
    ])('evaluates %s', (source, expected) => {
        expect(evaluate(source)).toEqual(expected);
    });

    it('reads dotted answer keys and nested objects alike', () => {
        const nested = makeContext({ answers: { db: { name: 'nested_api' } } });
        expect(evaluateExpression('answers.db.name', nested)).toBe('nested_api');
        expect(evaluate('answers.db.name')).toBe('my_api');
    });
});

describe('operators', () => {
    it.each([
        ["answers.db.name === 'my_api'", true],
        ["answers.db.name !== 'my_api'", false],
        ['answers.db.replicas > 2', true],
        ['answers.db.replicas >= 3', true],
        ['answers.db.replicas < 3', false],
        ['answers.db.replicas <= 3', true],
        ['answers.db.replicas + 1', 4],
        ['answers.db.replicas - 1', 2],
        ['-answers.db.replicas', -3],
        ['!answers.db.usePool', false],
        ['!!answers.db.usePool', true],
        ["'jwt' in answers.auth.strategies", true],
        ["'oauth' in answers.auth.strategies", false],
        ["has('orm/drizzle')", true],
        ["has('orm/prisma')", false],
        ["provides('database:sql')", true],
        ["provides('database:document')", false],
        ["answers.db.usePool && has('db/postgres')", true],
        ["answers.db.usePool && has('orm/prisma')", false],
        ["has('orm/prisma') || answers.db.usePool", true],
        ["(answers.db.replicas > 1) && (answers.db.name === 'my_api')", true],
        ["'a' + 'b'", 'ab'],
        ["'n=' + answers.db.replicas", 'n=3'],
    ])('evaluates %s to %j', (source, expected) => {
        expect(evaluate(source)).toEqual(expected);
    });

    it('respects precedence: && binds tighter than ||', () => {
        expect(evaluate('true || false && false')).toBe(true);
        expect(evaluate('(true || false) && false')).toBe(false);
    });

    it('short-circuits && without evaluating the right side', () => {
        // `answers.missing.deeper` would be undefined, not an error, either way —
        // what matters is that a type error on the right never fires.
        expect(evaluate("has('orm/prisma') && (1 - 'x')")).toBe(false);
    });

    it('short-circuits || the same way', () => {
        expect(evaluate("has('db/postgres') || (1 - 'x')")).toBe(true);
    });
});

describe('truthiness', () => {
    it.each([
        [undefined, false],
        [null, false],
        [false, false],
        [0, false],
        ['', false],
        [[], false],
        [{}, false],
        [true, true],
        [1, true],
        ['x', true],
        [['a'], true],
        [{ a: 1 }, true],
    ])('treats %j as %s', (value, expected) => {
        expect(truthy(value as never)).toBe(expected);
    });

    it('treats a missing answer as false rather than throwing', () => {
        expect(evaluateCondition('answers.nobodySetThis', ctx)).toBe(false);
    });

    it('treats an absent condition as true', () => {
        expect(evaluateCondition(undefined, ctx)).toBe(true);
    });
});

describe('syntax errors name the position and the fix', () => {
    it.each([
        ['answers.db.name == "x"', 'Use `===`'],
        ['answers.db.name != "x"', 'Use `!=='],
        ['eval("rm -rf /")', 'Unknown function'],
        ['process.env.HOME', 'Unknown binding'],
        ['answers.db.name.toUpperCase()', 'Method calls are not allowed'],
        ["has('a', 'b')", 'exactly one argument'],
        ['has(answers.db.name)', 'one string literal'],
        ['answers.db.name &&', 'Unexpected end'],
        ['(answers.db.usePool', 'Expected `)`'],
        ["'unterminated", 'Unterminated string'],
        ['answers.db.usePool answers.db.name', 'after a complete expression'],
        ['answers', 'reference a property'],
        ['@', 'Unexpected character'],
    ])('rejects %j with %j', (source, fragment) => {
        expect(() => parseExpression(source)).toThrow(ExpressionSyntaxError);
        expect(() => parseExpression(source)).toThrow(fragment);
    });

    it('includes the offending source in the message', () => {
        expect(() => parseExpression('@')).toThrow('`@`');
    });
});

describe('evaluation errors', () => {
    it.each([
        ['answers.db.name > 3', '`>` needs two numbers'],
        ["1 - 'x'", '`-` needs two numbers'],
        ["'x' in 3", '`in` needs an array'],
        ['-answers.db.name', 'Unary `-` needs a number'],
    ])('rejects %j', (source, fragment) => {
        expect(() => evaluate(source)).toThrow(ExpressionEvaluationError);
        expect(() => evaluate(source)).toThrow(fragment);
    });
});

describe('the language stays non-Turing-complete', () => {
    it.each([
        'answers.x = 1',
        'function() {}',
        'while (true) {}',
        '[1, 2, 3]',
        '{ a: 1 }',
        'answers[0]',
        'globalThis',
        'require("fs")',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: this is the point of the test
        '`${answers.db.name}`',
        'answers.db.name ? 1 : 2',
    ])('refuses to parse %j', (source) => {
        expect(() => parseExpression(source)).toThrow();
    });

    it('never reaches host globals even when a binding shares their name', () => {
        expect(() => parseExpression('constructor.constructor("return 1")()')).toThrow(
            'Unknown binding'
        );
    });
});

describe('parser hardening', () => {
    it('handles deeply nested parentheses without blowing up', () => {
        const source = `${'('.repeat(50)}true${')'.repeat(50)}`;
        expect(evaluate(source)).toBe(true);
    });

    it('handles long operator chains', () => {
        const source = Array.from({ length: 200 }, () => 'true').join(' && ');
        expect(evaluate(source)).toBe(true);
    });

    it.each([
        '',
        ' ',
        '((',
        '))',
        '&&',
        '!',
        '...',
        'answers..name',
        'answers.',
        "has(''",
        '- -',
        '1 1',
        "'a' 'b'",
    ])('rejects the malformed input %j without hanging', (source) => {
        expect(() => parseExpression(source)).toThrow();
    });

    it('caches parses so repeated evaluation is cheap', () => {
        expect(parseExpression('answers.db.usePool')).toBe(parseExpression('answers.db.usePool'));
    });
});
