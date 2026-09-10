import { existsSync, readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { type Expr, parseExpression } from '@atarashi/core';
import { loadBlueprintDir } from '@atarashi/registry';
import type { BlueprintManifest, DependencySpec } from '@atarashi/schema';
import Handlebars from 'handlebars';

export type ConformanceSeverity = 'error' | 'warning';

export interface ConformanceProblem {
    /** The check that produced this, e.g. `files`, `expressions`, `templates`. */
    check: string;
    severity: ConformanceSeverity;
    message: string;
    /** Blueprint-relative path the problem is anchored to, when there is one. */
    path?: string;
}

export interface ConformanceReport {
    id: string;
    dir: string;
    ok: boolean;
    problems: ConformanceProblem[];
}

export interface ValidateOptions {
    /**
     * Prompt names declared by blueprints other than this one. An `answers.x`
     * reference to a name in here is legitimate. When omitted, references this
     * blueprint does not declare are reported as warnings rather than errors,
     * because a standalone blueprint cannot know what it will compose with.
     */
    knownPromptNames?: Iterable<string>;
    /**
     * Env keys declared by blueprints other than this one. A template may
     * legitimately read a key its sibling declares — `orm/drizzle` reads the
     * `DATABASE_URL` that `db/postgres` owns — so those are not reported.
     */
    knownEnvKeys?: Iterable<string>;
    /**
     * The registry version manifest. Dependencies that resolve their range from
     * it must have an entry. Omitted means the check is skipped.
     */
    versionManifest?: Record<string, string>;
}

/** Roots a template may reach through a plain `{{ … }}` path. */
const CONTEXT_ROOTS = new Set(['project', 'pm', 'options', 'atarashi', 'blueprints', 'answers']);

/** Registered helpers plus the Handlebars builtins available in the engine. */
const HELPER_NAMES = new Set([
    'eq',
    'ne',
    'and',
    'or',
    'not',
    'json',
    'case',
    'indent',
    'join',
    'slot',
    'when',
    'expr',
    'ifHas',
    'if',
    'unless',
    'each',
    'with',
    'log',
    'lookup',
    'blockHelperMissing',
    'helperMissing',
    'else',
]);

/** Files that must never ship inside a blueprint. */
const FORBIDDEN_FILES = new Set([
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lockb',
    'bun.lock',
    '.DS_Store',
]);

const ENV_REFERENCE = /process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g;

/** `{{ project.name }}` and friends, for the nextSteps placeholder check. */
const MUSTACHE = /\{\{\{?\s*([^}]+?)\s*\}?\}\}/g;

class ProblemList {
    readonly problems: ConformanceProblem[] = [];

    error(check: string, message: string, path?: string): void {
        this.problems.push({ check, severity: 'error', message, ...(path ? { path } : {}) });
    }

    warn(check: string, message: string, path?: string): void {
        this.problems.push({ check, severity: 'warning', message, ...(path ? { path } : {}) });
    }
}

/** Every file under `dir`, as a forward-slashed path relative to `root`. */
async function walk(root: string, dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const out: string[] = [];
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...(await walk(root, full)));
        else out.push(relative(root, full).split(sep).join('/'));
    }
    return out;
}

/** Every `when` expression a manifest can carry, with a label for diagnostics. */
function manifestExpressions(manifest: BlueprintManifest): { where: string; source: string }[] {
    const found: { where: string; source: string }[] = [];
    const add = (where: string, source: string | undefined) => {
        if (source) found.push({ where, source });
    };

    manifest.prompts.forEach((prompt, index) => {
        add(`prompts[${index}] (${prompt.name})`, prompt.when);
        prompt.choices?.forEach((choice, choiceIndex) => {
            add(`prompts[${index}].choices[${choiceIndex}]`, choice.when);
        });
    });
    manifest.files.forEach((file, index) => {
        add(`files[${index}] (${file.from})`, file.when);
    });
    manifest.env.forEach((entry, index) => {
        add(`env[${index}] (${entry.key})`, entry.when);
    });
    manifest.contributions.forEach((contribution, index) => {
        add(`contributions[${index}] (${contribution.target})`, contribution.when);
    });

    for (const [group, deps] of [
        ['dependencies', manifest.dependencies],
        ['devDependencies', manifest.devDependencies],
        ['peerDependencies', manifest.peerDependencies],
    ] as const) {
        for (const [name, spec] of Object.entries(deps)) {
            if (typeof spec !== 'string') add(`${group}.${name}`, spec.when);
        }
    }
    for (const [name, spec] of Object.entries(manifest.scripts)) {
        if (typeof spec !== 'string') add(`scripts.${name}`, spec.when);
    }
    return found;
}

/** Collects every `answers.<name>` path an expression reads. */
function answersIn(expr: Expr, into: Set<string>): void {
    switch (expr.kind) {
        case 'path':
            if (expr.segments[0] === 'answers' && expr.segments.length > 1) {
                into.add(expr.segments.slice(1).join('.'));
            }
            return;
        case 'unary':
            answersIn(expr.operand, into);
            return;
        case 'binary':
            answersIn(expr.left, into);
            answersIn(expr.right, into);
            return;
        default:
            return;
    }
}

/**
 * The renderer puts back the newline Handlebars eats after a *standalone*
 * partial, which is the only shape `{{> slot}}` is ever written in. Written
 * inline it would gain a stray newline instead of losing one, and the region
 * markers would land mid-expression where `atarashi add` cannot use them.
 */
function checkPartialIsStandalone(
    node: hbs.AST.PartialStatement,
    source: string,
    path: string,
    problems: ProblemList
): void {
    const { start, end } = node.loc;
    const lines = source.split('\n');
    const before = lines[start.line - 1]?.slice(0, start.column) ?? '';
    const after = lines[end.line - 1]?.slice(end.column) ?? '';
    if (before.trim() === '' && after.trim() === '') return;

    problems.error(
        'templates',
        `writes \`{{> ${node.name.type === 'PathExpression' ? (node.name as hbs.AST.PathExpression).original : 'partial'}}}\` inline on line ${start.line}; a slot must be alone on its line`,
        path
    );
}

/**
 * Walks a Handlebars AST, collecting the string arguments of `when` / `expr`
 * (which are Atarashi expressions, not Handlebars paths) and the plain path
 * references that must resolve against the render context.
 */
function scanTemplate(source: string, path: string, problems: ProblemList): string[] {
    const expressions: string[] = [];

    let program: hbs.AST.Program;
    try {
        program = Handlebars.parse(source);
    } catch (cause) {
        problems.error(
            'templates',
            `does not parse as Handlebars: ${(cause as Error).message}`,
            path
        );
        return expressions;
    }

    // Names introduced by `{{#each … as |item|}}`, which are not context roots.
    const scope: string[] = [];
    // `#each` and `#with` rebind the whole context, so inside one a bare path
    // resolves against the item, not the render context. Nothing to verify.
    let rebound = 0;

    const visitPath = (node: hbs.AST.PathExpression, isHelper: boolean): void => {
        if (node.data || node.original === 'this' || node.original === '.') return;
        const head = node.parts[0];
        if (!head) return;
        if (isHelper && HELPER_NAMES.has(head)) return;
        if (scope.includes(head)) return;
        if (rebound > 0 && !CONTEXT_ROOTS.has(head)) return;
        if (CONTEXT_ROOTS.has(head)) return;
        problems.error(
            'templates',
            `references \`${node.original}\`, which the render context does not provide`,
            path
        );
    };

    const visitExpression = (node: hbs.AST.Expression, isHelper: boolean): void => {
        if (node.type === 'PathExpression') {
            visitPath(node as hbs.AST.PathExpression, isHelper);
            return;
        }
        if (node.type === 'SubExpression') {
            const sub = node as hbs.AST.SubExpression;
            visitCall(sub.path, sub.params, sub.hash);
        }
    };

    const visitCall = (
        path: hbs.AST.Expression,
        params: hbs.AST.Expression[],
        hash: hbs.AST.Hash | undefined
    ): void => {
        const isHelper = params.length > 0 || Boolean(hash);
        const name =
            path.type === 'PathExpression' ? (path as hbs.AST.PathExpression).parts[0] : undefined;

        // `{{#when "…"}}` and `{{expr "…"}}` carry an Atarashi expression, which
        // the Handlebars AST only sees as an opaque string.
        if ((name === 'when' || name === 'expr') && params[0]?.type === 'StringLiteral') {
            expressions.push((params[0] as hbs.AST.StringLiteral).value);
        } else {
            for (const param of params) visitExpression(param, false);
        }

        visitExpression(path, isHelper);
        for (const pair of hash?.pairs ?? []) visitExpression(pair.value, false);
    };

    const visitBody = (body: hbs.AST.Statement[]): void => {
        for (const statement of body) {
            if (statement.type === 'MustacheStatement') {
                const node = statement as hbs.AST.MustacheStatement;
                visitCall(node.path, node.params, node.hash);
            } else if (statement.type === 'BlockStatement') {
                const node = statement as hbs.AST.BlockStatement;
                visitCall(node.path, node.params, node.hash);
                const introduced = node.program?.blockParams ?? [];
                const name =
                    node.path.type === 'PathExpression'
                        ? (node.path as hbs.AST.PathExpression).parts[0]
                        : undefined;
                const rebinds = (name === 'each' || name === 'with') && introduced.length === 0;
                scope.push(...introduced);
                if (rebinds) rebound += 1;
                if (node.program) visitBody(node.program.body);
                if (node.inverse) visitBody(node.inverse.body);
                if (rebinds) rebound -= 1;
                scope.length -= introduced.length;
            } else if (statement.type === 'PartialStatement') {
                const node = statement as hbs.AST.PartialStatement;
                for (const param of node.params) visitExpression(param, false);
                checkPartialIsStandalone(node, source, path, problems);
            }
        }
    };

    visitBody(program.body);
    return expressions;
}

function usesVersionManifest(spec: DependencySpec): boolean {
    if (typeof spec === 'string') return false;
    if (spec.fromVersionManifest === false) return false;
    return spec.fromVersionManifest === true || spec.version === undefined;
}

/**
 * The conformance suite from doc 08 §3, run over one blueprint directory.
 * `atarashi create-blueprint --validate` is a thin printer around this, so a
 * community author runs exactly the checks the first-party blueprints do.
 */
export async function validateBlueprint(
    dir: string,
    options: ValidateOptions = {}
): Promise<ConformanceReport> {
    const problems = new ProblemList();
    // Throws for a malformed manifest — that is a hard stop, since every other
    // check reads the parsed manifest.
    const loaded = await loadBlueprintDir(dir, { trusted: true });
    const manifest = loaded.manifest;

    checkIdentity(dir, manifest, problems);
    const shipped = await checkFiles(dir, manifest, problems);
    checkDependencies(manifest, options.versionManifest, problems);
    checkPrompts(manifest, problems);

    const declaredAnswers = new Set(manifest.prompts.map((prompt) => prompt.name));
    const known = new Set(options.knownPromptNames ?? []);
    const answersAreKnowable = known.size > 0;
    for (const name of known) declaredAnswers.add(name);

    const referencedAnswers = new Set<string>();
    checkManifestExpressions(manifest, referencedAnswers, problems);
    const declaredEnv = new Set([
        ...manifest.env.map((entry) => entry.key),
        ...(options.knownEnvKeys ?? []),
    ]);
    await checkTemplates(dir, manifest, shipped, declaredEnv, referencedAnswers, problems);
    checkNextSteps(manifest, problems);

    for (const name of [...referencedAnswers].sort()) {
        if (declaredAnswers.has(name)) continue;
        const message = `\`answers.${name}\` is not declared by any prompt`;
        if (answersAreKnowable) problems.error('expressions', message);
        else problems.warn('expressions', `${message} in this blueprint`);
    }

    return {
        id: manifest.id,
        dir,
        ok: !problems.problems.some((problem) => problem.severity === 'error'),
        problems: problems.problems,
    };
}

/**
 * A blueprint published as an npm package is *pointed at* by the package's
 * `atarashi` field rather than found by scanning a `<namespace>/<name>` tree,
 * so its directory name carries no meaning and must not be held to the id.
 * Anything else — the first-party catalogue, `./.atarashi/blueprints` — is
 * found by its path, where a mismatch means it will never resolve.
 */
function isPackagePointedAt(dir: string): boolean {
    let current = dir;
    for (let depth = 0; depth < 4; depth += 1) {
        const manifestPath = join(current, 'package.json');
        if (existsSync(manifestPath)) {
            try {
                const packageJson = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
                    atarashi?: string;
                };
                return (
                    typeof packageJson.atarashi === 'string' &&
                    resolve(current, packageJson.atarashi) === resolve(dir)
                );
            } catch {
                return false;
            }
        }
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
    }
    return false;
}

function checkIdentity(dir: string, manifest: BlueprintManifest, problems: ProblemList): void {
    if (isPackagePointedAt(dir)) return;

    const segments = dir.split(sep).filter(Boolean);
    const expected = segments.slice(-2).join('/');
    if (segments.length >= 2 && manifest.id !== expected) {
        problems.error(
            'identity',
            `id "${manifest.id}" does not match its directory ("${expected}")`
        );
    }
}

async function checkFiles(
    dir: string,
    manifest: BlueprintManifest,
    problems: ProblemList
): Promise<string[]> {
    const declared = new Set(manifest.files.map((file) => file.from));

    // Absolute paths, `..` segments and null bytes are already refused by
    // `relativePathSchema`, so by here every path is project-relative.
    for (const file of manifest.files) {
        if (!existsSync(join(dir, file.from))) {
            problems.error('files', `files[].from "${file.from}" does not exist`, file.from);
        }
    }

    // Paths come back already prefixed with `files/`, matching `files[].from`.
    const shipped = await walk(dir, join(dir, 'files'));
    for (const from of shipped) {
        if (!declared.has(from)) {
            problems.error('files', `"${from}" is shipped but no files[].from references it`, from);
        }
        const segments = from.split('/');
        if (FORBIDDEN_FILES.has(segments.at(-1) ?? '')) {
            problems.error('files', `"${from}" must not be committed inside a blueprint`, from);
        }
        if (segments.includes('node_modules')) {
            problems.error('files', `"${from}" is inside a committed node_modules`, from);
        }
    }

    if (manifest.hooks && !existsSync(join(dir, manifest.hooks.module))) {
        problems.error('hooks', `hooks.module "${manifest.hooks.module}" does not exist`);
    }

    return shipped;
}

function checkDependencies(
    manifest: BlueprintManifest,
    versions: Record<string, string> | undefined,
    problems: ProblemList
): void {
    if (!versions) return;
    for (const [group, deps] of [
        ['dependencies', manifest.dependencies],
        ['devDependencies', manifest.devDependencies],
        ['peerDependencies', manifest.peerDependencies],
    ] as const) {
        for (const [name, spec] of Object.entries(deps)) {
            if (usesVersionManifest(spec) && !(name in versions)) {
                problems.error(
                    'dependencies',
                    `${group}.${name} has no entry in version-manifest.json`
                );
            }
        }
    }
}

function checkPrompts(manifest: BlueprintManifest, problems: ProblemList): void {
    for (const prompt of manifest.prompts) {
        if (!prompt.flag) {
            problems.error('prompts', `prompt "${prompt.name}" declares no non-interactive flag`);
        }
    }
}

function checkManifestExpressions(
    manifest: BlueprintManifest,
    referencedAnswers: Set<string>,
    problems: ProblemList
): void {
    for (const { where, source } of manifestExpressions(manifest)) {
        try {
            answersIn(parseExpression(source), referencedAnswers);
        } catch (cause) {
            problems.error('expressions', `${where}: \`${source}\` — ${(cause as Error).message}`);
        }
    }
}

async function checkTemplates(
    dir: string,
    manifest: BlueprintManifest,
    shipped: string[],
    declaredEnv: ReadonlySet<string>,
    referencedAnswers: Set<string>,
    problems: ProblemList
): Promise<void> {
    const rendered = new Set(manifest.files.filter((file) => file.render).map((file) => file.from));

    for (const from of shipped) {
        const source = await readFile(join(dir, from), 'utf8').catch(() => undefined);
        if (source === undefined) continue;

        if (rendered.has(from)) {
            for (const expression of scanTemplate(source, from, problems)) {
                try {
                    answersIn(parseExpression(expression), referencedAnswers);
                } catch (cause) {
                    problems.error(
                        'expressions',
                        `\`${expression}\` — ${(cause as Error).message}`,
                        from
                    );
                }
            }
        }

        for (const match of source.matchAll(ENV_REFERENCE)) {
            const key = match[1] ?? match[2];
            if (key && !declaredEnv.has(key)) {
                problems.warn(
                    'env',
                    `reads \`process.env.${key}\`, which no blueprint declares`,
                    from
                );
            }
        }
    }
}

/**
 * `nextSteps` are rendered with the same engine as files, so an unbalanced or
 * unknown-root placeholder there fails at the very end of a generation — after
 * everything is already on disk.
 */
function checkNextSteps(manifest: BlueprintManifest, problems: ProblemList): void {
    for (const step of manifest.nextSteps) {
        for (const match of step.matchAll(MUSTACHE)) {
            const inner = (match[1] ?? '').trim();
            const head = inner.split(/[\s.]/)[0]?.replace(/^[#/>]/, '');
            if (!head || HELPER_NAMES.has(head) || CONTEXT_ROOTS.has(head)) continue;
            problems.error(
                'next-steps',
                `nextSteps "${step}" references \`${head}\`, which the render context does not provide`
            );
        }
    }
}
