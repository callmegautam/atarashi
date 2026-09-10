export { buildContext, packageManagerFacts, projectFacts } from './context.js';
export { createEngine, renderString, TemplateError } from './engine.js';
export {
    defaultDestination,
    defaultMergeFor,
    type FileFragment,
    type RenderOutput,
    render,
    type SlotContribution,
} from './renderer.js';
export {
    commentStyleFor,
    findSlots,
    injectSlots,
    mergeImports,
    renderSlotMarkers,
    type SlotMarker,
} from './slots.js';
export * from './strings.js';
