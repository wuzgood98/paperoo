# Contributing to Paperoo

Thanks for helping out. Bug reports, ideas, and pull requests are all welcome.

Found a security problem? Don't open an issue. Follow [SECURITY.md](SECURITY.md) instead.

## Reporting a bug

Open an issue and include:

- What you did, what you expected, and what happened instead
- Your browser and its version
- A sample PDF that shows the problem, if you can share one. Remove anything private first.

## Suggesting a feature

Open an issue before you start on anything large, so we can agree on the approach before you spend time on it.

## Setting up

You need Node.js `^20.19.0 || ^22.13.0 || >=24` and [pnpm](https://pnpm.io/).

```bash
pnpm install
pnpm dev
```

See the [README](README.md) for the full list of scripts.

## Making a change

1. Fork the repo and create a branch from `main`. Name it after the kind of change, for example `feat/page-labels`, `fix/rotated-text`, or `docs/shortcuts`.
2. Keep each pull request to one change. Small pull requests get reviewed faster.
3. Add or update tests in `test/` when you change behavior.
4. Use the words in [GLOSSARY.md](GLOSSARY.md) when you name things in code and docs.

## Commit messages

Start with a type, then say what the change does in plain words:

```text
feat: add page labels to the thumbnail sidebar
fix: stop OCR on pages that scrolled out of view
docs: explain the export size limit
```

Types in use: `feat`, `fix`, `docs`, `chore`, `ci`, `test`, `refactor`.

## Before you open a pull request

These are the same checks CI runs on every pull request:

```bash
pnpm check
pnpm typecheck
pnpm test
```

`pnpm fix` fixes most lint and format problems for you. A pre-commit hook also runs it on staged files.

In the pull request, explain what changed and why. Add a screenshot or a short clip if the change is visible.

## License

Paperoo is licensed under [AGPL-3.0](LICENSE). By opening a pull request, you agree that your contribution is shared under the same license.
