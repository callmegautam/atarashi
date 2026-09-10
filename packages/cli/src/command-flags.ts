import type { FlagSpec } from './raw-args.js';

/** Doc 04 § `atarashi new` — everything not covered by a blueprint's own prompts. */
export const NEW_FLAGS: FlagSpec[] = [
    { flag: '--preset', alias: '-p', takesValue: true },
    { flag: '--add', alias: '-a', takesValue: true, collect: true },
    { flag: '--remove', alias: '-r', takesValue: true, collect: true },
    { flag: '--from', takesValue: true },
    { flag: '--runtime', takesValue: true },
    { flag: '--http', takesValue: true },
    { flag: '--db', takesValue: true },
    { flag: '--orm', takesValue: true },
    { flag: '--auth', takesValue: true },
    { flag: '--ci', takesValue: true },
    { flag: '--docker', takesValue: false },
    { flag: '--no-docker', takesValue: false },
    { flag: '--tests', takesValue: true },
    { flag: '--lint', takesValue: true },
    { flag: '--set', takesValue: true, collect: true },
    { flag: '--yes', alias: '-y', takesValue: false },
    { flag: '--dir', alias: '-d', takesValue: true },
    { flag: '--force', takesValue: false },
    { flag: '--dry-run', takesValue: false },
    { flag: '--json', takesValue: false },
    { flag: '--offline', takesValue: false },
    { flag: '--registry', takesValue: true },
    { flag: '--pm', takesValue: true },
    { flag: '--install', takesValue: false },
    { flag: '--no-install', takesValue: false },
    { flag: '--git', takesValue: false },
    { flag: '--no-git', takesValue: false },
    { flag: '--commit', takesValue: false },
    { flag: '--no-commit', takesValue: false },
    { flag: '--format', takesValue: false },
    { flag: '--no-format', takesValue: false },
    { flag: '--write-env', takesValue: false },
    { flag: '--verbose', alias: '-v', takesValue: false },
    { flag: '--quiet', alias: '-q', takesValue: false },
    { flag: '--no-color', takesValue: false },
    { flag: '--no-hooks', takesValue: false },
    { flag: '--description', takesValue: true },
    { flag: '--help', alias: '-h', takesValue: false },
];

/** Doc 04 § `atarashi add`. */
export const ADD_FLAGS: FlagSpec[] = [
    { flag: '--set', takesValue: true, collect: true },
    { flag: '--yes', alias: '-y', takesValue: false },
    { flag: '--force', takesValue: false },
    { flag: '--dry-run', takesValue: false },
    { flag: '--json', takesValue: false },
    { flag: '--offline', takesValue: false },
    { flag: '--registry', takesValue: true },
    { flag: '--install', takesValue: false },
    { flag: '--no-install', takesValue: false },
    { flag: '--verbose', alias: '-v', takesValue: false },
    { flag: '--quiet', alias: '-q', takesValue: false },
    { flag: '--no-color', takesValue: false },
    { flag: '--help', alias: '-h', takesValue: false },
];

export const NEW_HELP = `Usage: atarashi new <name> [options]

Selection
  -p, --preset <id>              Start from a preset
  -a, --add <ids...>             Add blueprints (repeatable, comma-separated ok)
  -r, --remove <ids...>          Remove blueprints inherited from the preset
      --from <file>              Generate from an atarashi.json

Shorthands (sugar over --add)
      --runtime <node>
      --http <express|fastify|hono|none>
      --db <postgres|mysql|mongodb|sqlite|none>
      --orm <drizzle|prisma|mongoose|none>
      --auth <jwt|session|none>
      --ci <github|gitlab|none>
      --docker / --no-docker
      --tests <vitest|jest|none>
      --lint <eslint|biome|none>

Blueprint answers
      --<blueprint-flag> <value> Any prompt's declared flag, e.g. --db-name
      --set <key=value...>       Answer any prompt by name: --set db.name=api

Behaviour
  -y, --yes                      Accept all defaults; never prompt
  -d, --dir <path>                Target directory (default: ./<name>)
      --force                    Write into a non-empty directory
      --dry-run                  Print the plan; write nothing
      --json                     Machine-readable output (implies --no-color)
      --offline                  Use cached registry only
      --registry <version|url>   Pin the registry for this run

Post-actions
      --pm <pnpm|npm|yarn|bun>   Package manager (default: detected)
      --install / --no-install
      --git / --no-git
      --commit / --no-commit
      --format / --no-format
      --write-env                Also write .env (not just .env.example)

Output
  -v, --verbose                  Stream subprocess output
  -q, --quiet                    Errors only
      --no-color
      --no-hooks                 Never run blueprint generation hooks
`;

export const ADD_HELP = `Usage: atarashi add <blueprint...> [options]

  --set <key=value...>       Answer a prompt by name
  -y, --yes                  Never prompt for confirmation
  --force                    Overwrite files edited since generation too
  --dry-run                  Show the diff; write nothing
  --json                     Machine-readable output
  --offline                  Use cached registry only
  --registry <version|url>   Pin the registry for this run
  --install / --no-install
  -v, --verbose
  -q, --quiet
  --no-color
`;
