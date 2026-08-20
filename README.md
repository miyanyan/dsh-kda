# dsh-kda

An initial [Kernel Design Agents](https://github.com/mit-han-lab/kernel-design-agents) integration for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

The plugin evaluates one implemented CUDA kernel candidate at a time. It runs correctness, benchmark, and optional profiling commands through dsh's existing `ctx.shell` executor, then persists the complete evidence ledger as the `kda_evaluate_candidate` tool result. The Web plugin renders that result as a compact candidate card with stage status, metric change, and the promote/revise/reject decision.

This project does not copy KDA or pretend that KDA currently exposes a runtime API. KDA remains the workflow reference; this plugin turns its evidence and promotion loop into an executable dsh tool.

## Current scope

- Correctness-first candidate evaluation.
- Optional benchmark and profiling stages.
- Configurable metric parsing, direction, and promotion threshold.
- Replayable `kda/*` event ledger embedded in the durable dsh tool result.
- Candidate and parent-candidate ids for later DAG projection.
- Dedicated Web tool card for `kda_evaluate_candidate`.
- Reference Python JSONL driver for integrations outside dsh.
- A bundled KDA skill that can be copied into a dsh skill root.

The initial version does not generate kernel candidates, parse `.ncu-rep` files itself, or add a full conversation-level candidate DAG. Candidate generation remains the coding agent's job. NCU can be integrated through `profileCommand`; point `profileArtifact` at the corresponding `.ncu-rep` file so the evidence record retains the relationship.

## Install

Requirements:

- Node.js `^22.19` or `>=24`.
- pnpm 11.
- A dsh Web profile with its normal shell and tool services.

Install a local checkout into the Web profile:

```bash
pnpm install
pnpm test
pnpm build
dsh plugin --profile web add .
dsh --profile web --dump-config
dsh --profile web
```

Restart the profile after adding, removing, or updating the Bundle. The emitted configuration should contain this row:

```yaml
- id: kda
  name: dsh-kda
```

For a git installation, pin a commit and authorize only this package's `prepare` build when pnpm asks:

```bash
dsh plugin --profile web add github:YOUR_ORG/dsh-kda#COMMIT_SHA
```

The package's client bundle uses the lazy-CJS factory expected by the current dsh Web module loader. This area is still pre-release and may need adjustment when dsh changes its Client plugin format.

## Agent workflow

The intended loop is:

1. Define correctness and performance criteria.
2. Measure a baseline.
3. Implement one candidate and give it a stable id.
4. Call `kda_evaluate_candidate`.
5. Keep the returned result in the session trajectory.
6. Promote only on `promote`; use `revise` and `reject` reasons to choose the next candidate.

Example tool arguments:

```json
{
  "task": "fused-rmsnorm",
  "objective": "Minimize median latency while matching the reference within atol=1e-5 and rtol=1e-5.",
  "candidate": "vectorized-load-v2",
  "parentCandidate": "baseline",
  "workdir": ".",
  "correctnessCommand": "python tests/check.py",
  "benchmarkCommand": "python benchmarks/run.py --emit-kda-metric",
  "profileCommand": "python tools/summarize_ncu.py profile/vectorized-load-v2.ncu-rep",
  "profileArtifact": "profile/vectorized-load-v2.ncu-rep",
  "baselineMetric": 42.1,
  "metricUnit": "us",
  "lowerIsBetter": true,
  "minimumImprovementPercent": 5
}
```

By default, benchmark stdout must contain:

```text
KDA_METRIC=37.8
```

The final occurrence wins. For other benchmark formats, pass `metricPattern`. Capture group 1 or a named capture group called `metric` must contain the number:

```json
{
  "metricPattern": "median:\\s*(?<metric>\\d+(?:\\.\\d+)?)\\s*us"
}
```

## Decisions

The evaluator returns one of three decisions:

| Decision | Meaning |
|---|---|
| `promote` | Correctness passed, benchmark produced a metric, a baseline exists, profiling succeeded when requested, and the improvement threshold was met. |
| `revise` | Correctness passed but evidence is incomplete, profiling failed, no baseline exists, or the improvement threshold was not met. |
| `reject` | Correctness or the benchmark command failed. |

Commands run sequentially. A correctness failure prevents benchmark and profiling from running. Commands use the active dsh shell provider and therefore inherit its timeout, process, and sandbox behavior; this plugin does not spawn an unsandboxed process directly.

## Configuration

Override the Bundle row from the profile's `cordis.patch.yml`:

```yaml
- id: kda
  config:
    timeoutMs: 600000
    outputMaxBytes: 2097152
    defaultMinimumImprovementPercent: 3
```

Patch configuration replaces the complete `config` object. Restate every value you want to retain.

## Skill

The repository includes [`skills/kda/SKILL.md`](skills/kda/SKILL.md). Copy its directory into a local dsh skill root:

```bash
mkdir -p ~/.dsh/skills
cp -R skills/kda ~/.dsh/skills/kda
```

On Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force "$HOME/.dsh/skills/kda"
Copy-Item -Recurse -Force "skills/kda/*" "$HOME/.dsh/skills/kda"
```

## Python JSONL driver

`scripts/kda_driver.py` implements the same evidence vocabulary for a non-dsh orchestrator. It reads one request object from a file or stdin and emits one JSON object per line:

```bash
python scripts/kda_driver.py examples/request.json --result result.json > trajectory.jsonl
```

Unlike the dsh plugin, the reference driver uses Python's host shell directly. Treat request files as trusted executable configuration. In dsh, prefer the model tool because it uses `ctx.shell`.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm pack
```

The package deliberately sets `autoInstallPeers: false`: the current published dsh RC peer graph references a few packages that are not independently published. A real dsh profile already supplies the required services. The plugin still declares its runtime peer requirements for package managers and future stable releases.
