# codebase-funeral

Give your dead repo the funeral it deserves. Reads a repository's git history and prints a one-page memorial: lifespan, first and last words, the people who built it, the strangest commits, and a cause of death.

```sh
npx codebase-funeral ./path/to/repo
```

Writes `<repo-name>.funeral.html`, a single self-contained page you can open offline or host anywhere.

## Options

| Flag | Default | |
|---|---|---|
| `-o, --out <file>` | `<repo-name>.funeral.html` | Output path |
| `--no-ai` | | Skip Claude and use the built-in eulogy |
| `-m, --model <id>` | `claude-opus-5-5` | Claude model for the eulogy prose |
| `-c, --cause <text>` | | The real cause of death, used as written |
| `--memory <text>` | | A memory to share, used as written. Repeat for more |
| `-e, --eulogy <text\|@file>` | | Your own eulogy, used as written. `@path` reads it from a file |
| `--epitaph <text>` | | The line on the headstone |

The eulogy prose is written by Claude when `ANTHROPIC_API_KEY` is set; otherwise (or with `--no-ai`) a built-in template is used. All statistics come from `git log` and are deterministic.

`--eulogy`, `--epitaph`, `--cause` and `--memory` are all optional. Whatever you supply appears on the page exactly as written, and Claude only writes the parts you left out, treating yours as fact. Supply all four and Claude isn't called at all. When left out:

| | Claude available | No Claude (`--no-ai` or no key) |
|---|---|---|
| Cause of death | Claude infers it from the history, shown as "Presumed" | Git heuristic, shown as "Presumed" |
| Eulogy (opening, survived-by, farewell) | Claude writes it | Built-in template |
| Epitaph | Claude writes it | Built-in line |
| Memories | Claude writes a "Remembered For" paragraph from the history | Section omitted |

```sh
npx codebase-funeral ./old-app -e @eulogy.txt --epitaph "Hello, World. Goodbye, World."
npx codebase-funeral ./old-app -c "The startup pivoted" --memory "It ran payroll for 3 years" --memory "Named after Ana's cat"
```

## Development

```sh
npm install
npm run dev -- ../some-repo   # run from source
npm run build                 # bundle to dist/
```

## License

[MIT](LICENSE)
