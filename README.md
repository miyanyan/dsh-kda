# dsh-kda

`dsh-kda` is a semantic CUDA-optimization Trajectory viewer for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), inspired by [Kernel Design Agents](https://github.com/mit-han-lab/kernel-design-agents).

It turns ordinary durable dsh tool results into one inspectable evidence chain:

```text
hypothesis → candidate → change → correctness → benchmark → profile → decision → next experiment
```

The plugin does not provide GPUs, benchmarks, hidden tests, or a second session store. Project commands remain responsible for correctness, benchmarking, and NCU collection. KDA organizes their evidence and keeps the native Conversation and Trajectory views intact.

## What it provides

- An explicit measured baseline as the first candidate in every run.
- Stable candidate lineage reconstructed from `ConversationSnapshot.nodes` after reload or recovery.
- Correctness-first command execution and a repeatable benchmark contract.
- NCU CSV and `KDA_NCU_METRIC` parsing for raw ids and display names.
- Canonical metrics such as duration, compute/DRAM throughput, occupancy, registers, shared memory, waves per SM, and warp stalls.
- Same-context, same-unit baseline-to-candidate profiler deltas.
- A performance decision separate from the profiler-backed mechanism verdict.
- Honest states for skipped, failed, empty, current-only, and comparable profiles.
- The original MIT HAN Lab `ncu-report-skill` workflow, six analysis dimensions, diagnosis playbook, B200 references, and helper scripts.
- A thin KDA recorder adapter that persists candidate lineage and evidence without replacing the original report's diagnosis.
- A dedicated `KDA` conversation tab plus an inline evaluator result card.
- Native nested Trajectory nodes for candidate, stages, mechanism assessment, and decision.
- Dedicated KDA nodes for the original report, all six analysis dimensions, playbook matches, NCU rules, and ranked recommendations.
- A session-recoverable Original NCU detail drawer with all parsed metrics, comparisons, six-dimensional evidence, decisions, raw profiler output, and the complete embedded `REPORT.md`.
- The bundled upstream `ncu-report-skill` as the profiling authority, plus a clearly labeled non-authoritative compact metric overview when no original report exists.

The current result format is `schemaVersion: 1` and the package version is `0.0.1`. This repository has not been released, so earlier development schemas are intentionally not projected or migrated.

## Original NCU report skill

The profiling skill under `skills/ncu-report-skill` is vendored unchanged from
[mit-han-lab/ncu-report-skill](https://github.com/mit-han-lab/ncu-report-skill) at commit
`1cf238d6b41c79bd35041192506c4d45e765a3f1`.

It is registered as `ncu-report-skill` and remains the authority for profile collection, `ncu_report`
parsing, six-dimensional analysis, playbook matching, source hotspots, PM sampling, and ranked
recommendations. The separate `kda-recorder` skill only maps completed evidence into the durable KDA
trajectory. The compact TypeScript overview classifier is presentation metadata, not a replacement
for the original `REPORT.md`.

## Install

Requirements:

- Node.js `^22.19` or `>=24`.
- pnpm 11.
- A dsh Web profile with its normal shell, tool, skill, and conversation UI services.

Install a local checkout:

```bash
pnpm install
pnpm test
pnpm build
dsh plugin --profile web add .
dsh --profile web --dump-config
dsh --profile web
```

Restart the profile after installing or updating the Bundle. The composed configuration should include:

```yaml
- id: kda
  name: dsh-kda
```

Open a session containing schema-v1 `kda_evaluate_candidate` results and select `KDA` beside Conversation and Trajectory. A session without them shows an honest empty state.

## Evaluation workflow

Choose one stable `optimizationRunId` and one immutable task contract. The benchmark context, unit, direction, and promotion threshold must remain identical throughout the run.

First, evaluate the unmodified implementation:

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
  "ncuReportAssessmentJson": "<serialized original-report sidecar>",
  "metricUnit": "us",
  "lowerIsBetter": true,
  "minimumImprovementPercent": 5
}
```

Then evaluate one hypothesis-driven experiment with the same run id and contract:

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
  "ncuReportAssessmentJson": "<serialized original-report sidecar>",
  "metricUnit": "us",
  "lowerIsBetter": true,
  "minimumImprovementPercent": 5,
  "expectedProfileMetric": "compute-throughput",
  "expectedProfileDirection": "increase",
  "expectedProfileMinimumChangePercent": 5
}
```

The baseline metric is never supplied by the model. It is measured by the first benchmark and inherited from durable session history. When `profileCommand` is present, `ncuReportAssessmentJson` is required and must follow [`skills/kda/references/ncu-assessment-schema.md`](skills/kda/references/ncu-assessment-schema.md); it is produced from the original skill's completed report rather than inferred by the evaluator. Its `reportMarkdown` field carries the complete report text so the detail drawer survives session recovery without depending on the original workspace file.

## Benchmark and profiler output

Benchmark stdout must contain a finite value:

```text
KDA_METRIC=37.8
```

The final occurrence wins. For another format, provide a JavaScript `metricPattern`; capture group 1 or named group `metric` must contain the number.

Profiler output can be NCU CSV with at least these columns:

```text
Metric Name,Metric Unit,Metric Value
```

`Kernel Name` and `Section Name` are retained when present. A custom extractor can instead emit:

```text
KDA_NCU_METRIC=dram__throughput.avg.pct_of_peak_sustained_elapsed|88|%
KDA_NCU_METRIC=smsp__warp_issue_stalled_long_scoreboard.per_warp_active.pct|12.5|%
```

The parser recognizes both raw NCU identifiers and display names such as `Compute (SM) Throughput`, `DRAM Throughput`, `Duration`, `Achieved Occupancy`, and `Registers Per Thread`.

Profile deltas require matching `profileContext` values and matching units. Profiles containing multiple kernels or launch IDs remain visible but are not used for an automatic causal comparison; filter NCU to one target launch. A Windows benchmark and a WSL2 profile may coexist, but the UI warns that profiler duration is not the promotion metric when their contexts differ.

## Performance and mechanism are separate

`decision` answers whether the candidate should be kept based on correctness and the benchmark contract:

| Decision | Meaning |
|---|---|
| `baseline` | The unmodified candidate passed correctness and produced the measured reference metric. |
| `promote` | Correctness passed and the candidate met the benchmark threshold plus any explicitly required evidence gates. |
| `revise` | Evidence was incomplete, the improvement was too small, or a required profile/mechanism gate was not met. |
| `reject` | Correctness or the benchmark command failed. |

`mechanismAssessment.verdict` independently answers whether comparable profiler evidence supports the predeclared mechanism:

| Verdict | Meaning |
|---|---|
| `supported` | The declared metric moved in the expected direction by the required amount. |
| `partially-supported` | It moved in the expected direction but did not clear the declared magnitude. |
| `contradicted` | It moved materially in the opposite direction. |
| `unverified` | No expectation, comparable reference, aligned metric, or finite percentage delta was available. |

A candidate can therefore be `promote` + `unverified`: it is measurably faster, but the claimed cause has not been proven. Set `requireMechanismForPromotion=true` only when that distinction must block promotion.

## KDA view

The dedicated view uses a compact semantic ledger modeled on dsh's native Trajectory visual language:

- A three-lane overview for candidates, evidence stages, and mechanism verdicts.
- One expandable ledger per candidate with parent links, measured value, improvement, and decision.
- Dedicated Hypothesis, Change, Correctness, Benchmark, Profile, Mechanism, Decision, and Evidence nodes.
- Original NCU, Dim 1–6, Playbook, NCU Rules, and Ranked Plan nodes projected directly from the original report sidecar.
- A `View full NCU report` drawer with Summary, Six dimensions, All metrics, Rules & plan, and Raw report sections.
- Exact profiler measurements and aligned deltas directly below the Profile row.
- Observation, diagnosis, limitations, and the next falsifying experiment without opening raw logs.
- Collapsible commands, stdout/stderr, artifacts, source revision, and dsh call identifiers when deeper inspection is needed.

The native Trajectory package does not expose a public row-renderer slot, so KDA keeps its specialized nodes in this dedicated tab while preserving the ordinary native Trajectory unchanged.

The view is a pure projection of ordinary durable tool results. Missing or failed evidence produces a partial view instead of invented values or a crashed conversation slot.

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

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm pack
```

The package sets `autoInstallPeers: false`; the real dsh profile supplies runtime peer services.
