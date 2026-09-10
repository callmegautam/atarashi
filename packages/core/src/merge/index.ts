export { deepMerge, sortKeys, stableStringify } from './json.js';
export { type MergeResult, merge } from './merger.js';
export {
    intersectRanges,
    mergePackageJson,
    orderPackageJson,
    PACKAGE_JSON_KEY_ORDER,
} from './package-json.js';
export {
    concatenate,
    type EnvEntryFragment,
    mergeEnv,
    mergeLinesUnique,
    parseEnv,
    type TextFragment,
} from './text.js';
