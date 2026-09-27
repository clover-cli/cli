# Setup

## Requirements

- Node.js 22.13 or newer
- An AWS access key and secret key ([how to get them](#getting-aws-credentials))

## Getting AWS credentials

Clover needs an IAM user with an access key. Setting it up once with the policy below lets every
`clover aws` command work, so you won't have to come back and add permissions later.

### 1. Create the policy

1. Sign in to the [AWS Console](https://console.aws.amazon.com/) and open **IAM → Policies → Create policy**.
2. Switch to the **JSON** tab and paste the policy below.
3. Click **Next**, name it `CloverCLI`, and click **Create policy**.

<details>
<summary>CloverCLI policy</summary>

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListResources",
      "Effect": "Allow",
      "Action": ["tag:GetResources"],
      "Resource": "*"
    },
    {
      "Sid": "EC2",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "ec2:DescribeImages",
        "ec2:RunInstances",
        "ec2:CreateTags",
        "ec2:DeleteTags",
        "ec2:ModifyInstanceAttribute",
        "ec2:StartInstances",
        "ec2:StopInstances",
        "ec2:RebootInstances",
        "ec2:TerminateInstances",
        "ssm:GetParameters"
      ],
      "Resource": "*"
    },
    {
      "Sid": "DefaultNetwork",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeVpcs",
        "ec2:DescribeSubnets",
        "ec2:DescribeAvailabilityZones",
        "ec2:CreateDefaultVpc",
        "ec2:CreateDefaultSubnet"
      ],
      "Resource": "*"
    },
    {
      "Sid": "RDS",
      "Effect": "Allow",
      "Action": [
        "rds:DescribeDBInstances",
        "rds:CreateDBInstance",
        "rds:ModifyDBInstance",
        "rds:AddTagsToResource",
        "rds:StartDBInstance",
        "rds:StopDBInstance",
        "rds:RebootDBInstance",
        "rds:DeleteDBInstance",
        "rds:CreateDBSnapshot"
      ],
      "Resource": "*"
    },
    {
      "Sid": "RDSGeneratedPassword",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:CreateSecret",
        "secretsmanager:TagResource",
        "kms:DescribeKey"
      ],
      "Resource": "*"
    },
    {
      "Sid": "RDSServiceLinkedRole",
      "Effect": "Allow",
      "Action": "iam:CreateServiceLinkedRole",
      "Resource": "*",
      "Condition": { "StringEquals": { "iam:AWSServiceName": "rds.amazonaws.com" } }
    },
    {
      "Sid": "DynamoDB",
      "Effect": "Allow",
      "Action": [
        "dynamodb:ListTables",
        "dynamodb:DescribeTable",
        "dynamodb:DescribeTimeToLive",
        "dynamodb:CreateTable",
        "dynamodb:UpdateTable",
        "dynamodb:UpdateTimeToLive",
        "dynamodb:TagResource",
        "dynamodb:DeleteTable",
        "dynamodb:PutItem",
        "dynamodb:BatchWriteItem",
        "dynamodb:GetItem",
        "dynamodb:DeleteItem",
        "dynamodb:Scan"
      ],
      "Resource": "*"
    },
    {
      "Sid": "S3",
      "Effect": "Allow",
      "Action": [
        "s3:ListAllMyBuckets",
        "s3:CreateBucket",
        "s3:DeleteBucket",
        "s3:GetBucketLocation",
        "s3:GetBucketVersioning",
        "s3:PutBucketVersioning",
        "s3:GetBucketTagging",
        "s3:PutBucketTagging",
        "s3:ListBucket",
        "s3:ListBucketVersions",
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:DeleteObjectVersion"
      ],
      "Resource": "*"
    },
    {
      "Sid": "Lambda",
      "Effect": "Allow",
      "Action": [
        "lambda:ListFunctions",
        "lambda:GetFunction",
        "lambda:CreateFunction",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:TagResource",
        "lambda:DeleteFunction",
        "lambda:InvokeFunction"
      ],
      "Resource": "*"
    },
    {
      "Sid": "LambdaPassRole",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "*",
      "Condition": { "StringEquals": { "iam:PassedToService": "lambda.amazonaws.com" } }
    },
    {
      "Sid": "IAMInspect",
      "Effect": "Allow",
      "Action": [
        "iam:ListAttachedUserPolicies",
        "iam:ListUserPolicies",
        "iam:ListGroupsForUser",
        "iam:ListAttachedGroupPolicies",
        "iam:ListGroupPolicies",
        "iam:ListAttachedRolePolicies",
        "iam:ListRolePolicies",
        "iam:GetRole",
        "iam:SimulatePrincipalPolicy"
      ],
      "Resource": "*"
    }
  ]
}
```

</details>

Each statement matches a part of the CLI, so you can delete the ones for services you don't use.
`iam:PassRole` is limited to roles handed to Lambda (`lambda create --role`), and
`iam:CreateServiceLinkedRole` to the role RDS creates for itself the first time you make a database.

### 2. Create the user

1. Open **IAM → Users → Create user** and give it a name (e.g. `clover-cli`).
2. Choose **Attach policies directly**, search for `CloverCLI`, select it, and create the user.

### 3. Create an access key

1. Open the new user, go to **Security credentials → Create access key**, and pick **Command Line Interface (CLI)**.
2. Copy the **Access key ID** and **Secret access key**. The secret is only shown once.

Use these values with `aws login`, or set them as [environment variables](commands.md#aws). Then run
`clover aws iam check` to confirm every command is allowed.

<details>
<summary>Same steps with the AWS CLI</summary>

Save the policy above as `clover-policy.json`, then, with an admin profile:

```sh
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
aws iam create-policy --policy-name CloverCLI --policy-document file://clover-policy.json
aws iam create-user --user-name clover-cli
aws iam attach-user-policy --user-name clover-cli --policy-arn "arn:aws:iam::$ACCOUNT:policy/CloverCLI"
aws iam create-access-key --user-name clover-cli
```

</details>

> Only need to look around? Attach the AWS managed **ReadOnlyAccess** policy instead. That's enough
> for `whoami`, `list-resources` and every `list`/`get` command, but not for creating, changing or
> deleting anything.

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
