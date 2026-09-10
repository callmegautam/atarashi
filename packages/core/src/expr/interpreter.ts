import type { JsonValue } from '@atarashi/schema';
import type { RenderContext } from '../context.js';
import type { Expr } from './ast.js';
import { parseExpression } from './parser.js';

export class ExpressionEvaluationError extends Error {
    readonly source: string;

    constructor(message: string, source: string) {
        super(`${message} in \`${source}\``);
        this.name = 'ExpressionEvaluationError';
        this.source = source;
    }
}

type Value = JsonValue | undefined;

/**
 * Answers are stored flat under dotted keys (`db.name`), but expressions read
 * naturally as `answers.db.name`. Try the flat key first — longest match wins —
 * then fall back to walking nested objects, so both shapes work.
 */
function readAnswer(answers: Record<string, JsonValue>, segments: string[]): Value {
    for (let i = segments.length; i > 0; i -= 1) {
        const key = segments.slice(0, i).join('.');
        if (Object.hasOwn(answers, key)) {
            return walk(answers[key], segments.slice(i));
        }
    }
    return undefined;
}

function walk(value: Value, segments: string[]): Value {
    let current = value;
    for (const segment of segments) {
        if (current === null || current === undefined || typeof current !== 'object') {
            return undefined;
        }
        if (Array.isArray(current)) return undefined;
        current = current[segment];
    }
    return current;
}

function resolvePath(segments: string[], context: RenderContext, source: string): Value {
    const [root, ...rest] = segments as [string, ...string[]];

    switch (root) {
        case 'answers':
            return readAnswer(context.answers, rest);
        case 'project':
            return walk(context.project as unknown as JsonValue, rest);
        case 'options':
            return walk(context.options as unknown as JsonValue, rest);
        case 'pm':
            return walk(context.pm as unknown as JsonValue, rest);
        default:
            throw new ExpressionEvaluationError(`Unknown binding \`${root}\``, source);
    }
}

function compare(operator: string, left: Value, right: Value, source: string): boolean {
    if (typeof left !== typeof right || (typeof left !== 'number' && typeof left !== 'string')) {
        throw new ExpressionEvaluationError(
            `\`${operator}\` needs two numbers or two strings, got ${typeof left} and ${typeof right}`,
            source
        );
    }
    const a = left as number | string;
    const b = right as number | string;
    switch (operator) {
        case '<':
            return a < b;
        case '<=':
            return a <= b;
        case '>':
            return a > b;
        default:
            return a >= b;
    }
}

function evaluateNode(node: Expr, context: RenderContext, source: string): Value {
    switch (node.kind) {
        case 'literal':
            return node.value;

        case 'path':
            return resolvePath(node.segments, context, source);

        case 'call':
            return node.callee === 'has'
                ? context.has(node.argument)
                : context.provides(node.argument);

        case 'unary': {
            const operand = evaluateNode(node.operand, context, source);
            if (node.operator === '!') return !truthy(operand);
            if (typeof operand !== 'number') {
                throw new ExpressionEvaluationError('Unary `-` needs a number', source);
            }
            return -operand;
        }

        case 'binary': {
            // Short-circuit before touching the right side.
            if (node.operator === '&&') {
                const left = evaluateNode(node.left, context, source);
                return truthy(left) ? evaluateNode(node.right, context, source) : left;
            }
            if (node.operator === '||') {
                const left = evaluateNode(node.left, context, source);
                return truthy(left) ? left : evaluateNode(node.right, context, source);
            }

            const left = evaluateNode(node.left, context, source);
            const right = evaluateNode(node.right, context, source);

            switch (node.operator) {
                case '===':
                    return left === right;
                case '!==':
                    return left !== right;
                case '<':
                case '<=':
                case '>':
                case '>=':
                    return compare(node.operator, left, right, source);
                case '+':
                    if (typeof left === 'string' || typeof right === 'string') {
                        return `${stringify(left)}${stringify(right)}`;
                    }
                    if (typeof left === 'number' && typeof right === 'number') return left + right;
                    throw new ExpressionEvaluationError(
                        '`+` needs two numbers or a string',
                        source
                    );
                case '-':
                    if (typeof left === 'number' && typeof right === 'number') return left - right;
                    throw new ExpressionEvaluationError('`-` needs two numbers', source);
                case 'in': {
                    if (Array.isArray(right)) return right.some((item) => item === left);
                    if (typeof right === 'string' && typeof left === 'string') {
                        return right.includes(left);
                    }
                    if (right !== null && typeof right === 'object' && typeof left === 'string') {
                        return Object.hasOwn(right, left);
                    }
                    throw new ExpressionEvaluationError(
                        '`in` needs an array, string or object on the right',
                        source
                    );
                }
                default:
                    throw new ExpressionEvaluationError(
                        `Unsupported operator \`${node.operator}\``,
                        source
                    );
            }
        }

        default:
            throw new ExpressionEvaluationError('Unsupported expression', source);
    }
}

const stringify = (value: Value): string =>
    value === null || value === undefined ? '' : String(value);

/** JS truthiness minus the surprises: an empty array and `{}` are falsy here. */
export function truthy(value: Value): boolean {
    if (value === undefined || value === null || value === false) return false;
    if (value === 0 || value === '') return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return Boolean(value);
}

/** Full value of an expression — used by helpers that need more than a boolean. */
export function evaluateExpression(source: string, context: RenderContext): Value {
    return evaluateNode(parseExpression(source), context, source);
}

/** The common case: does this `when` hold? */
export function evaluateCondition(source: string | undefined, context: RenderContext): boolean {
    if (source === undefined) return true;
    return truthy(evaluateExpression(source, context));
}
