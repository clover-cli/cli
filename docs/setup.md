# Setup

## Requirements

- Node.js 22.13 or newer
- An AWS access key and secret key ([how to get them](#getting-aws-credentials))

## Getting AWS credentials

1. Sign in to the [AWS Console](https://console.aws.amazon.com/) and open **IAM → Users → Create user**.
2. Give it a name (e.g. `clover-cli`), then choose **Attach policies directly** and select **ReadOnlyAccess**.
3. Open the new user, go to **Security credentials → Create access key**, and pick **Command Line Interface (CLI)**.
4. Copy the **Access key ID** and **Secret access key**. The secret is only shown once.

Use these values with `aws login`, or set them as [environment variables](commands.md#aws). Read-only access is enough for `whoami` and listing. To create, change or delete resources, the user also needs write permissions; see [aws.md](aws.md#iam-permissions).

<details>
<summary>Minimal policy (instead of ReadOnlyAccess)</summary>

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "ec2:DescribeInstances",
      "rds:DescribeDBInstances",
      "dynamodb:ListTables",
      "s3:ListAllMyBuckets",
      "lambda:ListFunctions",
      "tag:GetResources"
    ],
    "Resource": "*"
  }]
}
```

</details>

## Install

```sh
git clone https://github.com/clover-cli/cli.git
cd cli
npm install
npm run build
```

## Using `clover` as a command

To run `clover <command>` from anywhere instead of `node dist/index.js <command>`, link your
working copy globally:

```sh
npm run build
npm link
```

This creates a global `clover` command that points at this folder, so there's no need to reinstall
after making changes. Just rebuild with `npm run build`, or keep `npm run dev` running and the
command always uses the latest code.

Check that it works:

```sh
which clover     # should point into your Node global bin folder
clover --help
```

To remove the link:

```sh
npm unlink -g @clover-cli/cli
```

> If `clover` isn't found after linking, your Node global `bin` folder isn't on your `PATH`.
> Run `npm prefix -g` and add its `bin` subfolder to your `PATH`.
> (With nvm this is already on your `PATH`.)

If you only want to use the CLI and don't plan to change it, install the published package instead:

```sh
npm install -g @clover-cli/cli
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run build` | Clear `dist/`, then compile `src/` into it |
| `npm run dev` | Recompile on every change |
| `npm start -- <command>` | Run the compiled CLI |
| `npm run dev:run -- <command>` | Build, then run |
| `npm test` | Run the tests once |
| `npm run test:watch` | Re-run the tests on every change |
| `npm run lint` | Lint `src/` and `test/` with [Oxlint](https://oxc.rs) (rules in `.oxlintrc.json`) |
| `npm run lint:fix` | Lint and auto-fix what it can |

## Tests

Tests live in `test/` and use [Vitest](https://vitest.dev). AWS and terminal prompts are mocked
in `test/setup.ts`, so tests never touch your real account.

To test a new command, add `test/commands/<provider>/<command>.test.ts` and run it with
`runCli('aws <command> --flag value')` from `test/helpers.ts`.

CI (`.github/workflows/ci.yml`) runs `npm run lint`, `npm run build` and `npm test` on every pull request to `main` and every push to `main`.

## First run

```sh
eval "$(clover aws login)"  # prompts for key, secret and region, then exports them
clover aws whoami          # check the credentials work
clover aws list-resources  # see what's in your account
```

If you haven't run `npm link`, use `node dist/index.js` in place of `clover`.

See [commands.md](commands.md) for every command and option.

## Using the credentials in code

```ts
import { S3Client } from '@aws-sdk/client-s3';
import { getAwsClientConfig } from './provider/aws';

const s3 = new S3Client(getAwsClientConfig()); // reads the AWS_* environment variables
```

## Notes

- Credentials only live in your shell's environment. Never commit a `.env` file with keys in it
  (`.env` is git-ignored).
- Use `eval "$(clover aws logout)"` to remove them from the current shell.
