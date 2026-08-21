# dsh-kda

A trajectory-aware [Kernel Design Agents](https://github.com/mit-han-lab/kernel-design-agents) integration for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

The plugin evaluates one implemented kernel candidate at a time and reconstructs its optimization run from prior durable dsh tool results. It runs correctness, benchmark, and optional profiling commands through dsh's `ctx.shell` executor, then persists structured presentation metadata containing candidate lineage, NCU evidence, and the promotion decision. The Web integration provides both an inline result card and a dedicated `KDA` conversation tab.

KDA remains the workflow reference; this plugin turns its evidence and promotion loop into an executable dsh workflow.

## Current scope

- Correctness-first candidate evaluation.
- Optional benchmark and profiling stages.
- Configurable metric parsing, direction, and promotion threshold.
- Stable optimization run ids reconstructed after session resume or replay.
- Replayable `kda/*` event ledger, native nested Trajectory nodes, and structured dsh presentation metadata.
- Candidate ids, parent links, hypotheses, source revisions, and lineage projection.
- NCU raw CSV and `KDA_NCU_METRIC` parsing with conservative bottleneck guidance.
- Dedicated `KDA` conversation tab grouping runs, candidate lineage, stages, command evidence, NCU diagnosis, and decisions.
- Inline Web result card for the latest evaluation without leaving the Conversation tab.
- A bundled KDA workflow skill mounted automatically by the plugin Bundle.
- Reference Python JSONL driver for integrations outside dsh.

The plugin does not generate kernel source independently of the coding agent and does not decode binary `.ncu-rep` files itself. Use NVIDIA's `ncu_report` Python API or an NCU CSV exporter in `profileCommand`, and point `profileArtifact` at the immutable report. The `KDA` tab reconstructs its complete view exclusively from ordinary durable tool results; it does not add a custom Session event vocabulary. In dsh's native Trajectory, each evaluation remains one durable root tool call while candidate, correctness, benchmark, profile, diagnosis, and decision records appear as native nested calls beneath it.

## Install

Requirements:

- Node.js `^22.19` or `>=24`.
- pnpm 11.
- A dsh Web profile with its normal shell, tool, and skill services.

Install a local checkout into the Web profile:

```bash
pnpm install
pnpm test
pnpm build
dsh plugin --profile web add .
dsh --profile web --dump-config
dsh --profile web
```

Restart the profile after adding, removing, or updating the Bundle. The composed configuration should contain this row:

```yaml
- id: kda
  name: dsh-kda
```

Open any session containing a `kda_evaluate_candidate` result and select `KDA` beside the Conversation and Trajectory tabs. The newest optimization run is expanded automatically. Sessions with no KDA result show an empty-state prompt; no extra backend or event migration is required.

For a git installation, pin a commit and authorize only this package's `prepare` build when pnpm asks:

```bash
dsh plugin --profile web add github:YOUR_ORG/dsh-kda#COMMIT_SHA
```

## Agent workflow

1. Define correctness and performance criteria.
2. Measure a real baseline.
3. Choose a stable optimization run id and a testable hypothesis.
4. Implement one candidate and give it a unique id plus its parent id.
5. Call `kda_evaluate_candidate`; later calls reconstruct previous candidates from the session automatically.
6. Promote only on `promote`; use `profileAnalysis`, `revise`, and `reject` evidence to choose the next single-variable candidate.

Example tool arguments:

```json
{
  "optimizationRunId": "fused-rmsnorm-b200-shape-128x4096",
  "task": "fused-rmsnorm",
  "objective": "Minimize median latency while matching the reference within atol=1e-5 and rtol=1e-5.",
  "candidate": "vectorized-load-v2",
  "parentCandidate": "baseline",
  "hypothesis": "A 128-bit coalesced load reduces long-scoreboard stalls without increasing register pressure.",
  "changeSummary": "Replace four scalar loads with one aligned float4 load.",
  "sourceRevision": "git:abc1234",
  "workdir": ".",
  "correctnessCommand": "python tests/check.py",
  "benchmarkCommand": "python benchmarks/run.py --emit-kda-metric",
  "profileCommand": "python tools/summarize_ncu.py profile/vectorized-load-v2.ncu-rep --emit-kda-lines",
  "profileArtifact": "profile/vectorized-load-v2.ncu-rep",
  "baselineMetric": 42.1,
  "metricUnit": "us",
  "lowerIsBetter": true,
  "minimumImprovementPercent": 5
}
```

The first candidate may name an external baseline as its parent. Every later candidate must name a candidate already present in the run. Candidate ids cannot be reused.

## Benchmark and NCU output

By default, benchmark stdout must contain:

```text
KDA_METRIC=37.8
```

The final occurrence wins. For another format, pass `metricPattern`; capture group 1 or named group `metric` must contain the number:

```json
{
  "metricPattern": "median:\\s*(?<metric>\\d+(?:\\.\\d+)?)\\s*us"
}
```

Profiler output can be NCU CSV with `Metric Name`, `Metric Unit`, and `Metric Value` columns, or explicit lines:

```text
KDA_NCU_METRIC=dram__throughput.avg.pct_of_peak_sustained_elapsed|88|%
KDA_NCU_METRIC=smsp__warp_issue_stalled_long_scoreboard.per_warp_active.pct|12.5|%
```

The diagnosis is deliberately conservative. Missing or ambiguous structured metrics produce `unknown` with low confidence instead of an invented bottleneck.

## Decisions

| Decision | Meaning |
|---|---|
| `promote` | Correctness passed, benchmark produced a metric, a baseline exists, requested profiling succeeded, and the improvement threshold was met. |
| `revise` | Correctness passed but evidence is incomplete, profiling failed, no baseline exists, or the improvement threshold was not met. |
| `reject` | Correctness or the benchmark command failed. |

Commands run sequentially. A correctness failure prevents benchmark and profiling from running. Commands inherit the active dsh shell provider's timeout, process, and sandbox behavior; the plugin does not spawn an unsandboxed process directly.

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

The plugin registers [`skills/kda/SKILL.md`](skills/kda/SKILL.md) directly in dsh's global skill registry. Every agent preset can therefore discover and load it without copying files into the user's global skill root or relying on bundle-relative filesystem paths. Its description triggers on kernel optimization, profiling, NCU analysis, and continuation requests in English or Chinese.

## Python JSONL driver

`scripts/kda_driver.py` retains the original single-candidate evidence vocabulary for a non-dsh orchestrator:

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

The package sets `autoInstallPeers: false`: a real dsh profile supplies the runtime peer services. The plugin declares its peer requirements for package managers and future stable releases.
