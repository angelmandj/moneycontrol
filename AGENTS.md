# AGENTS.md

This project uses mechanical gates for all session operations. Future sessions will be validated against these gates rather than relying on model goodwill.

## Gates

1. **Session Branch Gate** - All work must occur on the session branch `arena/01a062d9-moneycontrol`.
2. **PR Gate** - A pull request must be opened from the session branch to `main`.
3. **Merge Gate** - The PR must be approved and merged via squash or merge commit.
4. **Artifact Gate** - Generated artifacts must not exceed 128 MB combined or 10,000 files.
5. **Git Gate** - Repository root and `.git` directory must not be deleted, renamed, or moved.

## Workflow

- Push workspace changes to the session branch.
- Open a PR to `main` from the session branch.
- Merge the PR to integrate changes.
- Future sessions will automatically enforce these gates.
