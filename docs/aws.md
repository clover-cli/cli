# AWS services

Clover can create, read, update and delete resources in these AWS services:

| Service | Command | Resources |
| --- | --- | --- |
| [EC2](#ec2) | `clover aws ec2` | Instances |
| [RDS](#rds) | `clover aws rds` | Database instances |
| [DynamoDB](#dynamodb) | `clover aws dynamodb` (or `ddb`) | Tables and items |
| [S3](#s3) | `clover aws s3` | Buckets and objects |
| [Lambda](#lambda) | `clover aws lambda` | Functions |
| [IAM](#iam) | `clover aws iam` | Your own policies and permissions (read-only) |

Every command follows the same shape:

```sh
clover aws <service> <action> [name or ID] [options]
```

Every service has the actions `create`, `list`, `get`, `update` and `delete`, and some have more
(`start`, `stop`, `invoke`, `put-item`, `upload`, ...). Add `--help` to any of them to see all
options, e.g. `clover aws ec2 create --help`.

Credentials come from the environment, as for every other command. See
[commands.md](commands.md#aws) to set them up, and [IAM permissions](#iam-permissions) for what the
account needs.

## Doing everything in one command

Anything that would normally take several steps in the AWS console or CLI can be done with one
Clover command. Nothing is ever prompted for, except a confirmation before deleting.

### Options every service accepts

| Option | Description |
| --- | --- |
| `--region <region>` | Run this command in another region (overrides `AWS_REGION`) |
| `--output table\|json` | `table` (default) for people, `json` for scripts and `jq` |
| `--config <file.json>` | Read any of the command's options from a JSON file |
| `--project <name>` | Clover project for this command (default: the current one, see `clover project use`) |

While a project is active, `create` tags the new resource with `clover:project=<name>`, so it
belongs to that project from any machine, and `list` shows only that project's resources (found
through the tag, with `tag:GetResources`). Run `clover project use --none` to see everything again.

### `--config`: options from a file

Keep a resource's settings in a JSON file and create it with one command. The keys are the option
names (without `--`), and flags given on the command line win over the file:

```json
{
  "image": "ubuntu-24.04",
  "instance-type": "t3.small",
  "name": "web",
  "key-name": "my-key",
  "security-group-ids": ["sg-0123456789abcdef0"],
  "volume-size": 30,
  "user-data": "@setup.sh",
  "tags": ["env=prod", "team=web"],
  "region": "eu-west-1",
  "wait": true
}
```

```sh
clover aws ec2 create --config web.json
clover aws ec2 create --config web.json --name web-2   # same settings, another name
```

Unknown keys are rejected, so a typo in the file fails before anything is created.

### Other shared conventions

- **`--wait`**: waits until AWS has finished (the instance is running, the database is available,
  the table is active, ...) before returning, up to 30 minutes. Handy in scripts where the next
  step needs the resource.
- **`--yes` / `-y`**: skips the confirmation before deleting. Without a terminal (in scripts and
  CI) deletes **require** `--yes`, so nothing is deleted by accident.
- **`--force`** on `delete`: removes whatever blocks the delete first (termination/deletion
  protection, or the objects in an S3 bucket).
- **`--tags Key=Value`**: repeatable: `--tags env=prod --tags team=web`.
- **`@file`**: options that take a script or JSON (`--user-data`, `--item`, `--key`, `--payload`)
  read it from a file when prefixed with `@`, e.g. `--item @users.json`.
- **Booleans** can be turned off with `--no-`, e.g. `--no-public-ip`, `--no-deletion-protection`.
- **Output**: status messages go to stderr and results to stdout, so `--output json` can be piped:

  ```sh
  clover aws ec2 list --state running --output json | jq -r '.[].publicIp'
  ```

## EC2

```sh
clover aws ec2 <create|list|get|update|delete|start|stop|reboot>
```

| Action | What it does |
| --- | --- |
| `create` | Launch one or more instances |
| `list` | List instances, optionally filtered by state or tag |
| `get <id>` | Show one instance |
| `update <id>` | Change the instance type, tags or termination protection |
| `delete <ids..>` | Terminate instances |
| `start <ids..>` / `stop <ids..>` / `reboot <ids..>` | Change the power state |

### `create`

| Option | Default | Description |
| --- | --- | --- |
| `--image` | `al2023` | AMI ID, or an alias: `al2023`, `al2023-arm64`, `ubuntu-24.04`, `ubuntu-24.04-arm64` |
| `--instance-type`, `--type` | `t3.micro` | Instance type |
| `--count` | `1` | How many identical instances to launch |
| `--name` | | `Name` tag |
| `--key-name` | | Key pair for SSH |
| `--security-group-ids` | default group | One or more security group IDs |
| `--subnet-id` | default VPC | Subnet to launch in |
| `--user-data` | | Startup script, inline or `@file` (base64-encoded for you) |
| `--volume-size` | AMI default | Root volume size in GiB (gp3) |
| `--public-ip` / `--no-public-ip` | subnet default | Whether to assign a public IP |
| `--iam-profile` | | Instance profile name or ARN |
| `--tags` | | Extra tags; they're applied to the instance and its volume |
| `--wait` | | Wait until running, then show the IPs |

Image aliases always resolve to the latest AMI in the region the command runs in (through AWS's
public SSM parameters), so there's no need to look up AMI IDs per region.

```sh
# A running Ubuntu web server with a 30 GiB disk and a startup script, in one command
clover aws ec2 create --image ubuntu-24.04 --type t3.small --name web \
  --key-name my-key --volume-size 30 --user-data @setup.sh --tags env=prod --wait
```

### `list`

| Option | Description |
| --- | --- |
| `--state` | Only these states: `pending`, `running`, `stopping`, `stopped`, ... |
| `--tag` | Only instances with this tag, `Key=Value` (repeatable) |

### `update <id>`

| Option | Description |
| --- | --- |
| `--instance-type`, `--type` | New instance type. The instance must be stopped... |
| `--restart` | ...or pass this to stop it, change the type and start it again in one go |
| `--name` | New `Name` tag |
| `--tags` / `--remove-tags` | Tags to add or change / tag keys to remove |
| `--termination-protection` / `--no-termination-protection` | Protect against termination |

```sh
clover aws ec2 update i-0abc123 --type t3.large --restart
```

### `delete <ids..>`

| Option | Description |
| --- | --- |
| `--force` | Turn off termination protection first |
| `--yes`, `-y` | Don't ask for confirmation |
| `--wait` | Wait until terminated |

`stop` also takes `--force` (hard stop) and `--wait`; `start` takes `--wait`.

## RDS

```sh
clover aws rds <create|list|get|update|delete|start|stop|reboot>
```

| Action | What it does |
| --- | --- |
| `create <id>` | Create a database instance |
| `list` | List database instances |
| `get <id>` | Show one instance, including its endpoint and port |
| `update <id>` | Resize, change storage, password, backups, protection, tags, ... |
| `delete <id>` | Delete an instance, optionally with a final snapshot |
| `start <id>` / `stop <id>` / `reboot <id>` | Change the power state |

### `create <id>`

| Option | Default | Description |
| --- | --- | --- |
| `--engine` | `postgres` | `postgres`, `mysql`, `mariadb`, ... |
| `--engine-version` | latest | Engine version |
| `--instance-class`, `--class` | `db.t3.micro` | Instance class |
| `--storage` | `20` | Storage in GiB |
| `--storage-type` | AWS default | `gp3`, `gp2`, `io1`, ... |
| `--username` | `dbadmin` | Master username |
| `--password` | generated | Master password. When omitted, AWS generates one and stores it in Secrets Manager (`passwordSecret` in the output) |
| `--database` | | Name of a database to create inside the instance |
| `--port` | engine default | |
| `--multi-az` | | Keep a standby in another availability zone |
| `--public` | | Reachable from outside the VPC |
| `--security-group-ids` | default group | VPC security groups |
| `--subnet-group` | default | DB subnet group |
| `--backup-retention` | AWS default | Days to keep automated backups (`0` turns them off) |
| `--deletion-protection` | | Block deletes until turned off |
| `--tags` | | |
| `--wait` | | Wait until available (usually 5-15 minutes) |

```sh
# A Postgres database, ready to connect to when the command returns
clover aws rds create app-db --database app --wait
clover aws rds get app-db   # endpoint, port and the secret holding the password
```

Without `--subnet-group`, RDS puts the database in the account's default network (default VPC and
subnets). If the region doesn't have one, e.g. *No default subnet detected in VPC*, `create`
restores AWS's default VPC and subnets (free) and tries again. This needs the EC2 permissions
`ec2:DescribeVpcs`, `ec2:CreateDefaultVpc`, `ec2:DescribeAvailabilityZones`, `ec2:DescribeSubnets`
and `ec2:CreateDefaultSubnet` (all in `AmazonEC2FullAccess`).

### `update <id>`

`--instance-class`, `--storage` (can only grow), `--engine-version`, `--password`,
`--backup-retention`, `--multi-az`, `--public`, `--deletion-protection`, `--security-group-ids`
and `--tags`, plus:

| Option | Description |
| --- | --- |
| `--apply-immediately` | Apply now. Without it, some changes (like the class) wait for the next maintenance window |
| `--wait` | Wait until the changes are applied and the database is available again |

```sh
clover aws rds update app-db --class db.t3.medium --storage 100 --apply-immediately --wait
```

### `delete <id>`

| Option | Description |
| --- | --- |
| `--final-snapshot <name>` | Take a final snapshot. **Without it, no snapshot is taken.** |
| `--keep-backups` | Keep automated backups |
| `--force` | Turn off deletion protection first |
| `--yes`, `-y` / `--wait` | |

`stop` takes `--snapshot <name>` (AWS restarts stopped databases after 7 days); `reboot` takes
`--failover` (Multi-AZ only) and `--wait`.

## DynamoDB

```sh
clover aws dynamodb <create|list|get|update|delete|put-item|get-item|delete-item|scan>
clover aws ddb ...   # short alias
```

| Action | What it does |
| --- | --- |
| `create <table>` | Create a table |
| `list` | List tables |
| `get <table>` | Show a table's keys, billing, item count, size and TTL |
| `update <table>` | Change billing, capacity, TTL, deletion protection or tags |
| `delete <table>` | Delete a table and every item in it |
| `put-item <table>` | Create or replace one item, or many at once |
| `get-item <table>` | Read one item by key |
| `delete-item <table>` | Delete one item by key |
| `scan <table>` | Read items |

Keys are written as `name` or `name:TYPE`, where `TYPE` is `S` (string, the default), `N` (number)
or `B` (binary).

### `create <table>`

| Option | Default | Description |
| --- | --- | --- |
| `--partition-key`, `--pk` | required | e.g. `id`, `userId:S` |
| `--sort-key`, `--sk` | | e.g. `createdAt:N` |
| `--billing` | `on-demand` | `on-demand` or `provisioned` |
| `--read-capacity` / `--write-capacity` | `5` | Capacity units. Giving either one switches billing to provisioned |
| `--ttl-attribute` | | Attribute holding an expiry time (epoch seconds). Waits for the table, then turns TTL on |
| `--deletion-protection` | | |
| `--tags` / `--wait` | | |

```sh
clover aws ddb create users --pk id
clover aws ddb create events --pk userId --sk ts:N --ttl-attribute expiresAt --tags env=prod
```

### `update <table>`

`--billing`, `--read-capacity`, `--write-capacity`, `--deletion-protection`, `--tags`, `--wait`, and
`--ttl-attribute <name>` to turn TTL on (`--ttl-attribute ""` turns it off).

### `delete <table>`

`--force` (turn off deletion protection first), `--yes`, `--wait`.

### Items

Items are plain JSON; Clover converts them to and from DynamoDB's typed format.

```sh
clover aws ddb put-item users --item '{"id": "1", "name": "Ada", "age": 36}'
clover aws ddb put-item users --item @users.json   # a JSON array: written 25 at a time
clover aws ddb get-item users --key '{"id": "1"}'
clover aws ddb delete-item users --key '{"id": "1"}'
clover aws ddb scan users --limit 100              # default 25; --limit 0 reads everything
```

`put-item` with an array uses batch writes and retries items DynamoDB throttles. `get-item` exits
with code 1 when the item doesn't exist.

## S3

```sh
clover aws s3 <create|list|get|update|delete|objects|upload|download|delete-object>
```

| Action | What it does |
| --- | --- |
| `create <bucket>` | Create a bucket in the command's region |
| `list` | List every bucket in the account (buckets are global) |
| `get <bucket>` | Show a bucket's region, versioning and tags |
| `update <bucket>` | Change versioning or tags |
| `delete <bucket>` | Delete a bucket |
| `objects <bucket>` | List objects (`--prefix`, `--limit`, default 100, `0` for all) |
| `upload <bucket> <file>` | Upload a file (`--key`, default the file name; `--content-type`) |
| `download <bucket> <key>` | Download an object (`--file`, default the key's file name) |
| `delete-object <bucket> <key>` | Delete an object (`--yes`) |

### `create <bucket>`

| Option | Description |
| --- | --- |
| `--versioning` | Turn on versioning |
| `--tags` | Tags |
| `--region` | Region to create it in |

```sh
clover aws s3 create my-app-assets --region eu-west-1 --versioning --tags env=prod
clover aws s3 upload my-app-assets ./dist/index.html --content-type text/html
```

### `update <bucket>`

| Option | Description |
| --- | --- |
| `--versioning` / `--no-versioning` | Enable or suspend versioning (S3 can't fully turn it off once on) |
| `--tags` / `--remove-tags` | Tags to add or change / keys to remove. Other tags are kept |

### `delete <bucket>`

S3 won't delete a bucket that still has objects in it. `--force` deletes every object and every
version first, then the bucket. Use with care.

```sh
clover aws s3 delete my-old-bucket --force --yes
```

Buckets can be used from any `--region`; requests are redirected to the bucket's region.

## Lambda

```sh
clover aws lambda <create|list|get|update|delete|invoke>
```

| Action | What it does |
| --- | --- |
| `create <name>` | Create a function |
| `list` | List functions |
| `get <name>` | Show a function's configuration |
| `update <name>` | Change code and/or configuration |
| `delete <name>` | Delete a function |
| `invoke <name>` | Run a function and print what it returns |

`--code` accepts a `.zip` file as-is, or **a file or folder, which Clover zips for you**, so no
separate packaging step is needed.

### `create <name>`

| Option | Default | Description |
| --- | --- | --- |
| `--code` | required | `.zip`, file or folder |
| `--role` | required | ARN of the IAM role the function runs as |
| `--runtime` | `nodejs22.x` | e.g. `python3.13`, `java21` |
| `--handler` | `index.handler` | `file.function` |
| `--memory` | `128` | MB |
| `--timeout` | `3` | Seconds (max 900) |
| `--architecture` | `x86_64` | `x86_64` or `arm64` |
| `--description` | | |
| `--env` | | Environment variables, `KEY=VALUE` (repeatable) |
| `--tags` / `--wait` | | |

```sh
clover aws lambda create hello --code index.mjs \
  --role arn:aws:iam::123456789012:role/lambda-basic --env STAGE=prod --wait
```

### `update <name>`

`--code`, `--runtime`, `--handler`, `--memory`, `--timeout`, `--role`, `--description`, `--tags`,
`--wait`, and:

| Option | Description |
| --- | --- |
| `--env KEY=VALUE` | Set variables; the function's other variables are kept |
| `--remove-env KEY` | Remove variables |

Code and configuration can change in the same command: Clover applies the configuration, waits for
it to finish, then uploads the code (Lambda only accepts one update at a time).

```sh
clover aws lambda update api --code ./build --memory 512 --env LOG_LEVEL=debug --wait
```

### `invoke <name>`

| Option | Description |
| --- | --- |
| `--payload` | The event, as JSON or `@file.json` |
| `--logs` | Also print the last 4 KB of logs (to stderr) |
| `--async` | Queue the event and return right away |

```sh
clover aws lambda invoke hello --payload '{"name": "Ada"}' --logs
```

The function's return value is printed as JSON. If the function throws, the error is printed and
the exit code is 1.

## IAM

```sh
clover aws iam <policies|check>
```

Read-only: these show what the current credentials may do. Changing permissions stays in the IAM
console (or your infrastructure as code).

| Action | What it does |
| --- | --- |
| `policies` | List the policies that apply to you: attached directly, inline, and through your groups |
| `check` | Check which Clover commands you're allowed to run (`--service s3 lambda` to check only some) |

```sh
clover aws iam policies
clover aws iam check --service lambda
clover aws iam check --output json | jq -r '.[] | select(.allowed | not) | .missing[]' | sort -u   # everything you're missing
```

`check` asks the [IAM policy simulator](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_testing-policies.html)
about every action each command calls. It takes identity policies, permissions boundaries and
Organizations SCPs into account, and checks against all resources (`*`), so a policy that only
allows some buckets or tables shows those commands as not allowed.

Both work for IAM users and for assumed roles. The root user has no policies to list.

## IAM permissions

The simplest setup is the `CloverCLI` policy in [setup.md](setup.md#getting-aws-credentials), which
covers every command. Otherwise, listing needs read-only access, and creating, changing and deleting
need write permissions for each service you use. For example, the
AWS managed policies `AmazonEC2FullAccess`, `AmazonRDSFullAccess`, `AmazonDynamoDBFullAccess`,
`AmazonS3FullAccess` and `AWSLambda_FullAccess`, or a narrower policy with just the actions you
need. A few extras worth knowing:

- `lambda create --role` needs `iam:PassRole` on that role.
- `ec2 create` with an image alias needs `ssm:GetParameters` (AWS resolves the alias through SSM).
- `rds create` without `--password` needs Secrets Manager permissions (`secretsmanager:CreateSecret`,
  `kms:DescribeKey`), which `AmazonRDSFullAccess` doesn't include.

- `iam policies` needs `iam:ListAttachedUserPolicies`, `iam:ListUserPolicies`, `iam:ListGroupsForUser`,
  `iam:ListAttachedGroupPolicies` and `iam:ListGroupPolicies` (for a role: `iam:ListAttachedRolePolicies`,
  `iam:ListRolePolicies`). `iam check` needs `iam:SimulatePrincipalPolicy` (and `iam:GetRole` for a role).
  `IAMReadOnlyAccess` covers them.

Run `clover aws iam check` to see which commands your credentials allow. If a permission is missing,
the command prints AWS's error and exits with code 1.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success, or a delete was cancelled at the prompt |
| `1` | AWS returned an error, an option was invalid, or `--yes` was missing without a terminal |
