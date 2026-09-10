/**
 * The `when` expression AST. Deliberately tiny: no loops, no lambdas, no
 * property access on call results, no arbitrary function calls. Anything a
 * blueprint cannot say here belongs in a hook.
 */
export type Expr =
    | { kind: 'literal'; value: string | number | boolean | null }
    | { kind: 'path'; segments: string[] }
    | { kind: 'call'; callee: 'has' | 'provides'; argument: string }
    | { kind: 'unary'; operator: '!' | '-'; operand: Expr }
    | { kind: 'binary'; operator: BinaryOperator; left: Expr; right: Expr };

export type BinaryOperator =
    | '&&'
    | '||'
    | '==='
    | '!=='
    | '<'
    | '<='
    | '>'
    | '>='
    | '+'
    | '-'
    | 'in';

export const CALLABLES = ['has', 'provides'] as const;

/** Roots an expression may reference. Anything else is an unknown-binding error. */
export const BINDING_ROOTS = ['answers', 'project', 'options', 'pm'] as const;
export type BindingRoot = (typeof BINDING_ROOTS)[number];
