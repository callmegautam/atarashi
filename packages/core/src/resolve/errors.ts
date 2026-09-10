import { DIAGNOSTIC_CODES, type Diagnostic, error } from '@atarashi/schema';

/**
 * Resolution failures are the errors users hit most, so every one of them names
 * both sides of the clash and at least one way forward. The formatting lives
 * here rather than in the CLI so the web builder shows the same explanations.
 */

export function unknownBlueprint(id: string, suggestions: string[]): Diagnostic {
    return error(DIAGNOSTIC_CODES.UNKNOWN_BLUEPRINT, `Unknown blueprint \`${id}\``, {
        blueprints: [],
        suggestions: suggestions.length
            ? [`Did you mean ${suggestions.map((s) => `\`${s}\``).join(' or ')}?`]
            : ['Run `atarashi list` to see the available blueprints'],
    });
}

export function unsatisfiedRequirement(id: string, capability: string): Diagnostic {
    return error(
        DIAGNOSTIC_CODES.UNSATISFIED_REQUIREMENT,
        `${id} requires the capability \`${capability}\`, which nothing in this selection provides`,
        {
            blueprints: [id],
            suggestions: [
                `Run \`atarashi list --provides ${capability}\` to find a blueprint that provides it`,
            ],
        }
    );
}

export function ambiguousRequirement(
    id: string,
    capability: string,
    candidates: string[]
): Diagnostic {
    return error(
        DIAGNOSTIC_CODES.AMBIGUOUS_REQUIREMENT,
        `${id} requires \`${capability}\`, and ${candidates.length} blueprints provide it`,
        {
            blueprints: [id, ...candidates],
            suggestions: candidates.map((candidate) => `Add \`--add ${candidate}\` to choose it`),
        }
    );
}

export function capabilityConflict(
    a: { id: string; token: string },
    b: { id: string },
    detail?: string
): Diagnostic {
    return error(
        DIAGNOSTIC_CODES.CAPABILITY_CONFLICT,
        `Cannot combine ${a.id} with ${b.id}: both claim \`${a.token}\`, and only one is allowed`,
        {
            blueprints: [a.id, b.id],
            detail,
            suggestions: [`Remove one of them: \`--remove ${b.id}\``],
        }
    );
}

export function requirementConflict(
    consumer: { id: string; requires: string },
    holder: { id: string; provides: string[] }
): Diagnostic {
    return error(
        DIAGNOSTIC_CODES.CAPABILITY_CONFLICT,
        `Cannot combine ${holder.id} with ${consumer.id}`,
        {
            blueprints: [holder.id, consumer.id],
            detail: [
                `${holder.id}  provides  ${holder.provides.join(', ')}`,
                `${consumer.id} requires  ${consumer.requires}`,
            ].join('\n'),
            suggestions: [
                `Pick a blueprint that provides \`${consumer.requires}\`, or drop ${consumer.id}`,
            ],
        }
    );
}

export function dependencyCycle(path: string[]): Diagnostic {
    return error(
        DIAGNOSTIC_CODES.DEPENDENCY_CYCLE,
        `Ordering cycle between blueprints: ${[...path, path[0]].join(' → ')}`,
        {
            blueprints: path,
            suggestions: ['Remove one of the `after` entries that closes this loop'],
        }
    );
}

export function engineIncompatible(
    id: string,
    field: 'atarashi' | 'node',
    range: string,
    actual: string
): Diagnostic {
    return error(
        DIAGNOSTIC_CODES.ENGINE_INCOMPATIBLE,
        `${id} needs ${field} ${range}, but this is ${field} ${actual}`,
        {
            blueprints: [id],
            suggestions:
                field === 'atarashi'
                    ? ['Upgrade Atarashi: `npm install -g atarashi@latest`']
                    : [`Upgrade Node to ${range}`],
        }
    );
}

export function promptCollision(name: string, ids: string[]): Diagnostic {
    return error(
        DIAGNOSTIC_CODES.PROMPT_NAME_COLLISION,
        `${ids.join(' and ')} both declare a prompt named \`${name}\``,
        {
            blueprints: ids,
            suggestions: [
                'Prompt names are global; blueprints should prefix them by domain, e.g. `db.name`',
            ],
        }
    );
}
