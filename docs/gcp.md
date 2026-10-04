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
