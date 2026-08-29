# dsh-kda

Understand why a CUDA kernel got faster.

`dsh-kda` adds a [Kernel Design Agents](https://github.com/mit-han-lab/kernel-design-agents) view to
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It rebuilds a CUDA optimization
run from ordinary session data and keeps the candidate history in one place.

<!-- Add a real KDA overview screenshot here when one is available. -->

KDA keeps the performance decision and profiler verdict separate. A kernel can be measurably faster
even when the profiler does not prove the proposed reason. KDA records both conclusions instead of
turning benchmark success into a profiler claim.

For each candidate, the view keeps the parent, hypothesis, source change, correctness result,
benchmark measurement, NCU evidence, decision, and next experiment. Reload the session and the
same history is reconstructed from the original DSH tool results.

```text
hypothesis -> candidate -> change -> correctness -> benchmark -> profile -> decision -> next
```

## What you get

- A measured baseline and explicit candidate lineage
- Correctness-first evaluation using the project's existing commands
- Benchmark comparisons against the baseline and previous candidates
- NCU evidence attached to the candidate that produced it
- A dedicated KDA view that leaves Conversation and Trajectory intact

The current result format is `schemaVersion: 1` and the package version is `0.0.1`. The package has
not been released yet. Results from earlier development schemas are ignored rather than guessed or
migrated.

## Quick start

You need Node.js `^22.19` or `>=24`, pnpm 11, and a DSH Web profile with its normal shell, tool,
skill, and conversation UI services.

```bash
pnpm install
pnpm verify
pnpm pack
dsh plugin --profile web add .
dsh --profile web --dump-config
dsh --profile web
```

Restart the profile after installing or updating the bundle. The composed configuration should
contain:

```yaml
- id: kda
  name: dsh-kda
```

Open a session with `kda_evaluate_candidate` activity, then select `KDA` beside Conversation and
Trajectory. An evaluation appears while it is running and becomes durable when its schema-v1 tool
result lands. Sessions without KDA activity show an empty state.

## How an evaluation works

The plugin registers `kda_evaluate_candidate`. The tool runs project-provided commands in this
order:

```text
correctness
    |
    +-- failed -> reject
    |
    +-- passed -> benchmark
                      |
                      +-- failed -> reject
                      |
                      +-- passed -> optional NCU profile -> decision
```

Correctness failure stops the evaluation immediately. The first candidate must be the unmodified
baseline. Every later candidate names a parent and reuses the baseline's benchmark contract:

- `optimizationRunId`
- benchmark context
- metric unit and direction
- minimum improvement threshold

The model never supplies the baseline metric. KDA measures it in the first benchmark and restores
it from durable session history for later candidates.

Start KDA before the first optimization. Record the baseline, then record every implemented
candidate before making the next source change. KDA does not accept a bulk history supplied by the
model; lineage is reconstructed only from durable prior evaluator results in the same session.

<details>
<summary>Baseline request</summary>

```json
{
  "optimizationRunId": "fused-rmsnorm-b200-128x4096",
  "task": "fused-rmsnorm",
  "objective": "Minimize median latency while matching atol=1e-5 and rtol=1e-5.",
  "candidate": "baseline",
  "candidateRole": "baseline",
  "hypothesis": "Measure the unmodified reference implementation.",
  "changeSummary": "No optimization change.",
  "workdir": ".",
  "correctnessCommand": "python tests/check.py",
  "benchmarkCommand": "python benchmarks/run.py --emit-kda-metric",
  "benchmarkContext": "b200-cuda13-shape128x4096-median100",
  "profileCommand": "python tools/export_ncu.py profile/baseline.ncu-rep",
  "profileContext": "b200-ncu2026-full-shape128x4096-kernel-rmsnorm",
  "profileArtifact": "profile/baseline.ncu-rep",
  "ncuReportAssessmentCommand": "Get-Content -Raw profile/baseline/ncu-assessment.json",
  "metricUnit": "us",
  "lowerIsBetter": true,
  "minimumImprovementPercent": 5
}
```

</details>

<details>
<summary>Experiment request</summary>

```json
{
  "optimizationRunId": "fused-rmsnorm-b200-128x4096",
  "task": "fused-rmsnorm",
  "objective": "Minimize median latency while matching atol=1e-5 and rtol=1e-5.",
  "candidate": "vectorized-load-v1",
  "candidateRole": "experiment",
  "parentCandidate": "baseline",
  "hypothesis": "Aligned 128-bit loads increase compute throughput without increasing register pressure.",
  "changeSummary": "Replace four scalar loads with one aligned float4 load.",
  "sourceRevision": "git:abc1234",
  "workdir": ".",
  "correctnessCommand": "python tests/check.py",
  "benchmarkCommand": "python benchmarks/run.py --emit-kda-metric",
  "benchmarkContext": "b200-cuda13-shape128x4096-median100",
  "profileCommand": "python tools/export_ncu.py profile/vectorized-load-v1.ncu-rep",
  "profileContext": "b200-ncu2026-full-shape128x4096-kernel-rmsnorm",
  "profileArtifact": "profile/vectorized-load-v1.ncu-rep",
  "ncuReportAssessmentCommand": "Get-Content -Raw profile/vectorized-load-v1/ncu-assessment.json",
  "metricUnit": "us",
  "lowerIsBetter": true,
  "minimumImprovementPercent": 5,
  "expectedProfileMetric": "compute-throughput",
  "expectedProfileDirection": "increase",
  "expectedProfileMinimumChangePercent": 5
}
```

</details>

## Performance and mechanism

`decision` answers whether the measured candidate should be kept.

| Decision | Meaning |
|---|---|
| `baseline` | Correctness passed and the measured reference metric was recorded. |
| `promote` | Correctness passed and the candidate met the benchmark threshold and any required evidence gates. |
| `revise` | The improvement was too small, evidence was incomplete, or a required evidence gate failed. |
| `reject` | Correctness or the benchmark command failed. |

`mechanismAssessment.verdict` answers whether comparable profiler evidence supports the mechanism
declared before the experiment.

| Verdict | Meaning |
|---|---|
| `supported` | The declared metric moved in the expected direction by the required amount. |
| `partially-supported` | The metric moved in the expected direction but missed the declared magnitude. |
| `contradicted` | The metric moved materially in the opposite direction. |
| `unverified` | A declared expectation, comparable reference, aligned metric, or finite delta was unavailable. |

Profiler evidence is advisory by default. Set `requireProfileForPromotion=true` or
`requireMechanismForPromotion=true` only when the task contract says that evidence must block
promotion.

## NCU evidence

The bundled profiling workflow comes from
[mit-han-lab/ncu-report-skill](https://github.com/mit-han-lab/ncu-report-skill) at commit
`1cf238d6b41c79bd35041192506c4d45e765a3f1`. It is registered as `ncu-report-skill` and remains the
authority for profile collection and diagnosis on B200 / `sm_100`.

The workflow collects full and source profiles, parses them with `ncu_report`, checks six analysis
dimensions, matches the diagnosis playbook, and writes ranked recommendations to `REPORT.md`. The
six dimensions are launch and occupancy, workload balance, stall hotspots, tensor core use,
timeline behavior, and memory behavior.

The separate `kda-recorder` skill drives the candidate loop from the measured baseline and maps
each completed report into the KDA trajectory before the next source change. It does not replace or
reinterpret the original report. When `profileCommand` is present, `ncuReportAssessmentCommand`
must print a sidecar that follows
[`skills/kda/references/ncu-assessment-schema.md`](skills/kda/references/ncu-assessment-schema.md).
The command runs under the calling session's sandbox policy. Its `reportMarkdown` field stores the
complete report so the detail view survives session recovery.

KDA also creates a compact metric overview for presentation. That classifier is explicitly marked
as non-authoritative when the original report is missing.

### Benchmark output

The benchmark must print a finite value:

```text
KDA_METRIC=37.8
```

The last occurrence wins. For another output format, provide a JavaScript `metricPattern`. Capture
group 1 or the named group `metric` must contain the numeric value.

### Profiler output

The profiler command can emit NCU CSV with these columns:

```text
Metric Name,Metric Unit,Metric Value
```

`Kernel Name` and `Section Name` are retained when present. A custom extractor can emit exact
metrics instead:

```text
KDA_NCU_METRIC=dram__throughput.avg.pct_of_peak_sustained_elapsed|88|%
KDA_NCU_METRIC=smsp__warp_issue_stalled_long_scoreboard.per_warp_active.pct|12.5|%
```

The parser recognizes raw NCU identifiers and display names such as `Compute (SM) Throughput`,
`DRAM Throughput`, `Duration`, `Achieved Occupancy`, and `Registers Per Thread`. It exposes canonical
metrics for duration, compute and DRAM throughput, occupancy, registers, shared memory, waves per
SM, and warp stalls.

Profile deltas require matching `profileContext` values and units. Multiple kernels or launch IDs
remain visible, but KDA does not use them for automatic causal comparison. Filter NCU to one target
launch. Windows benchmark results and WSL2 profiles can coexist; the UI warns when profiler duration
is not comparable to the promotion metric.

## Inside the KDA view

The conversation tab starts with the measured baseline, the best promoted candidate, and—when it
is different—the fastest measured candidate. A fast candidate that still needs revision is never
presented as the accepted best. The lineage view follows `parentCandidate`, so parallel experiments
appear as branches instead of a misleading flat timeline.

Running evaluations appear immediately with correctness, benchmark, and profile progress. A
completed candidate opens to a decision-first summary: what changed, whether correctness passed,
the measured delta, the decision, and its reason. The full ledger stays collapsed until requested
and contains:

- Hypothesis, parent candidate, change summary, and source revision
- Correctness, benchmark, and profile stages with commands and captured output
- Exact NCU measurements and aligned deltas
- Performance gates and the independent mechanism verdict
- Evidence pointers, profiler artifacts, and the next falsifying experiment

When an original NCU report is present, the ledger adds nodes for all six dimensions, playbook
matches, NCU rules, and the ranked plan. A detail drawer contains the summary, every parsed metric,
raw profiler output, and the complete embedded `REPORT.md`.

Every completed candidate links to the original `kda_evaluate_candidate` Tool Call and to the same
call in native Trajectory. Running candidates can also be opened in Trajectory. These links expose
the source evidence rather than duplicating or replacing it.

KDA also registers an inline result card and native nested Trajectory nodes for candidates, command
stages, diagnoses, mechanism assessments, and decisions. The native Trajectory package has no
public row-renderer slot, so specialized KDA rows stay in the dedicated tab. The ordinary
Trajectory view remains unchanged.

The durable UI is a pure projection of `ConversationSnapshot.nodes`; transient progress comes from
the snapshot's standard `runningCalls` list. It does not maintain a second history. Missing, failed,
partial, and still-running evidence produces an honest partial view instead of invented values or a
crashed conversation slot.

## Scope

KDA runs correctness, benchmark, and profiler commands supplied by the project through the DSH
shell. The project remains responsible for those commands and their workloads.

The plugin does not provide GPUs, remote execution, benchmark datasets, hidden tests, competitions,
or leaderboards. It does not replace KernelBench, ComputeEval, GPU Mode, or the native DSH
Conversation and Trajectory views. External benchmark platforms can be added as optional adapters,
but they are not part of the core model.

## Configuration

Override the bundle row in the profile's `cordis.patch.yml`:

```yaml
- id: kda
  config:
    timeoutMs: 600000
    outputMaxBytes: 2097152
    defaultMinimumImprovementPercent: 3
```

Patch configuration replaces the complete `config` object. Restate every value you want to retain.

## Development

```bash
pnpm install
pnpm verify
pnpm pack
```

`pnpm verify` runs type checking, all tests, and the production build. `pnpm pack` repeats that
verification through the `prepack` lifecycle before producing the `.tgz`. The package sets
`autoInstallPeers: false`; the DSH profile supplies runtime peer services.

## Automated checks and releases

Pull requests and pushes to `main` run the same verification and package checks in GitHub Actions.
The resulting `.tgz` is retained as the `dsh-kda-package` workflow artifact for 14 days.

To publish a GitHub Release, update the version in `package.json`, commit it, and push the matching
tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The release workflow requires the tag to equal `v` plus the package version. It rebuilds the
package, checks the archive contents and exports, creates the release, and attaches the `.tgz`. npm
publishing is not enabled.
