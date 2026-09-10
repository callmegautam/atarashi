import type { JsonValue } from '@atarashi/schema';

const isPlainObject = (value: unknown): value is Record<string, JsonValue> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Recursive object merge. Arrays union by value with first-occurrence order
 * preserved — two blueprints adding `"types": ["pg"]` and `"types": ["node"]`
 * should get both, not the second one.
 */
export function deepMerge(base: JsonValue, incoming: JsonValue): JsonValue {
    if (Array.isArray(base) && Array.isArray(incoming)) {
        const merged = [...base];
        for (const item of incoming) {
            const seen = merged.some(
                (existing) => stableStringify(existing) === stableStringify(item)
            );
            if (!seen) merged.push(item);
        }
        return merged;
    }

    if (isPlainObject(base) && isPlainObject(incoming)) {
        const result: Record<string, JsonValue> = { ...base };
        for (const [key, value] of Object.entries(incoming)) {
            result[key] = key in result ? deepMerge(result[key]!, value) : value;
        }
        return result;
    }

    return incoming;
}

/** Key-sorted JSON, so equality checks and output diffs are stable. */
export function stableStringify(value: JsonValue): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (isPlainObject(value)) {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key]!)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}

/** Recursively sorts object keys. Used for every generated JSON but package.json. */
export function sortKeys(value: JsonValue): JsonValue {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (!isPlainObject(value)) return value;

    const sorted: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortKeys(value[key]!);
    return sorted;
}

export { isPlainObject };
