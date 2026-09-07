# Test Runner Report Architecture

## Context

The Test Runner produces two different kinds of information:

- runner results: projects, workflow documents, hooks, cases, retries, blocked
  cases, collection errors, and project lifecycle failures;
- Agent reports: execution dumps, screenshots, timeline data, reasoning details,
  and replay metadata.

The run viewer introduced in `@midscene/test` is the natural place for the
first category. The existing `apps/report` application and
`@midscene/visualizer` already implement the second category, including full
and task replay, seek, playback speed, cursor focus, subtitles, fullscreen,
video export, timelines, screenshots, JSON, Markdown, and deep links.

Reimplementing Agent dump parsing and playback in the Test Runner would create
a second report engine and couple `@midscene/test` to Core's report dump
format. Conversely, replacing the run viewer with the existing report app
would lose runner concepts such as projects, document hooks, retries, blocked
cases, and collection failures.

## Decision

The report is a composition of two layers:

1. `@midscene/test` owns the run index and navigation hierarchy:
   `Project -> Document -> Case -> Attempt`.
2. The archived Agent report owns execution details and playback. The run
   viewer embeds its existing player-only mode and links to the full report.

The URL of an archived Agent report is the integration contract between the
layers. The Test Runner must not parse `ReportActionDump`, generate replay
scripts, or import the visualizer runtime.

## Artifact contract

Schema version 4 stores each report as an explicit manifest entry:

```json
{
  "reportId": "report-0",
  "name": "case-report.html",
  "path": "artifacts/reports/<source-id>/case-report.html"
}
```

Every report produced by an executed case attempt is archived, including
successful attempts and attempts that later retry. Document-scope reports from
`beforeAll` and `afterAll` are archived as well. A scope that returns no report
path is valid and appears with a no-replay state.

If a teardown explicitly returns a report path, that path must exist. A missing
file, an invalid report directory, or a copy failure is an infrastructure error
and fails report finalization rather than silently removing the replay.

External reports are copied into the isolated run directory. Reports sharing a
source directory share one archived screenshot directory, so the same sidecar
assets are not copied once per HTML file. Directory-mode reports must contain
an `index.html` entry point.

Generated artifacts from schema version 3 are disposable and are not supported
by the schema version 4 viewer.

## Viewer behavior

- The navigation preserves project and document context and exposes project
  lifecycle failures, collection errors, document hooks, cases, and attempts.
- Failed results are selected first. Within a case, the final attempt is the
  default.
- If an attempt has a report, `Replay` is the default view. It embeds:
  `?player-only=1&play-control=1&auto-play=0`.
- `Steps` shows structured runner input, output, error, duration, and hook
  results.
- `Open full report` opens the archived report in a new tab, retaining the run
  viewer state.
- Multiple reports in one scope are selectable. A scope without a report falls
  back to `Steps` with an explicit no-replay state.
- Project, document, case, attempt, report, and view selection are stored in the
  URL hash so a diagnostic location can be shared.
- A missing report discovered while viewing is contained to the Replay panel;
  runner facts and other attempts remain usable.

The local report server treats directory URLs as `index.html`, supports HEAD
checks used before mounting a replay iframe, and serves common screenshot
formats. A run remains portable as a directory and is opened with:

```sh
midscene-test report <run-directory>
```

The test command prints this command after a run. It does not automatically
open a browser, which keeps CI and remote execution deterministic.

## Usage

Run the project first, then open the exact run directory printed by the CLI:

```sh
pnpm --dir ./apps/harmonyos-browser-e2e e2e
pnpm --dir ./apps/harmonyos-browser-e2e exec midscene-test report .midscene/test-results/<run-id>
```

The `report` command rewrites the small run-viewer shell with the installed
`@midscene/test` version before serving it. Archived execution reports and
runner result JSON remain unchanged.

Integrations that create one Agent per case or document must use
`createMidsceneNodes({ agentProvider })`. `releaseAgent(runId)` finalizes that
Agent and returns its absolute `reportPath`; this is how the runner associates
the replay with the correct attempt. The simpler `getAgent` form is suitable
for shared Agents whose lifecycle and report are managed outside the runner,
but it does not create an attempt-level replay manifest.

## Validation scope

The first implementation must cover successful and failed reports, retries,
document reports, scopes without reports, missing report artifacts, directory
reports, project and collection failures, attempt selection, iframe parameters,
and shareable hash state. Existing report and visualizer suites remain the
source of truth for playback behavior inside the embedded report.

## Deferred work

The following are separate design changes:

- mapping a runner step to an exact Agent execution or task;
- moving the run shell into a unified React build;
- configurable report retention;
- cross-report image content deduplication beyond shared source directories.

Step-level replay requires a stable identifier shared by runner steps and
Agent execution dumps. It must not be approximated from labels or array order.
