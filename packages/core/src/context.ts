import type { JsonValue, PackageManager, ProjectOptions } from '@atarashi/schema';

/** Facts about the chosen package manager, so templates never hardcode `npm run`. */
export interface PackageManagerFacts {
    name: PackageManager;
    /** `pnpm install` */
    install: string;
    /** `pnpm run` — prefix for a package script. */
    run: string;
    /** `pnpm dlx` / `npx` — one-off binary execution. */
    exec: string;
    /** `pnpm add -D` */
    addDev: string;
    /** `pnpm add` */
    add: string;
    lockfile: string;
}

export interface ProjectFacts {
    name: string;
    slug: string;
    pascal: string;
    camel: string;
    kebab: string;
    constant: string;
    description: string;
    year: number;
}

/**
 * The single immutable object passed to every template and every `when`
 * expression. Built once per generation, shared by every blueprint.
 */
export interface RenderContext {
    project: ProjectFacts;
    /** Flattened prompt answers, keyed by globally unique prompt name. */
    answers: Record<string, JsonValue>;
    options: ProjectOptions;
    pm: PackageManagerFacts;
    has(id: string): boolean;
    provides(capability: string): boolean;
    blueprints: ReadonlyArray<{ id: string; version: string }>;
    atarashi: { version: string; generatedAt: string };
}
