/** Programmatic surface — the binary itself lives in `cli.ts`. */
export { type AddFlags, runAdd } from './commands/add.js';
export { runCompletion } from './commands/completion.js';
export { type ConfigFlags, runConfig } from './commands/config.js';
export { type CreateBlueprintFlags, runCreateBlueprint } from './commands/create-blueprint.js';
export { type DoctorFlags, runDoctor } from './commands/doctor.js';
export { type EjectFlags, runEject } from './commands/eject.js';
export { type InfoFlags, runInfo } from './commands/info.js';
export { type ListFlags, runList } from './commands/list.js';
export { type NewFlags, runNew } from './commands/new.js';
export { type PresetFlags, runPreset } from './commands/preset.js';
export { type RegistryFlags, runRegistry } from './commands/registry.js';
export { runUpgrade, type UpgradeFlags } from './commands/upgrade.js';
export { cliVersion } from './engine.js';
export { EXIT, exitCodeFor } from './exit-codes.js';
