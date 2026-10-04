# Commands

Run with `npm run dev:run -- <command>` (builds first) or `node dist/index.js <command>`.
Add `--help` to any command to see its options.

## Shell completion

`clover completion` prints a bash/zsh completion script. Add it to your shell config:

```sh
clover completion >> ~/.bashrc   # or ~/.zshrc
```

## AWS

Clover reads AWS credentials from the standard environment variables, the same ones the AWS CLI
and SDKs use. Nothing is written to disk.

| Variable | Required | Notes |
| --- | --- | --- |
| `AWS_ACCESS_KEY_ID` | yes | |
| `AWS_SECRET_ACCESS_KEY` | yes | |
| `AWS_SESSION_TOKEN` | no | Only for temporary credentials |
| `AWS_REGION` | no | Falls back to `AWS_DEFAULT_REGION`, then `us-east-1` |

| Command | What it does |
| --- | --- |
| `clover aws login` | Verify AWS credentials and print the `export` commands that set them |
| `clover aws whoami` | Check that the credentials in the environment work |
| `clover aws list-resources` | List resources in the configured region (EC2, RDS, DynamoDB, S3, Lambda, other tagged resources) |
| `clover aws logout` | Print the `unset` command that removes the credentials |
| `clover aws ec2 <action>` | Create, list, update and delete EC2 instances |
| `clover aws rds <action>` | Create, list, update and delete RDS databases |
| `clover aws dynamodb <action>` | Create, list, update and delete DynamoDB tables and items |
| `clover aws s3 <action>` | Create, list, update and delete S3 buckets and objects |
| `clover aws lambda <action>` | Create, list, update, delete and invoke Lambda functions |
| `clover aws iam <policies\|check>` | Show your IAM policies, and which Clover commands they allow |

See [aws.md](aws.md) for every service action and option, including how to do a whole setup in one
command with `--config`.

A program can't change its parent shell's environment, so `login` and `logout` print shell commands
instead. Wrap them in `eval` to apply them to the current shell. Prompts and messages go to stderr,
so only the commands are evaluated.

### Options

**login** — any value not passed as a flag is prompted for.

| Flag | Description |
| --- | --- |
| `--access-key-id` | AWS access key ID |
| `--secret-access-key` | AWS secret access key |
| `--session-token` | Only for temporary credentials |
| `--region` | Default region (default: `us-east-1`) |

### Examples

```sh
eval "$(clover aws login --region us-west-2)"   # prompts, verifies, then exports
clover aws whoami
clover aws list-resources
eval "$(clover aws logout)"

# Or set the variables yourself (e.g. in a .env file loaded by your shell or direnv)
export AWS_ACCESS_KEY_ID=AKIA...
export AWS_SECRET_ACCESS_KEY=...
clover aws whoami
```

The `eval` form works in bash and zsh. In other shells, run `clover aws login` and set the printed
variables yourself.

## GCP

Clover reads GCP credentials from the standard environment variables. Nothing is written to disk.

| Variable | Required | Notes |
| --- | --- | --- |
| `GOOGLE_CLOUD_PROJECT` | yes | Project ID |
| `GOOGLE_APPLICATION_CREDENTIALS` | no | Service account key file. Without it, the credentials from `gcloud auth application-default login` are used |

| Command | What it does |
| --- | --- |
| `clover gcp login` | Verify GCP credentials and print the `export` commands that set them (`--project`, `--key-file`) |
| `clover gcp whoami` | Check that the credentials in the environment work |
| `clover gcp logout` | Print the `unset` command that removes the credentials |
| `clover gcp compute <action>` | Create, list, update, delete, start, stop and reboot Compute Engine instances |
| `clover gcp sql <action>` | Create, list, update, delete, start, stop and reboot Cloud SQL instances |
| `clover gcp firestore <action>` | Create, list, update and delete Firestore databases and documents |

```sh
eval "$(clover gcp login --project my-project --key-file ~/key.json)"
clover gcp whoami
eval "$(clover gcp logout)"
```
