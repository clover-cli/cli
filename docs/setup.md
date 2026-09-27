# Setup

## Requirements

- Node.js 22.13 or newer (uses the built-in `node:sqlite` module)
- An AWS access key and secret key ([how to get them](#getting-aws-credentials))

## Getting AWS credentials

1. Sign in to the [AWS Console](https://console.aws.amazon.com/) and open **IAM → Users → Create user**.
2. Give it a name (e.g. `clover-cli`), then choose **Attach policies directly** and select **ReadOnlyAccess**.
3. Open the new user, go to **Security credentials → Create access key**, and pick **Command Line Interface (CLI)**.
4. Copy the **Access key ID** and **Secret access key**. The secret is only shown once.

Use these values with `aws login`. Clover only reads your account, so read-only access is enough.

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
mkdir -p db    # local credentials are stored in db/cred.sqlite
npm run build
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run build` | Compile `src/` into `dist/` |
| `npm run dev` | Recompile on every change |
| `npm start -- <command>` | Run the compiled CLI |
| `npm run dev:run -- <command>` | Build, then run |
| `npm test` | Run the tests once |
| `npm run test:watch` | Re-run the tests on every change |

## Tests

Tests live in `test/` and use [Vitest](https://vitest.dev). The database, AWS and terminal
prompts are mocked in `test/setup.ts`, so tests never touch your real credentials or account.

To test a new command, add `test/commands/<provider>/<command>.test.ts` and run it with
`runCli('aws <command> --flag value')` from `test/helpers.ts`.

CI (`.github/workflows/ci.yml`) runs `npm run build` and `npm test` on every pull request and push to `main`.

## First run

```sh
node dist/index.js aws login           # prompts for key, secret and region
node dist/index.js aws whoami          # check the saved profile works
node dist/index.js aws list-resources  # see what's in your account
```

See [commands.md](commands.md) for every command and option.

## Using a saved profile in code

```ts
import { S3Client } from '@aws-sdk/client-s3';
import { getAwsClientConfig } from './provider/aws';

const s3 = new S3Client(getAwsClientConfig('default'));
```

## Notes

- `db/*.sqlite` is git-ignored. It holds your secrets, so never commit it.
- Use `node dist/index.js aws logout --all` to remove every saved credential.
