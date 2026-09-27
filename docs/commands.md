# Commands

Run with `npm run dev:run -- <command>` (builds first) or `node dist/index.js <command>`.
Add `--help` to any command to see its options.

## AWS

| Command | What it does |
| --- | --- |
| `clover aws login` | Verify AWS credentials and save them under a profile |
| `clover aws list` | List saved profiles |
| `clover aws whoami` | Check that a saved profile still works |
| `clover aws list-resources` | List resources in the profile's region (EC2, RDS, DynamoDB, S3, Lambda, other tagged resources) |
| `clover aws logout` | Delete saved credentials |

### Options

`--profile <name>` works on `login`, `whoami`, `list-resources` and `logout` (default: `default`).

**login** — any value not passed as a flag is prompted for.

| Flag | Description |
| --- | --- |
| `--access-key-id` | AWS access key ID |
| `--secret-access-key` | AWS secret access key |
| `--session-token` | Only for temporary credentials |
| `--region` | Default region (default: `us-east-1`) |

**logout**

| Flag | Description |
| --- | --- |
| `--all` | Delete every saved profile |

### Examples

```sh
clover aws login --profile work --region us-west-2
clover aws list
clover aws whoami --profile work
clover aws list-resources --profile work
clover aws logout --profile work
clover aws logout --all
```

Credentials are stored locally in `db/cred.sqlite`.
