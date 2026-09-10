import { join } from 'node:path';
import { DirectorySource } from './directory.js';

/** Where a project keeps blueprints it is developing or vendoring. */
export const LOCAL_BLUEPRINTS_DIR = join('.atarashi', 'blueprints');

/**
 * Project-local blueprints win over every other source, so an author can
 * override a published blueprint by dropping a directory in the project. They
 * are untrusted all the same: being on disk is not review.
 */
export function createLocalSource(cwd: string, dir?: string): DirectorySource {
    const root = dir ?? join(cwd, LOCAL_BLUEPRINTS_DIR);
    return new DirectorySource(root, {
        trusted: false,
        origin: `local:${root}`,
        presetsDir: join(root, '..', 'presets'),
    });
}
