export type TokenType =
    | 'identifier'
    | 'string'
    | 'number'
    | 'boolean'
    | 'null'
    | 'operator'
    | 'punct'
    | 'eof';

export interface Token {
    type: TokenType;
    value: string;
    /** 0-based offset into the source, used to point at the failing character. */
    start: number;
}

export class ExpressionSyntaxError extends Error {
    readonly source: string;
    readonly position: number;

    constructor(message: string, source: string, position: number) {
        super(`${message} at position ${position} in \`${source}\``);
        this.name = 'ExpressionSyntaxError';
        this.source = source;
        this.position = position;
    }
}

/** Longest-first so `===` never lexes as `==` and `<=` never as `<`. */
const OPERATORS = ['===', '!==', '&&', '||', '<=', '>=', '!', '<', '>', '+', '-'];

const isIdentifierStart = (c: string) => /[A-Za-z_$]/.test(c);
const isIdentifierPart = (c: string) => /[A-Za-z0-9_$]/.test(c);
const isDigit = (c: string) => c >= '0' && c <= '9';

export function tokenize(source: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;

    while (i < source.length) {
        const char = source[i]!;

        if (/\s/.test(char)) {
            i += 1;
            continue;
        }

        if (char === '(' || char === ')' || char === ',' || char === '.') {
            tokens.push({ type: 'punct', value: char, start: i });
            i += 1;
            continue;
        }

        if (char === "'" || char === '"') {
            const quote = char;
            const start = i;
            i += 1;
            let value = '';
            while (i < source.length && source[i] !== quote) {
                if (source[i] === '\\') {
                    const next = source[i + 1];
                    if (next === undefined) {
                        throw new ExpressionSyntaxError('Unterminated escape', source, i);
                    }
                    value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
                    i += 2;
                    continue;
                }
                value += source[i];
                i += 1;
            }
            if (i >= source.length) {
                throw new ExpressionSyntaxError('Unterminated string literal', source, start);
            }
            i += 1; // closing quote
            tokens.push({ type: 'string', value, start });
            continue;
        }

        if (isDigit(char)) {
            const start = i;
            while (i < source.length && (isDigit(source[i]!) || source[i] === '.')) i += 1;
            const raw = source.slice(start, i);
            if (!/^\d+(\.\d+)?$/.test(raw)) {
                throw new ExpressionSyntaxError(`Invalid number \`${raw}\``, source, start);
            }
            tokens.push({ type: 'number', value: raw, start });
            continue;
        }

        if (isIdentifierStart(char)) {
            const start = i;
            while (i < source.length && isIdentifierPart(source[i]!)) i += 1;
            const raw = source.slice(start, i);
            if (raw === 'true' || raw === 'false') {
                tokens.push({ type: 'boolean', value: raw, start });
            } else if (raw === 'null') {
                tokens.push({ type: 'null', value: raw, start });
            } else if (raw === 'in') {
                tokens.push({ type: 'operator', value: 'in', start });
            } else {
                tokens.push({ type: 'identifier', value: raw, start });
            }
            continue;
        }

        const operator = OPERATORS.find((op) => source.startsWith(op, i));
        if (operator) {
            // `==` and `!=` are a common slip; say so instead of "unexpected character".
            if (
                (operator === '!' || operator === '<' || operator === '>') &&
                source[i + 1] === '='
            ) {
                if (operator === '!') {
                    throw new ExpressionSyntaxError(
                        'Use `!==` for inequality, not `!=`',
                        source,
                        i
                    );
                }
            }
            tokens.push({ type: 'operator', value: operator, start: i });
            i += operator.length;
            continue;
        }

        if (char === '=' && source.startsWith('==', i)) {
            throw new ExpressionSyntaxError('Use `===` for equality, not `==`', source, i);
        }

        throw new ExpressionSyntaxError(`Unexpected character \`${char}\``, source, i);
    }

    tokens.push({ type: 'eof', value: '', start: source.length });
    return tokens;
}
