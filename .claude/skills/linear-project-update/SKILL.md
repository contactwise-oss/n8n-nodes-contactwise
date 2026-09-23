---
name: linear-project-update
description: Draft and post a Linear project update (a status update with a health rating) for the project named in the "## Linear" section of CLAUDE.md. Reads milestones, issues, the previous update and repo signals, shows the draft, and posts only after the developer approves. Use when asked for a Linear project update, status update, weekly update, or "where are we" to be posted in Linear.
argument-hint: "[optional focus or note to include]"
---

# Linear project update

Posts a status update to a Linear project. This skill works in any repo; the project comes from CLAUDE.md. The issue rules are in the `linear-issue-management` skill.

## 0. Load settings

1. Read the `## Linear` section of `CLAUDE.md` for **Project**, **Team** and the **Milestones** table. If it's missing, stop and offer `/linear-issue-management setup`.
2. If the Linear tools are deferred, load them with ToolSearch: `get_status_updates`, `list_milestones`, `list_issues`, `get_issue`, `list_comments`, `save_status_update`.

## 1. Gather

Run these in parallel. `<project>` is the Project from CLAUDE.md.

- `get_status_updates` with `type: "project"`, `project: <project>`, `limit: 1`. The **previous update's `createdAt` is the start of the reporting window**. If there's no previous update, use the last 7 days.
- `list_milestones` for the project: names, target dates, progress.
- `list_issues` for the project with fields `id, title, status, statusType, priority, projectMilestone, parentId, completedAt, updatedAt`, `limit: 250`.
- Repo signals (read-only; skip any that don't apply):
  - `git log --since=<window start> --oneline` on the default branch
  - `gh pr list --state all --limit 20`
  - `gh run list --limit 5` (CI health)
  - The package registry version, if the repo publishes a package (e.g. `npm view <name> version`; a 404 means it isn't published yet).

For issues that are In Progress, In Review or blocked, read their latest comments (`list_comments`) to pick up progress and blockers. Don't read every issue.

## 2. Work out

- **Done in the window:** issues with `completedAt` after the window start.
- **In flight:** issues In Progress or In Review.
- **Blocked:** open issues in the current milestone with an open `blockedBy` issue (check with `get_issue` and `includeRelations: true`), plus blockers named in recent `## Progress` comments.
- **Per milestone:** progress %, target date, open count; whether it's on track for the target date.
- **Health:** pick one and give the reason in one sentence.
  - `onTrack`: the current milestone's open work fits before its target date, with no open Urgent blocker.
  - `atRisk`: an Urgent or High blocker, or a missed step that the date depends on, but it's recoverable.
  - `offTrack`: the target date will be missed, or a customer is blocked with no workaround.

## 3. Draft

Keep it short: someone should be able to read it in a minute. Link issue IDs and don't paste their descriptions.

```markdown
**Health: <On track | At risk | Off track>**: <one-sentence reason>

## Since last update (<window start date> → today)
- <shipped outcome, ISSUE-ID> …

## In progress
- <ISSUE-ID, what's happening, next step>

## Blocked / risks
- <ISSUE-ID, blocked by what or who, what unblocks it>

## Milestones
| Milestone | Progress | Target | Status |
|---|---|---|---|

## Next
- <the 3–5 most important next steps, in order>
```

If the developer gave an argument (`$ARGUMENTS`), work it into the draft where it fits.

## 4. Confirm, then post

1. Show the draft and the chosen health. Ask: **"Post this update?"** The developer can approve it, edit it, or change the health.
2. **Never post without explicit approval.** A project update is visible to the whole workspace.
3. On approval, call `save_status_update` with `type: "project"`, `project: <project>`, `health`, and `body` (the approved markdown, without the "**Health:**" line, since Linear shows health separately).
4. Reply with the update's link.
