import { BINDING_ROOTS, type BinaryOperator, CALLABLES, type Expr } from './ast.js';
import { ExpressionSyntaxError, type Token, tokenize } from './lexer.js';

/** Binding power per operator, lowest first. Everything is left-associative. */
const PRECEDENCE: Record<string, number> = {
    '||': 1,
    '&&': 2,
    '===': 3,
    '!==': 3,
    in: 3,
    '<': 4,
    '<=': 4,
    '>': 4,
    '>=': 4,
    '+': 5,
    '-': 5,
};

class Parser {
    private index = 0;

    constructor(
        private readonly tokens: Token[],
        private readonly source: string
    ) {}

    parse(): Expr {
        const expr = this.parseBinary(0);
        const token = this.peek();
        if (token.type !== 'eof') {
            throw new ExpressionSyntaxError(
                `Unexpected \`${token.value}\` after a complete expression`,
                this.source,
                token.start
            );
        }
        return expr;
    }

    private peek(): Token {
        return this.tokens[this.index]!;
    }

    private next(): Token {
        return this.tokens[this.index++]!;
    }

    private parseBinary(minPrecedence: number): Expr {
        let left = this.parseUnary();

        for (;;) {
            const token = this.peek();
            if (token.type !== 'operator') break;
            const precedence = PRECEDENCE[token.value];
            if (precedence === undefined || precedence < minPrecedence) break;

            this.next();
            const right = this.parseBinary(precedence + 1);
            left = { kind: 'binary', operator: token.value as BinaryOperator, left, right };
        }

        return left;
    }

    private parseUnary(): Expr {
        const token = this.peek();
        if (token.type === 'operator' && (token.value === '!' || token.value === '-')) {
            this.next();
            return { kind: 'unary', operator: token.value, operand: this.parseUnary() };
        }
        return this.parsePrimary();
    }

    private parsePrimary(): Expr {
        const token = this.next();

        if (token.type === 'punct' && token.value === '(') {
            const expr = this.parseBinary(0);
            const close = this.next();
            if (close.type !== 'punct' || close.value !== ')') {
                throw new ExpressionSyntaxError('Expected `)`', this.source, close.start);
            }
            return expr;
        }

        if (token.type === 'string') return { kind: 'literal', value: token.value };
        if (token.type === 'number') return { kind: 'literal', value: Number(token.value) };
        if (token.type === 'boolean') return { kind: 'literal', value: token.value === 'true' };
        if (token.type === 'null') return { kind: 'literal', value: null };

        if (token.type === 'identifier') {
            const isCall = this.peek().type === 'punct' && this.peek().value === '(';
            if (isCall) return this.parseCall(token);
            return this.parsePath(token);
        }

        throw new ExpressionSyntaxError(
            token.type === 'eof' ? 'Unexpected end of expression' : `Unexpected \`${token.value}\``,
            this.source,
            token.start
        );
    }

    private parseCall(callee: Token): Expr {
        if (!(CALLABLES as readonly string[]).includes(callee.value)) {
            throw new ExpressionSyntaxError(
                `Unknown function \`${callee.value}\`; only ${CALLABLES.join('() and ')}() are available`,
                this.source,
                callee.start
            );
        }

        this.next(); // '('
        const argument = this.next();
        if (argument.type !== 'string') {
            throw new ExpressionSyntaxError(
                `\`${callee.value}()\` takes one string literal`,
                this.source,
                argument.start
            );
        }
        const close = this.next();
        if (close.type !== 'punct' || close.value !== ')') {
            throw new ExpressionSyntaxError(
                `\`${callee.value}()\` takes exactly one argument`,
                this.source,
                close.start
            );
        }

        return {
            kind: 'call',
            callee: callee.value as 'has' | 'provides',
            argument: argument.value,
        };
    }

    private parsePath(head: Token): Expr {
        if (!(BINDING_ROOTS as readonly string[]).includes(head.value)) {
            throw new ExpressionSyntaxError(
                `Unknown binding \`${head.value}\`; available bindings are ${BINDING_ROOTS.join(', ')}`,
                this.source,
                head.start
            );
        }

        const segments = [head.value];
        while (this.peek().type === 'punct' && this.peek().value === '.') {
            this.next();
            const segment = this.next();
            if (segment.type !== 'identifier') {
                throw new ExpressionSyntaxError(
                    'Expected a property name after `.`',
                    this.source,
                    segment.start
                );
            }
            if (this.peek().type === 'punct' && this.peek().value === '(') {
                throw new ExpressionSyntaxError(
                    'Method calls are not allowed in `when` expressions',
                    this.source,
                    this.peek().start
                );
            }
            segments.push(segment.value);
        }

        if (segments.length === 1) {
            throw new ExpressionSyntaxError(
                `\`${head.value}\` is an object; reference a property such as \`${head.value}.something\``,
                this.source,
                head.start
            );
        }

        return { kind: 'path', segments };
    }
}

const cache = new Map<string, Expr>();

/** Parses and caches. Blueprints reuse the same handful of expressions constantly. */
export function parseExpression(source: string): Expr {
    const cached = cache.get(source);
    if (cached) return cached;

    const expr = new Parser(tokenize(source), source).parse();
    cache.set(source, expr);
    return expr;
}

export { ExpressionSyntaxError };
