/** Conventional Commits — the changelog is generated from these. */
export default {
    extends: ['@commitlint/config-conventional'],
    rules: {
        'body-max-line-length': [0],
        'scope-enum': [
            2,
            'always',
            [
                '',
                'schema',
                'core',
                'registry',
                'blueprints',
                'cli',
                'plugin-kit',
                'testing',
                'e2e',
                'docs',
                'ci',
                'deps',
                'release',
            ],
        ],
    },
};
