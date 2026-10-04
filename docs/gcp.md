# GCP services

Every service command takes `--project` (overrides `GOOGLE_CLOUD_PROJECT`), `--region` (default `us-central1`) and `--output table|json`, plus `--config` like the AWS ones (see [aws.md](aws.md)).

## Compute

```sh
clover gcp compute <create|list|get|update|delete|start|stop|reboot>
```

| Action | What it does |
| --- | --- |
| `create <name>` | Create an instance |
| `list` | List instances in every zone, optionally filtered by status or label |
| `get <name>` | Show one instance |
| `update <name>` | Change the machine type, labels or deletion protection |
| `delete <names..>` | Delete instances |
| `start <names..>` / `stop <names..>` / `reboot <names..>` | Change the power state (`reboot` is a hard reset) |

Every action except `list` takes `--zone`, which defaults to `<region>-a` (e.g. `us-central1-a`).
`--project` overrides `GOOGLE_CLOUD_PROJECT`.

### `create <name>`

| Option | Default | Description |
| --- | --- | --- |
| `--name` | | The instance name, if not given as the positional |
| `--machine-type`, `--type` | `e2-micro` | Machine type |
| `--image` | `debian-12` | Image path, or an alias: `debian-12`, `debian-12-arm64`, `ubuntu-24.04`, `ubuntu-24.04-arm64` |
| `--disk-size` | image default | Boot disk size in GB |
| `--startup-script` | | Startup script, inline or `@file` |
| `--public-ip` / `--no-public-ip` | on | Whether to assign an external IP |
| `--labels` | | Labels as `Key=Value` (repeatable) |
| `--wait` | | Wait until created, then show the IPs |

Instances go on the `default` network. Image aliases point at image families, so they always
resolve to the latest image.

```sh
# A running Ubuntu web server with a 30 GB disk and a startup script, in one command
clover gcp compute create web --image ubuntu-24.04 --type e2-small \
  --disk-size 30 --startup-script @setup.sh --labels env=prod --wait
```

### `list`

| Option | Description |
| --- | --- |
| `--state` | Only these statuses: `running`, `terminated` (stopped), `staging`, ... |
| `--label` | Only instances with this label, `Key=Value` (repeatable) |

### `update <name>`

| Option | Description |
| --- | --- |
| `--machine-type`, `--type` | New machine type. The instance must be stopped... |
| `--restart` | ...or pass this to stop it, change the type and start it again in one go |
| `--labels` / `--remove-labels` | Labels to add or change / label keys to remove |
| `--deletion-protection` / `--no-deletion-protection` | Protect against deletion |

```sh
clover gcp compute update web --type e2-standard-2 --restart
```

### `delete <names..>`

| Option | Description |
| --- | --- |
| `--force` | Turn off deletion protection first |
| `--yes`, `-y` | Don't ask for confirmation |
| `--wait` | Wait until deleted |

`start`, `stop` and `reboot` take `--wait`.

## Cloud SQL

```sh
clover gcp sql <create|list|get|update|delete|start|stop|reboot>
```

| Action | What it does |
| --- | --- |
| `create <id>` | Create a Cloud SQL instance |
| `list` | List instances |
| `get <id>` | Show one instance, including its IP and connection name |
| `update <id>` | Change the tier, storage, public IP, deletion protection or labels |
| `delete <id>` | Delete an instance and its automated backups |
| `start <id>` / `stop <id>` / `reboot <id>` | Change the power state |

Every action takes `--project` (default `GOOGLE_CLOUD_PROJECT`) and `--output`. `create` uses
`--region` (default `us-central1`).

### `create <id>`

| Option | Default | Description |
| --- | --- | --- |
| `--database-version`, `--engine` | `POSTGRES_16` | `POSTGRES_16`, `MYSQL_8_0`, `SQLSERVER_2022_EXPRESS`, ... |
| `--tier` | `db-f1-micro` | Machine tier |
| `--storage` | `10` | Storage in GiB |
| `--password` | asked | Root user password (`postgres`, `root` or `sqlserver`). Required when not in a terminal |
| `--public` | GCP default | Give the instance a public IPv4 address |
| `--deletion-protection` | | Block deletes until turned off |
| `--labels` | | `Key=Value` (repeatable) |
| `--wait` | | Wait until the instance is ready (usually 5-15 minutes) |

```sh
# A Postgres database, ready to connect to when the command returns
clover gcp sql create app-db --wait
clover gcp sql get app-db   # IP and connection name
```

### `update <id>`

`--tier` (restarts the instance), `--storage` (can only grow), `--public`,
`--deletion-protection` and `--labels` (added to the existing ones), plus `--wait`.
Changes apply immediately.

```sh
clover gcp sql update app-db --tier db-g1-small --storage 50 --wait
```

### `delete <id>`

| Option | Description |
| --- | --- |
| `--force` | Turn off deletion protection first |
| `--yes`, `-y` / `--wait` | |

`start` and `stop` set the activation policy to `ALWAYS` / `NEVER` (a stopped instance still
bills for storage); `reboot` restarts it. All three take `--wait`.

## Firestore

```sh
clover gcp firestore <create|list|get|update|delete|put-item|get-item|delete-item|scan>
```

| Action | What it does |
| --- | --- |
| `create <database>` | Create a database (native mode) in `--region` |
| `list` | List databases |
| `get <database>` | Show a database's location, type, deletion protection and point-in-time recovery |
| `update <database>` | Change deletion protection |
| `delete <database>` | Delete a database and every document in it |
| `put-item <database>` | Create or replace one document |
| `get-item <database>` | Read one document |
| `delete-item <database>` | Delete one document |
| `scan <database>` | Read documents from a collection |

Use `default` for the `(default)` database.

### `create <database>`

| Option | Default | Description |
| --- | --- | --- |
| `--region` | `us-central1` | A region or multi-region, e.g. `nam5`, `eur3` |
| `--deletion-protection` | | |
| `--wait` | | Wait for the create operation to finish |

```sh
clover gcp firestore create default --region nam5 --wait
clover gcp firestore create users --deletion-protection
```

### `update <database>`

`--deletion-protection` / `--no-deletion-protection`, `--wait`.

### `delete <database>`

`--force` (turn off deletion protection first), `--yes`, `--wait`.

### Documents

Documents are plain JSON; Clover converts them to and from Firestore's typed values. Every document
action takes `--collection` (a path like `users` or `users/1/posts`) and, except `scan`, `--id`.

```sh
clover gcp firestore put-item default --collection users --id 1 --item '{"name": "Ada", "age": 36}'
clover gcp firestore put-item default --collection users --id 1 --item @ada.json
clover gcp firestore get-item default --collection users --id 1
clover gcp firestore delete-item default --collection users --id 1
clover gcp firestore scan default --collection users --limit 100   # default 25; --limit 0 reads everything
```

`get-item` exits with code 1 when the document doesn't exist. Integers are stored as `integerValue`,
other numbers as `doubleValue`; timestamps, references and bytes are read back as strings.

## Storage

```sh
clover gcp storage <create|list|get|update|delete|objects|upload|download|delete-object>
```

| Action | What it does |
| --- | --- |
| `create <bucket>` | Create a bucket in the command's region |
| `list` | List every bucket in the project (buckets are global) |
| `get <bucket>` | Show a bucket's location, storage class, versioning and labels |
| `update <bucket>` | Change versioning or labels |
| `delete <bucket>` | Delete a bucket |
| `objects <bucket>` | List objects (`--prefix`) |
| `upload <bucket> <file>` | Upload a file (`--key`, default the file name; `--content-type`) |
| `download <bucket> <key>` | Download an object (`--file`, default the key's file name) |
| `delete-object <bucket> <key>` | Delete an object (`--yes`) |

### `create <bucket>`

| Option | Description |
| --- | --- |
| `--versioning` | Turn on versioning |
| `--labels` | Labels as `Key=Value` |
| `--region` | Location to create it in (default `us-central1`) |

```sh
clover gcp storage create my-app-assets --region europe-west1 --versioning --labels env=prod
clover gcp storage upload my-app-assets ./dist/index.html --content-type text/html
```

### `update <bucket>`

| Option | Description |
| --- | --- |
| `--versioning` / `--no-versioning` | Turn versioning on or off |
| `--labels` / `--remove-labels` | Labels to add or change / keys to remove. Other labels are kept |

### `delete <bucket>`

Cloud Storage won't delete a bucket that still has objects in it. `--force` deletes every object and
every noncurrent version first, then the bucket. Use with care.

```sh
clover gcp storage delete my-old-bucket --force --yes
```
