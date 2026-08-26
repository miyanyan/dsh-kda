---
name: kda-recorder
description: Record completed CUDA candidate evidence into the durable KDA semantic trajectory after the bundled original ncu-report-skill has performed profiling, six-dimensional analysis, playbook matching, and report generation.
---

# KDA trajectory recorder

This skill is an adapter, not a profiler or diagnosis authority. The bundled `ncu-report-skill` is the sole source of profiling workflow and optimization reasoning.

Never replace or abbreviate its required workflow:

`representative workload → standalone harness or existing binary → full profile → source profile → ncu_report parsing → six dimensions → diagnosis playbook → ranked REPORT.md`

After that workflow has produced its evidence-backed report, read
[`references/ncu-assessment-schema.md`](references/ncu-assessment-schema.md), create the strict JSON sidecar from the report, and call `kda_evaluate_candidate` only to record the candidate story:

1. Record the unmodified implementation first with `candidateRole=baseline`; reuse one `optimizationRunId` for all later candidates.
2. Keep the correctness command, benchmark command, workload, hardware, and measurement contexts stable.
3. Set `profileArtifact` to the original `.ncu-rep` or report path.
4. Make `profileCommand` export exact metrics from the saved report as NCU CSV or `KDA_NCU_METRIC=<name>|<value>|<unit>` lines. Do not re-interpret them by eye.
5. Put the complete, verbatim `REPORT.md` text in the sidecar's `reportMarkdown`, then pass the JSON sidecar as `ncuReportAssessmentJson`. A profiled candidate without the sidecar and embedded report is invalid.
6. Predeclare only the one metric mechanism being tested by the candidate through `expectedProfileMetric`, `expectedProfileDirection`, and `expectedProfileMinimumChangePercent`.
7. Use `requireProfileForPromotion` or `requireMechanismForPromotion` only when the task contract says profiler evidence must block promotion.
8. Treat the evaluator's compact overview classification as presentation metadata. The original `REPORT.md`, six-dimension analysis, matched playbook patterns, source hotspots, PM timeline, NCU rules, and ranked recommendations remain authoritative.

The durable story must remain:

`hypothesis → candidate → change → correctness → benchmark → original NCU evidence → decision → next experiment`

Do not invent values or translate a missing original report into a profiler-backed claim.
