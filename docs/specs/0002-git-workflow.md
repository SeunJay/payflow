# 0002. Branch per feature through GitHub pull requests, squash merged, gated by local hooks and CI

**Date**: 2026-10-24
**Status**: Proposed

## Summary

PayFlow Lab lives in a private GitHub repo. Each scope feature gets its own short lived branch, its work lands as small Conventional Commits (messages like `feat(ledger): post transfers`), and it reaches `main` through a pull request that is squash merged (folded into one commit) once CI is green. The repo is on GitHub's free plan, which cannot enforce rules on a private repo, so the guard rails run on your machine (git hooks through Lefthook, secret scanning through gitleaks) and in GitHub Actions instead. The workflow skills offer each commit and you confirm it; nothing ever pushes for you.

## Context

The project has a scaffolded stack (feature 1, done) and zero commits: every file is untracked on a local `main`, with no remote and no backup. One person builds it, as a learning lab, guided by workflow skills (`/architect`, `/develop`, `/test`, `/debug`, `/sync`) that decide whether to offer commits by reading a `## Git` section in root `AGENTS.md`. That section does not exist yet, so today no skill offers a commit and nothing is recorded.

The work is organised as a scope of numbered features (`docs/scope/scope.md`), each closed at the Beta tier (`/check verify`, then `/test`). Foundation features come first, then fourteen Slice features, each teaching one reliability lesson (idempotency, outbox, reconciliation, and so on). Being able to look back at the system as it stood after each lesson has real learning value. So does a record of what changed in each feature and why.

The test suite is the project's main safety net. It has a unit project and an integration project that starts real Postgres 18 and Valkey 8 containers (Testcontainers, so Docker is required). The domain is payments, but there is no real money and no real credentials. The only secrets are local development passwords in `.env` (gitignored) and `.env.example` (committed on purpose).

The repo will live on GitHub, private, on the free plan. On that plan GitHub does not enforce branch rules (protected branches or rulesets) or secret scanning on private repos owned by a personal account. Any rule the workflow depends on therefore has to be enforced somewhere else, or it is only a convention. Lint and format tools are not installed yet; feature 2 installs them, after this decision.

## Options considered

### Option 1: Branch per feature, pull requests, squash merge, enforced by local hooks and CI

Every scope feature gets a branch named after its row, commits land on it step by step, and a PR carries it into `main`, squash merged once CI passes. Because the plan cannot enforce rules on the server, a Lefthook `pre-push` hook refuses pushes to `main`, a `pre-commit` hook scans staged changes with gitleaks, and GitHub Actions runs the full suite, a secret scan, and a PR title check on every PR.

**Pros**:
- `main` only ever moves by PR, so it stays green and each feature is one revertable commit
- Every feature leaves a PR record (description, CI result, review) that `/document pr` and `/check review` can attach to
- The full Testcontainers suite runs in a clean environment on every change, not only on your laptop
- Upgrading the plan later only adds server side enforcement; nothing in the flow changes

**Cons**:
- Local hooks can be skipped (`--no-verify`) or missing on a fresh clone until `lefthook install` runs; nothing stops a merge with red CI except habit
- More ceremony than committing to `main`: a branch, a push, and a PR per feature
- Two more tools to install and keep current (Lefthook, gitleaks), plus the `gh` CLI

### Option 2: Commit straight to `main`, local hooks only

Work happens directly on `main`, pushed to GitHub as a backup. Hooks run tests before each push; CI runs on `main` after the fact.

**Pros**:
- The fewest steps for a solo developer; no branches to name, sync, or clean up
- History is still Conventional and readable

**Cons**:
- `main` sits half built in the middle of every feature, and CI only reports a break after it has landed
- No per feature record to review, and no natural place for `/check review` or `/document pr`
- One feature's commits interleave with the next, so reverting a feature means picking out commits by hand

### Option 3: Same PR flow, enforced on the server (GitHub Pro or a public repo)

Option 1's flow, with GitHub rulesets requiring a PR and passing checks before `main` can move, and (on a public repo) GitHub push protection for secrets.

**Pros**:
- Enforcement cannot be skipped by a missing or bypassed local hook
- Auto merge becomes available (merge as soon as CI passes)

**Cons**:
- Costs money on a private repo (GitHub Pro), or makes the code public
- Secret scanning on a private repo still needs a paid add on, so a scanner like gitleaks is needed anyway

## Decision

**Chosen option**: Option 1: Branch per feature, pull requests, squash merge, enforced by local hooks and CI

Every scope feature is built on its own `<type>/<NN>-<slug>` branch, with skill offered Conventional Commits, and reaches `main` only through a CI checked, squash merged GitHub pull request. Lefthook and gitleaks enforce locally what the free plan cannot enforce on the server.

**Implementation skills**: `pnpm` (`antfu/skills`, `.claude/skills/pnpm/`, see `references/best-practices-ci.md` for the CI install and cache steps) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`, for the `--project unit` and `--project integration` runs)

## Rationale

The forces that decide this are one builder, a scope of numbered features each closed by a test run, and a learning goal that values looking back. A branch per scope feature maps that structure straight onto git: the branch name carries the scope number, the squash commit is the feature, and the PR is the feature's record. Option 2 saves a few commands a week, but leaves `main` broken for days at a time and loses the per feature record. That record is where `/check review` and `/document pr` naturally land, and it is the thing you will want when you revisit a lesson.

The free plan is the binding constraint on enforcement. Option 3 is the stronger design, but it either costs money or publishes the code. Even then, secret scanning on a private repo needs a scanner of your own. Option 1 puts every rule somewhere real (a hook, a CI job, or a repo setting the free plan does offer) and names the one gap it cannot close: a red PR can still be merged by hand. For a solo project that gap is acceptable, as long as the convention is explicit and CI makes red impossible to miss. If the plan changes, the same CI job names become required checks with no change to the flow.

Squash merge fits because commits on a branch are working history (one per skill step, so a bad step can be bisected and dropped inside the PR), while `main` should read as a list of finished features. With squash merge the PR title becomes the commit on `main`. That is why the format check applies to PR titles and not every commit: commitlint on each commit was the runner up, but it adds friction to throwaway work that the squash erases anyway.

## Standard definition

**Canonical pattern** (one feature, start to finish):

```bash
# 1. Start from an up to date main
git switch main && git pull --rebase
git switch -c feat/05-peer-transfers          # <type>/<NN>-<slug>, NN = scope row number
git push -u origin HEAD                        # publish the branch early: it is your backup

# 2. Build. Each skill step offers one Conventional Commit; you confirm.
#    feat(transfers): reserve funds before posting      (/develop milestone)
#    test(transfers): overspend and race suite           (/test)
#    fix(ledger): reject zero amount entries             (/debug)
git push                                       # at least at the end of every session

# 3. Keep the branch current by rebasing, never by merging main in
git fetch && git rebase origin/main
git push --force-with-lease                    # only ever on your own feature branch

# 4. The last branch commit carries the doc state: scope row done, spec Accepted.
#    Open the PR. Its title becomes the one commit on main.
gh pr create --title "feat(transfers): peer transfers with overspend protection" --fill

# 5. Merge only when every check is green
gh pr checks --watch --fail-fast && gh pr merge --squash --delete-branch

# 6. Slice features only: tag the squash commit on main
git switch main && git pull --rebase
git tag -a slice-02 -m "Slice 2: peer transfers with overspend protection"
git push origin slice-02
```

**Naming and messages**:

| Thing | Rule | Example |
|---|---|---|
| Branch | `<type>/<NN>-<slug>`. `NN` is the two digit number in the scope's `#` column. `slug` is a short kebab case form of the feature name (lowercase words joined by hyphens), at most 5 words; the skill that creates the branch proposes it and you confirm | `feat/05-peer-transfers`, `chore/02-coding-standards-tooling` |
| Branch `type` | The main kind of change: `feat` for Slice features, `chore` for foundation and tooling, `fix` for a bug fix, `docs` for scope or spec only work | `feat/04-signup-login-wallet` |
| Fix branches | `fix/<NN>-<slug>` when the bug is in scope feature NN (usually one already merged); `fix/<slug>` when it belongs to no feature | `fix/06-duplicate-idempotency-key`, `fix/ci-cache-key` |
| Work outside any scope row | `<type>/<slug>` with no number, only for `docs` and `fix` | `docs/scope-reconcile` |
| Commit and PR title | Conventional Commits, checked by the regex below. `<type>(<scope>)!: <subject>`, where scope and `!` are optional. The whole header is at most 72 characters. The subject is imperative, starts lowercase, and has no trailing period | `feat(ledger): derive balances from entries` |
| Commit `type` | `feat`, `fix`, `test`, `docs`, `refactor`, `perf`, `chore`, `ci`, `build`, `revert` | `revert(ledger): undo balance cache` |
| Commit `scope` | Lowercase `[a-z0-9-]+`, taken from the path the change touches: `apps/api` → `api`, `apps/worker` → `worker`, `apps/simulator` → `simulator`, `packages/core/src/modules/<m>` → `<m>` (for example `ledger`), `packages/core/src/infra` → `core`, any other `packages/<p>` → `<p>` (`http`, `shared`, `test-utils`), `docs/` → `docs`, dependencies → `deps`, `.github/` → `ci`. When a change spans several, use the main one or leave scope out | `fix(http): map body parser 4xx to problems` |
| Breaking change | `!` before the colon. The title alone carries it, because the squash body is left blank | `feat(http)!: rename problem code invalid_body` |
| Slice tag | Annotated tag `slice-NN` on the squash commit. Here `NN` comes from the scope's Phase column, not the `#` column (`Slice 2` → `slice-02`, on feature 5). Foundation features get no tag | `slice-02` |

The one regex (kept in `scripts/check-pr-title.sh`, the single place CI reads it from; Dependabot's `chore(deps)` prefix matches it):

```text
^(feat|fix|test|docs|refactor|perf|chore|ci|build|revert)(\([a-z0-9-]+\))?!?: [a-z].{0,70}[^.]$
```

The script also checks that the whole title is at most 72 characters, and lets GitHub's own `Revert "…"` titles through unchanged.

**Commit granularity**: one commit per skill step or tracked milestone on the branch (a `/develop` milestone, a `/test` suite, a `/debug` fix, a `/sync` doc update). The squash merge folds them into one commit on `main`.

**Skill integration** (`/audit` writes this as root `AGENTS.md` `## Git`; skills read it):

```markdown
## Git
- integration: on
- commit: offer (at the end of each skill run, the skill proposes one Conventional Commit; nothing is committed without your yes)
- push: never (you push, open the PR, and merge)
- branch: <type>/<NN>-<slug>, one per scope feature; never commit on main. A skill that finds changes on main offers to create the feature's branch first, proposing the slug
- diff scope on a feature branch: skills that work from "what changed" (/test, /check review) use `main...HEAD` plus the working tree, not only uncommitted files, because earlier steps are already committed
- merge: squash via pull request, only when CI is green; the PR title is the commit on main
- doc state: the last branch commit sets the scope row to done and the spec to Accepted
- tags: you create an annotated slice-NN tag on main after each Slice feature merges; /sync reminds you
```

**Gates** (where each check runs):

| Gate | Runs | Checks | Notes |
|---|---|---|---|
| `pre-commit` (Lefthook) | On every commit, in parallel | Refuse the commit if the current branch is `main` and `main` already has history; gitleaks on staged changes; format and lint on staged files once feature 2 installs them | Seconds. Format fixes are restaged automatically. If `gitleaks` is not installed the hook fails with an install hint, never skips |
| `pre-push` (Lefthook, `use_stdin: true`) | On every push | `scripts/` hook reads the `<local ref> <local sha> <remote ref> <remote sha>` lines on standard input and refuses any line whose remote ref is `refs/heads/main` (this also catches `HEAD:main` and multi ref pushes). Then `pnpm typecheck` and `pnpm test:unit`, skipped when every pushed ref is a tag or a deletion (all zero sha) | No Docker needed |
| CI `ci.yml`, job `checks` | `pull_request` (opened, synchronize, reopened) and `push` to `main` | `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:int` (Testcontainers on the runner's Docker); lint and format once feature 2 installs them | See *CI details* |
| CI `ci.yml`, job `secrets` | `pull_request` only | gitleaks over the PR's commits (`fetch-depth: 0`, range `origin/<base>..HEAD`) | `main` only moves through PRs that already passed it |
| CI `pr-title.yml` | `pull_request` (opened, edited, synchronize, reopened) | `scripts/check-pr-title.sh` on the PR title | A separate workflow, so editing a title does not rerun or cancel the suite |

**CI details**:
- pnpm comes from `pnpm/action-setup` reading `packageManager` in `package.json`; then `actions/setup-node` with `node-version-file: .nvmrc` and `cache: pnpm`
- Root scripts `test:unit` (`vitest run --project unit`) and `test:int` (`vitest run --project integration`) are added, because the bare `test` script is `vitest`, which watches locally
- gitleaks runs as a pinned release binary, not `gitleaks-action`
- Every third party action is pinned to a full commit hash; Dependabot's `github-actions` updates keep the hashes current
- Workflow `permissions` are read only (`contents: read`, plus `pull-requests: read` for the title check); each job has a `timeout-minutes`
- `concurrency` cancels an older run on the same PR when a newer push arrives; runs on `main` are never cancelled

**Repository settings** (all available on GitHub Free for a private repo), applied in bootstrap step 4 with `gh repo edit` and `gh api`:
- Merge commits and rebase merging off, squash merging on, merged branches deleted automatically (`gh repo edit --enable-merge-commit=false --enable-rebase-merge=false --enable-squash-merge --delete-branch-on-merge`)
- Squash commit title is the PR title and the body is blank (`gh api -X PATCH repos/<owner>/payflow-lab -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=BLANK`), so the PR title, and nothing else, becomes the commit on `main`
- Dependabot alerts on; version updates through `.github/dependabot.yml` for three ecosystems, weekly, each grouped into one PR, commit prefix `chore(deps)`: `npm` (covers pnpm and the workspace catalog), `github-actions`, and `docker-compose` (watches the `postgres:18` and `valkey/valkey:8` tags). The image tags inside the Testcontainers setup are not watched; keep them in step with `docker-compose.yml` by hand
- `.github/pull_request_template.md` with three headings: **Scope feature** (row number and spec link), **What changed**, **How it was verified** (tests run, `/check verify` result)

**Tracked files**: commit `.claude/skills/`, `skills-lock.json`, and `test-preferences.json`, so a fresh clone has the same skills and test setup. `.gitignore` gains `docs/.agent-cache/`, `dist/`, `coverage/`, `*.tsbuildinfo`, `.env.*` with `!.env.example`, and `.claude/settings.local.json`. `.env` stays ignored and `.env.example` stays committed; its development passwords are allowlisted in `.gitleaks.toml`, which feature 2 ships.

**Bootstrap** (once, now):
1. Expand `.gitignore` as above.
2. Scan the whole working tree by hand with gitleaks (the hooks do not exist yet). The only expected hits are the development passwords in `.env.example`.
3. Make one root commit on `main` with everything except `docs/specs/0002-git-workflow.md`: `chore: scaffold stack & architecture (feature 1)`. `docs/scope/scope.md` goes in as it stands; its feature 2 lines are planning text.
4. Create the private GitHub repo with `gh repo create`, push `main`, and apply the repository settings above.
5. Create `chore/02-coding-standards-tooling` and commit this spec there. Feature 2 then runs on that branch and ends with its own PR: the first one through the full flow.

**Replaces**:
- Untracked work with no history and no off machine copy
- Commits made directly on `main` (only the bootstrap root commit is allowed)
- Merge commits and rebase merges into `main`
- Free form commit messages and PR titles on `main`

**Enforcement**:
- Lefthook (`lefthook.yml` at the repo root, plus small hook scripts in `scripts/`): the `pre-commit` and `pre-push` gates above. A root `prepare` script runs `lefthook install` on `pnpm install`, and skips it only when there is no `.git` directory or `CI` is set; anywhere else a failure stops the install
- GitHub Actions: `ci.yml` (`checks`, `secrets`) and `pr-title.yml`
- Repository settings: squash only merging, PR title as the squash commit, automatic branch deletion
- Root `AGENTS.md` `## Git`: what the skills do
- By convention only (nothing enforces these on the free plan): never merge a PR whose checks are red (the `gh pr checks --watch --fail-fast &&` guard in step 5 makes it deliberate), and never push with `--no-verify`

**Rollout**: new work immediately. Feature 1 enters as the bootstrap root commit; feature 2 is the first feature on a branch. The hooks, scripts, CI workflows, Dependabot config, `.gitleaks.toml`, and PR template are built in feature 2's `/develop tooling` step, so they are first exercised by feature 2's own PR. Format and lint steps join the gates in that same feature, once those tools exist.

**Exceptions**:
- The bootstrap root commit goes straight to `main`, once, before the hooks exist
- Dependabot opens its own `dependabot/...` branches; they skip the branch naming rule but pass the same CI and are squash merged the same way
- No other exceptions. An urgent fix is a `fix/` branch and a PR like any other change

## Consequences

**Positive**:
- `main` is always green and reads as one commit per finished feature, each linked to its PR and scope row
- The full suite, including the real database tests, runs on every change in a clean environment
- Slice tags let you check out the system exactly as it stood after each lesson
- The skills start offering commits as soon as `AGENTS.md` carries `## Git`, so history builds itself as you work
- Upgrading to a paid plan later only means marking `checks`, `secrets`, and `pr-title` as required in a ruleset

**Negative / tradeoffs**:
- Nothing on the server stops a red PR from being merged or a hook from being bypassed; on the free plan that rests on habit, helped by the `gh pr checks --watch` guard before each merge
- A fresh clone has no hooks until `pnpm install` runs the `prepare` script
- Small shell scripts (`scripts/check-pr-title.sh` and the hook scripts) become project code to maintain
- `/test` and `/check review` currently scope themselves to uncommitted changes; until they read the `main...HEAD` rule, they can miss work already committed on the branch
- Each feature costs a branch, a push, a PR, and a merge, which feels heavy for a one line change
- The integration tests make CI take a few minutes and use the free plan's Actions minutes (about 2,000 a month on private repos, as of this writing; check your plan)
- Two more developer tools (Lefthook, gitleaks) plus the `gh` CLI to install and keep current

**Neutral**:
- Branch commits disappear from `main` on squash; they remain readable in the merged PR
- Dependabot PRs arrive weekly and need a glance and a merge, like any other PR

## Follow-up

- [ ] Before CI can pass: pnpm 12 failed `pnpm add` with `ERR_PNPM_IGNORED_BUILDS` for `cpu-features`, `ssh2`, and `protobufjs` (pulled in by Testcontainers). `pnpm install --frozen-lockfile` in CI will likely fail the same way. Decide each in `pnpm-workspace.yaml` `allowBuilds` during feature 2 (they are optional native helpers; denying them is fine), and add `lefthook` if its install script needs to run
- [ ] Update the `/test` and `/check review` skills to honour the `diff scope on a feature branch` line in `## Git` (`main...HEAD` plus the working tree). Until then, offer the commit at the end of a feature step only after `/test` has run, or point `/test` at the branch's files by hand
- [ ] On Dependabot's first run, confirm it reads the pnpm 12 lockfile and the `catalog:` block in `pnpm-workspace.yaml`. If it cannot, switch to Renovate (a free GitHub app with pnpm catalog support)
- [ ] Install the `gh` CLI (for example `brew install gh`, then `gh auth login`) before the bootstrap step
- [ ] Install the gitleaks binary locally (for example `brew install gitleaks`). It is a Go binary, not an npm package, so record it in the setup notes `/audit` writes. Check which gitleaks subcommand your installed version uses for staged scans, since it changed across v8 releases
- [ ] Choose the format and lint tools in feature 2 (`/audit`), then add their staged file commands to `pre-commit` and their full runs to the CI `checks` job
- [ ] Root `AGENTS.md` does not exist yet. `/audit` should write the `## Git` block above, and record Lefthook, gitleaks, GitHub Actions, Dependabot, and `gh` as project tools
- [ ] Agent Skills for these tools were searched on 2026-10-24. Declined after reading them; record on the `Declined:` line of root `AGENTS.md` `## Agent skills` so they are not offered again: `wshobson/agents@github-actions-templates` (generic, npm and Node 18/20 defaults), `callstackincubator/agent-skills@github-actions` (React Native mobile builds only). Skipped for now, not declined: `github/awesome-copilot@gh-cli`, `fandhe-ai/agent-reference-skills@lefthook`, `mattpocock/skills@setup-pre-commit`, `github/awesome-copilot@dependabot`, `github/awesome-copilot@conventional-commit`, `samber/cc-skills@conventional-git`
- [ ] Optional, later: the official GitHub MCP server (`github/github-mcp-server`) would give the agent live access to the repo, PRs, and CI runs. Connecting it is a config step you run yourself (check its README for the current `claude mcp add` command); the `gh` CLI covers everything this workflow needs until then
- [ ] If the repo moves to GitHub Pro or goes public: add a ruleset on `main` requiring a PR and the `checks`, `secrets`, and `pr-title` checks, and turn on secret scanning push protection where the plan allows it
