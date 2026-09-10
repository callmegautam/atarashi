import Handlebars from 'handlebars';
import type { RenderContext } from '../context.js';
import { evaluateCondition, evaluateExpression, truthy } from '../expr/index.js';
import { renderSlotMarkers } from './slots.js';
import { CASE_TRANSFORMS, type CaseName } from './strings.js';

export class TemplateError extends Error {
    readonly templatePath: string;

    constructor(message: string, templatePath: string) {
        super(`${message} (in ${templatePath})`);
        this.name = 'TemplateError';
        this.templatePath = templatePath;
    }
}

/**
 * A curated helper set — no `lookup`, no dynamic partials, no `#with` over user
 * data. Blueprints that need real logic use a hook, where the escape hatch is
 * visible and sandboxed.
 */
function registerHelpers(
    handlebars: typeof Handlebars,
    templatePath: string,
    targetPath: string
): void {
    const helpers: Record<string, Handlebars.HelperDelegate> = {
        eq: (a: unknown, b: unknown) => a === b,
        ne: (a: unknown, b: unknown) => a !== b,
        and: (...args: unknown[]) => args.slice(0, -1).every(Boolean),
        or: (...args: unknown[]) => args.slice(0, -1).some(Boolean),
        not: (value: unknown) => !value,

        json: (value: unknown, indent?: unknown) =>
            new handlebars.SafeString(
                JSON.stringify(value, null, typeof indent === 'number' ? indent : 2)
            ),

        case: (name: unknown, value: unknown) => {
            const transform = CASE_TRANSFORMS[name as CaseName];
            if (!transform) {
                throw new TemplateError(
                    `Unknown case \`${String(name)}\`; use ${Object.keys(CASE_TRANSFORMS).join(', ')}`,
                    templatePath
                );
            }
            return transform(String(value ?? ''));
        },

        /** Indents every line but the first, for embedding a block mid-expression. */
        indent: (value: unknown, width: unknown) => {
            const pad = ' '.repeat(typeof width === 'number' ? width : 4);
            return String(value ?? '')
                .split('\n')
                .map((line, index) => (index === 0 || line === '' ? line : pad + line))
                .join('\n');
        },

        join: (value: unknown, separator: unknown) =>
            Array.isArray(value)
                ? value.join(typeof separator === 'string' ? separator : ', ')
                : '',

        /** Emits the region markers other blueprints contribute into. */
        slot: (name: unknown) =>
            new handlebars.SafeString(renderSlotMarkers(String(name), targetPath)),
    };

    for (const [name, helper] of Object.entries(helpers)) {
        handlebars.registerHelper(name, helper);
    }

    // `when` expressions are available inside templates too, so a condition is
    // written once and means the same thing in the manifest and the file.
    handlebars.registerHelper(
        'when',
        function whenHelper(this: unknown, expression: unknown, options: Handlebars.HelperOptions) {
            const context = options.data.root as RenderContext;
            const matched = evaluateCondition(String(expression), context);
            return matched ? options.fn(this) : options.inverse(this);
        }
    );

    handlebars.registerHelper(
        'expr',
        function exprHelper(expression: unknown, options: Handlebars.HelperOptions) {
            const context = options.data.root as RenderContext;
            const value = evaluateExpression(String(expression), context);
            return value === undefined || value === null ? '' : String(value);
        }
    );

    handlebars.registerHelper(
        'ifHas',
        function ifHasHelper(this: unknown, id: unknown, options: Handlebars.HelperOptions) {
            const context = options.data.root as RenderContext;
            return truthy(context.has(String(id))) ? options.fn(this) : options.inverse(this);
        }
    );
}

/**
 * Creates an isolated Handlebars environment. Isolated per render so a
 * blueprint cannot register a helper that leaks into another blueprint's
 * templates.
 */
export function createEngine(templatePath: string, escapeHtml: boolean, targetPath?: string) {
    const handlebars = Handlebars.create();
    // We generate source code, not HTML: escaping `&&` into `&amp;&amp;` is
    // never what a blueprint wants. HTML targets opt back in per file.
    const commentTarget = targetPath ?? templatePath.replace(/\.hbs$/, '');
    registerHelpers(handlebars, templatePath, commentTarget);

    // Blueprints write `{{> slot "imports" }}`, so `slot` is registered as a
    // partial as well as a helper. Handlebars passes the positional argument
    // through as the partial's context.
    //
    // Every slot is written standalone — alone on its line, by convention the
    // conformance suite enforces — and Handlebars consumes the newline that
    // ends a standalone partial's line. Left alone that eats the blank line a
    // template puts after a slot, and strips the trailing newline from a file
    // that ends in one; both make `biome check` fail in generated projects.
    // Compiling with `ignoreStandalone` would fix it but would also stop the
    // stripping around `{{#when}}` blocks, which is wanted, so the newline is
    // put back here instead — at the only construct that loses one.
    handlebars.registerPartial(
        'slot',
        (name: unknown) =>
            `${renderSlotMarkers(typeof name === 'string' ? name : String(name), commentTarget)}\n`
    );

    return {
        render(template: string, context: RenderContext): string {
            try {
                const compiled = handlebars.compile(template, {
                    noEscape: !escapeHtml,
                    strict: false,
                    preventIndent: true,
                });
                return compiled(context as unknown as Record<string, unknown>);
            } catch (error) {
                throw new TemplateError((error as Error).message, templatePath);
            }
        },
    };
}

/** Renders a short template string — a `to` path, an env sample, a next step. */
export function renderString(template: string, context: RenderContext, where: string): string {
    if (!template.includes('{{')) return template;
    return createEngine(where, false).render(template, context);
}
