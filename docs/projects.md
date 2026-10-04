# Projects

Clover keeps a local list of projects in `~/.config/clover/projects.json`. If `$XDG_CONFIG_HOME` is set, the file is `$XDG_CONFIG_HOME/clover/projects.json` instead. Clover creates the file and its directory the first time a project is created.

## Example

```json
{
  "current": "web-app",
  "projects": [
    { "name": "web-app", "created": "2026-10-04T09:15:42.118Z" },
    { "name": "data-pipeline", "created": "2026-10-04T09:20:07.903Z" }
  ]
}
```

## Fields

| Field | Type | Description |
| --- | --- | --- |
| `current` | string, optional | Name of the current project. Left out when no project is selected. |
| `projects` | array | Every known project. |
| `projects[].name` | string | Unique project name. |
| `projects[].created` | string | Creation time as an ISO 8601 UTC timestamp. |

## Notes

- Names use lowercase letters, digits and dashes. They start with a letter or digit and are at most 63 characters long, so they are safe to use as tag values.
- Deleting a project only removes it from this file. It does not touch any AWS resources.
- If the deleted project was the current one, `current` is cleared.
