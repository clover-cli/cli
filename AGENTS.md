# AGENTS.md

Clover is a CLI (`clover`) for managing AWS resources. It's written in TypeScript and uses yargs and the AWS SDK v3.

## Commands

```sh
npm run build   # compile to dist/
npm test        # vitest
npm run lint    # oxlint
```

Run all three before you finish.

## Layout

- `src/args.ts`: the root CLI. It registers each provider.
- `src/commands/aws/aws.ts`: `clover aws ...`.
- `src/commands/aws/<service>.ts`: the CLI side: options, prompts and output.
- `src/commands/aws/shared.ts`: helpers for every command: `action()`, `print()`, `confirm()`, and more.
- `src/provider/aws-services/<service>.ts`: the AWS SDK calls. They return plain objects.
- `src/credentials.ts`, `src/provider/aws.ts`: credentials, read from `AWS_*` env vars.
- `src/projects.ts`: the local project store (`~/.config/clover/projects.json`). `src/commands/project.ts`: `clover project ...`.
- `docs/`: user docs and the man page.

## Rules

- Only `src/provider/` talks to AWS.
- Define actions with `action()` from `shared.ts`.
- Print with `print()` and `info()`. Support `--output json`.
- AWS `create` actions pass `tags: createTags(argv)`, and `list` actions wrap their result in `inProject(argv, items, idOf)`, so they follow the current project.
- Ask with `confirm()` before deleting. `--yes` skips the prompt.
- On error, just throw. `action()` prints the message and sets exit code 1.
- Tests never call AWS. Use `fakeClient()` and `runCli()` from `test/helpers.ts`.
- Don't comment code unless it's absolutely necessary (a non-obvious why, not a what). Never add a header comment at the top of a file describing what it does.

## Commits

Format: `<type>: <what>`, lowercase, one line, no body.

No AI attribution: no `Co-Authored-By` trailers, no "Generated with" lines, in commits or PRs.

- `feat`: a new feature
- `add`: new commands, services or deps
- `fix`: a bug fix
- `fix-docs`, `fix-lint`: fix docs or lint warnings
- `docs`: documentation
- `update`: change existing files (docs, tests, readme)
- `remove`, `move`: delete or move files
- `ver`: version bump, e.g. `ver: bump to 1.3.0`

Examples: `add: lambda commands`, `fix-docs: src/index`.

## Adding a service

1. `src/provider/aws-services/<service>.ts`: the SDK calls.
2. `src/commands/aws/<service>.ts`: the actions.
3. Register it in `src/commands/aws/aws.ts`.
4. Add its permissions to `COMMAND_ACTIONS` in `src/provider/aws-services/iam.ts`.
5. Add tests in `test/provider/aws-services/` and `test/commands/aws/`.
6. Document it in `docs/aws.md` and add its IAM policy to `docs/setup.md`.
7. Use `createTags(argv)` in `create` and `inProject()` in `list`, and add the service to the `project-tags` and `project-filter` tests.
