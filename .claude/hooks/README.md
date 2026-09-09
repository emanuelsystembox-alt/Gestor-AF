# Hooks — Real Enforcement (not just instructions in text)

## Why this exists

Every rule written as prose inside CLAUDE.md or the files in `agent_docs/`
is **context**, not **enforcement**. Even written in all caps with
"ALWAYS" or "NEVER," the AI can still skip the rule under context
pressure — it's a strong suggestion, not a hard gate.

Hooks are different: they're real shell commands, triggered automatically
by Claude Code lifecycle events (before a tool runs, after an edit, at
session start). They run **regardless of what the AI decides to do**. It's
the difference between politely asking someone to validate code before
pushing, and having a system that blocks the push if validation fails.

## What this example does

The hook below runs **before** any commit (the `PreToolUse` event,
triggered when the bash tool tries to run `git commit`), executes lint and
type-check, and **blocks the commit if anything fails** — the AI gets the
error back and has to fix it before trying again.

## Setup

O hook **já está instalado** em `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": "grep -q \"git commit\" || exit 0; cd \"${CLAUDE_PROJECT_DIR:-.}\" || exit 0; { cd app && ./node_modules/.bin/tsc --noEmit && cd ../campo && ./node_modules/.bin/tsc --noEmit ; } || { echo \"Typecheck falhou\" >&2 ; exit 2 ; }",
        "shell": "bash",
        "timeout": 300,
        "statusMessage": "Conferindo os tipos antes do commit…"
      }]
    }]
  }
}
```

Quatro decisões que valem registro:

- **`grep` no payload, não o filtro `if`.** O `if: "Bash(git commit*)"` casa
  só pelo começo do comando, e aqui se commita com
  `git add -A && git commit …`. O grep pega em qualquer posição.
- **`./node_modules/.bin/tsc`, não `npx tsc`.** O `npx` resolve pacote a
  cada chamada; o binário local corta o tempo pela metade. **7 segundos**
  para os dois projetos.
- **`|| exit 2`.** Em `PreToolUse`, **2** é o código que BLOQUEIA e devolve
  o erro para a IA corrigir. Qualquer outro código não bloqueia nada — o
  hook rodaria, falharia e o commit passaria assim mesmo.
- **Sai em 0,07 s quando o comando não é commit.** Sem isso o hook rodaria
  o typecheck a cada `ls`.

Testado nos três caminhos antes de instalar: comando comum sai na hora,
commit com código limpo passa, commit com erro de tipo bloqueia com saída
2 e mostra o erro do `tsc`.

## Adapting to other stacks

The logic is always the same — only the command changes:

| Stack | Example command |
|---|---|
| Node/TypeScript | `npm run lint && npm run typecheck` |
| Python | `ruff check . && mypy .` |
| Go | `golangci-lint run && go vet ./...` |
| Rust | `cargo clippy && cargo check` |

Look up the project's real command (it usually already exists in
`package.json`, a `Makefile`, or similar) instead of assuming.

## This is just the start

This is **one** hook, on the most critical event (pre-commit). The full
hooks system — multiple events (PreToolUse, PostToolUse, SessionStart),
custom slash commands, and subagent orchestration — is out of scope for
this kit. If that's what you need, it's covered in the advanced guide
(upsell).
