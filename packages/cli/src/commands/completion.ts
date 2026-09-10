import { CliUsageError, reportError } from '../errors.js';
import { EXIT } from '../exit-codes.js';
import { Printer } from '../output.js';

const COMMANDS = [
    'new',
    'add',
    'list',
    'info',
    'preset',
    'config',
    'registry',
    'doctor',
    'create-blueprint',
    'eject',
    'upgrade',
    'completion',
].join(' ');

const bash = `# atarashi bash completion — eval "$(atarashi completion bash)"
_atarashi_completions() {
    local cur
    cur="\${COMP_WORDS[COMP_CWORD]}"
    if [ "$COMP_CWORD" -eq 1 ]; then
        COMPREPLY=( $(compgen -W "${COMMANDS}" -- "$cur") )
        return
    fi
    case "\${COMP_WORDS[1]}" in
        add|info)
            local ids
            ids=$(atarashi list --json 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{process.stdout.write(JSON.parse(d).blueprints.map(b=>b.id).join(' '))}catch(e){}})" 2>/dev/null)
            COMPREPLY=( $(compgen -W "$ids" -- "$cur") )
            ;;
    esac
}
complete -F _atarashi_completions atarashi
`;

const zsh = `#compdef atarashi
# atarashi zsh completion — eval "$(atarashi completion zsh)"
_atarashi() {
    local -a commands
    commands=(${COMMANDS.split(' ')
        .map((command) => `'${command}'`)
        .join(' ')})
    if (( CURRENT == 2 )); then
        _describe 'command' commands
        return
    fi
    if [[ \${words[2]} == add || \${words[2]} == info ]]; then
        local -a ids
        ids=(\${(f)"$(atarashi list --json 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).blueprints.map(b=>b.id).join('\\\\n'))}catch(e){}})" 2>/dev/null)"})
        _describe 'blueprint' ids
    fi
}
_atarashi
`;

const fish = `# atarashi fish completion — atarashi completion fish | source
complete -c atarashi -f
${COMMANDS.split(' ')
    .map((command) => `complete -c atarashi -n "__fish_use_subcommand" -a "${command}"`)
    .join('\n')}
complete -c atarashi -n "__fish_seen_subcommand_from add info" -a "(atarashi list --json 2>/dev/null | node -e 'let d=\\'\\';process.stdin.on(\\'data\\',c=>d+=c);process.stdin.on(\\'end\\',()=>{try{console.log(JSON.parse(d).blueprints.map(b=>b.id).join(\\'\\\\n\\'))}catch(e){}})' 2>/dev/null)"
`;

const SCRIPTS: Record<string, string> = { bash, zsh, fish };

export function runCompletion(shell: string | undefined): number {
    const printer = new Printer({ json: false, quiet: false, verbose: false, color: false });
    try {
        if (!shell || !(shell in SCRIPTS)) {
            throw new CliUsageError('atarashi completion <bash|zsh|fish>');
        }
        process.stdout.write(SCRIPTS[shell]!);
        return EXIT.OK;
    } catch (thrown) {
        return reportError(printer, thrown);
    }
}
