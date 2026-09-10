/** Splits any casing convention into lowercase words: `myAPIServer` → my, api, server. */
export function words(input: string): string[] {
    return input
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean)
        .map((word) => word.toLowerCase());
}

export const kebab = (input: string): string => words(input).join('-');
export const snake = (input: string): string => words(input).join('_');
export const constant = (input: string): string => words(input).join('_').toUpperCase();

export const pascal = (input: string): string =>
    words(input)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');

export const camel = (input: string): string => {
    const value = pascal(input);
    return value.charAt(0).toLowerCase() + value.slice(1);
};

/** npm-safe project slug: what the generated `package.json` is actually named. */
export const slug = (input: string): string => {
    const scoped = input.match(/^@([^/]+)\/(.+)$/);
    if (scoped) return `@${kebab(scoped[1]!)}/${kebab(scoped[2]!)}`;
    return kebab(input);
};

export const CASE_TRANSFORMS = { camel, pascal, kebab, snake, constant } as const;
export type CaseName = keyof typeof CASE_TRANSFORMS;
