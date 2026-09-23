# Template: the `## Linear` section of CLAUDE.md

`/linear-issue-management setup` fills this in. Keep the bold field names exactly as shown: the enforcement hook reads **Team**, **Project** and **Type labels** by name. Replace every `<…>` placeholder.

```markdown
## Linear

Settings for the `linear-issue-management` and `linear-project-update` skills and the Linear issue hook. Regenerate with `/linear-issue-management setup`.

- **Workspace:** <workspace slug>
- **Team:** <team name> (key `<KEY>`)
- **Project:** <project name>
- **Assignee:** <me | user name> (<who, e.g. "the owner">)
- **Type labels:** Feature, Improvement, Bug
- **Area labels:** <comma-separated area labels that apply to this project>
- **Statuses:** Backlog → Todo → In Progress → In Review → Done (also Canceled, Duplicate)
- **Branches and commits:** use Linear's branch name (`<user>/<key>-<n>-<slug>`); reference `<KEY>-<n>` in commit messages

### Milestones

| Milestone | Contents |
|---|---|
| <name> | <what belongs here> |
| Backlog · Unscheduled | Work that isn't planned into a delivery milestone yet |

### Project-specific rules

- <exceptions or additions, e.g. where issues for another team go, and how they're titled>
```
