import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ADD_FLAGS, ADD_HELP, NEW_FLAGS, NEW_HELP } from './command-flags.js';
import { runAdd } from './commands/add.js';
import { runCompletion } from './commands/completion.js';
import { runConfig } from './commands/config.js';
import { runCreateBlueprint } from './commands/create-blueprint.js';
import { runDoctor } from './commands/doctor.js';
import { runEject } from './commands/eject.js';
import { runInfo } from './commands/info.js';
import { runList } from './commands/list.js';
import { runNew } from './commands/new.js';
import { runPreset } from './commands/preset.js';
import { runRegistry } from './commands/registry.js';
import { runUpgrade } from './commands/upgrade.js';
import { cliVersion } from './engine.js';
import { EXIT } from './exit-codes.js';
import { type FlagSpec, parseRawArgs } from './raw-args.js';
import { checkForUpdate } from './update-notifier.js';
import { readUserConfig, resolveConfigPath } from './user-config.js';

const JSON_FLAG: FlagSpec = { flag: '--json', takesValue: false };
const COLOR_FLAG: FlagSpec = { flag: '--no-color', takesValue: false };
const OFFLINE_FLAG: FlagSpec = { flag: '--offline', takesValue: false };
const REGISTRY_FLAG: FlagSpec = { flag: '--registry', takesValue: true };
// Doc 09 § T6: every command that mutates something can be asked first.
const DRY_RUN_FLAG: FlagSpec = { flag: '--dry-run', takesValue: false };

const LIST_FLAGS: FlagSpec[] = [
    { flag: '--category', takesValue: true },
    JSON_FLAG,
    COLOR_FLAG,
    OFFLINE_FLAG,
    REGISTRY_FLAG,
];
const INFO_FLAGS: FlagSpec[] = [JSON_FLAG, COLOR_FLAG, OFFLINE_FLAG, REGISTRY_FLAG];
const CONFIG_FLAGS: FlagSpec[] = [JSON_FLAG, COLOR_FLAG, DRY_RUN_FLAG];
const REGISTRY_FLAGS: FlagSpec[] = [
    JSON_FLAG,
    COLOR_FLAG,
    OFFLINE_FLAG,
    REGISTRY_FLAG,
    DRY_RUN_FLAG,
];
const DOCTOR_FLAGS: FlagSpec[] = [
    { flag: '--fix', takesValue: false },
    JSON_FLAG,
    COLOR_FLAG,
    OFFLINE_FLAG,
];
const PRESET_FLAGS: FlagSpec[] = [
    { flag: '--from', takesValue: true },
    JSON_FLAG,
    COLOR_FLAG,
    DRY_RUN_FLAG,
];
const CREATE_BLUEPRINT_FLAGS: FlagSpec[] = [
    { flag: '--validate', takesValue: true },
    { flag: '--test', takesValue: true },
    JSON_FLAG,
    COLOR_FLAG,
];
const EJECT_FLAGS: FlagSpec[] = [
    { flag: '--yes', alias: '-y', takesValue: false },
    JSON_FLAG,
    COLOR_FLAG,
    DRY_RUN_FLAG,
];
const UPGRADE_FLAGS: FlagSpec[] = [JSON_FLAG, COLOR_FLAG];

const TOP_LEVEL_HELP = `atarashi: composable project scaffolding

Usage
  atarashi                                  Interactive wizard
  atarashi new <name> [options]             Create a project
  atarashi add <blueprint...> [options]     Add capabilities to an existing project
  atarashi list [blueprints|presets]        Browse what's available
  atarashi info <blueprint>                 Details for one blueprint
  atarashi preset <save|list|delete>        Save/list/delete personal presets
  atarashi config <get|set|unset|list|path> User-level settings
  atarashi registry <subcommand>            update|list|pin|unpin|verify|clear|add|sources
  atarashi doctor [--fix]                   Diagnose environment + a project
  atarashi create-blueprint <id>            Scaffold + validate a new blueprint
  atarashi eject                            Inline blueprints into the project
  atarashi upgrade                          Check for a newer atarashi
  atarashi completion <bash|zsh|fish>       Shell completions

Run \`atarashi new --help\` or \`atarashi add --help\` for their full flag surface.
Every command that changes something accepts \`--dry-run\`.
`;

function hasHelpFlag(args: string[]): boolean {
    return args.includes('--help') || args.includes('-h');
}

async function dispatch(argv: string[]): Promise<number> {
    if (argv.includes('--version') || argv.includes('-V')) {
        process.stdout.write(`${cliVersion()}\n`);
        return EXIT.OK;
    }
    if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
        process.stdout.write(TOP_LEVEL_HELP);
        return EXIT.OK;
    }

    const [sub, ...rest] = argv;

    switch (sub) {
        case 'new': {
            if (hasHelpFlag(rest)) {
                process.stdout.write(NEW_HELP);
                return EXIT.OK;
            }
            const { opts, positionals, unknown } = parseRawArgs(rest, NEW_FLAGS);
            return runNew(positionals[0], unknown, opts as never);
        }

        case 'add': {
            if (hasHelpFlag(rest)) {
                process.stdout.write(ADD_HELP);
                return EXIT.OK;
            }
            const { opts, positionals, unknown } = parseRawArgs(rest, ADD_FLAGS);
            return runAdd(positionals, unknown, opts as never);
        }

        case 'list': {
            const { opts, positionals } = parseRawArgs(rest, LIST_FLAGS);
            return runList(positionals[0], opts as never);
        }

        case 'info': {
            const { opts, positionals } = parseRawArgs(rest, INFO_FLAGS);
            return runInfo(positionals[0], opts as never);
        }

        case 'preset': {
            const { opts, positionals } = parseRawArgs(rest, PRESET_FLAGS);
            return runPreset(positionals[0], positionals.slice(1), opts as never);
        }

        case 'config': {
            const { opts, positionals } = parseRawArgs(rest, CONFIG_FLAGS);
            return runConfig(positionals[0], positionals.slice(1), opts as never);
        }

        case 'registry': {
            const { opts, positionals } = parseRawArgs(rest, REGISTRY_FLAGS);
            return runRegistry(positionals[0], positionals.slice(1), opts as never);
        }

        case 'doctor': {
            const { opts } = parseRawArgs(rest, DOCTOR_FLAGS);
            return runDoctor(opts as never);
        }

        case 'create-blueprint': {
            const { opts, positionals } = parseRawArgs(rest, CREATE_BLUEPRINT_FLAGS);
            return runCreateBlueprint(positionals[0], opts as never);
        }

        case 'eject': {
            const { opts } = parseRawArgs(rest, EJECT_FLAGS);
            return runEject(opts as never);
        }

        case 'upgrade': {
            const { opts } = parseRawArgs(rest, UPGRADE_FLAGS);
            return runUpgrade(opts as never);
        }

        case 'completion': {
            const { positionals } = parseRawArgs(rest, []);
            return runCompletion(positionals[0]);
        }

        default:
            process.stderr.write(
                `Unknown command "${sub}"\n\nRun \`atarashi --help\` for usage.\n`
            );
            return EXIT.USAGE;
    }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
    const code = await dispatch(argv);

    try {
        const userConfig = await readUserConfig(resolveConfigPath());
        const quiet = argv.includes('--json') || argv.includes('--quiet') || argv.includes('-q');
        if (!quiet) {
            void checkForUpdate(cliVersion(), { enabled: userConfig.updateNotifier !== false });
        }
    } catch {
        // Never let the notifier's own config read break a command that already ran.
    }

    return code;
}

/**
 * Whether this module was run as the program, rather than imported.
 *
 * Comparing the two paths as strings looks right and is wrong the moment the
 * binary is installed: `npm install -g` and `npm link` both put a *symlink* in
 * the global bin, Node reports `import.meta.url` as the real file it resolved
 * to, and `process.argv[1]` stays the symlink it was invoked through. They
 * never match, so the CLI would exit 0 having done nothing at all. Compare what
 * they resolve to instead.
 */
function isEntryPoint(): boolean {
    try {
        const invoked = process.argv[1];
        if (!invoked) return false;
        return fileURLToPath(import.meta.url) === realpathSync(invoked);
    } catch {
        return false;
    }
}

/* c8 ignore start -- exercised by running the built binary, not by unit tests */
if (isEntryPoint()) {
    main()
        .then((code) => {
            process.exitCode = code;
        })
        .catch((thrown) => {
            process.stderr.write(`${thrown instanceof Error ? thrown.stack : String(thrown)}\n`);
            process.exitCode = EXIT.RUNTIME;
        });
}
/* c8 ignore stop */
