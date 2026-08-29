---
name: kda-recorder
description: Drive and record CUDA kernel optimization one candidate at a time in the durable KDA semantic trajectory. Use from the beginning whenever the user asks for KDA, a KDA-visible optimization run, or an evidence-backed CUDA optimization trajectory; coordinate correctness, benchmark, and the bundled original ncu-report-skill without replacing its diagnosis.
---

# KDA trajectory recorder

Use this skill before the first source change. It is an orchestration and recording adapter, not a profiler or diagnosis authority. The bundled `ncu-report-skill` remains the sole source of profiling workflow and optimization reasoning.

## Required candidate loop

1. Freeze one run contract: objective, correctness command, benchmark command and context, metric unit and direction, workload, and hardware.
2. Call `kda_evaluate_candidate` for the unmodified implementation with `candidateRole=baseline` before implementing an optimization.
3. Declare one testable hypothesis and one meaningful source change for the next candidate. Name its recorded parent.
4. Run the original profiling workflow when the hypothesis or next decision needs profiler evidence:

`representative workload → standalone harness or existing binary → full profile → source profile → ncu_report parsing → six dimensions → diagnosis playbook → ranked REPORT.md`

5. After profiling, read [`references/ncu-assessment-schema.md`](references/ncu-assessment-schema.md), write the strict JSON sidecar beside the report, and make `ncuReportAssessmentCommand` print only that JSON file.
6. Call `kda_evaluate_candidate` for the implemented candidate before editing the next candidate. Use the returned decision and original NCU recommendations to choose the next hypothesis.
7. Repeat from step 3. Do not defer KDA recording until the end of the optimization run.

## Hard invariants

- Reuse one `optimizationRunId` for the baseline and every later candidate.
- Record exactly one implemented candidate per tool call. Never invent, summarize, or bulk-backfill candidates that do not have their own evaluator result.
- Do not begin the next source change until the current candidate has a successful `kda_evaluate_candidate` result. If validation rejects the sidecar, fix the reported field and retry the same candidate id.
- Keep correctness, benchmark, workload, hardware, and measurement contexts stable.
- Set `profileArtifact` to the original `.ncu-rep` or report path.
- Make `profileCommand` export exact metrics from the saved report as NCU CSV or `KDA_NCU_METRIC=<name>|<value>|<unit>` lines. Do not re-interpret values by eye.
- Make `ncuReportAssessmentCommand` read the saved sidecar through the evaluator's sandbox. Do not inline serialized JSON in the tool call. A profiled candidate without the validated sidecar and embedded verbatim `REPORT.md` is invalid.
- Predeclare only the one metric mechanism being tested through `expectedProfileMetric`, `expectedProfileDirection`, and `expectedProfileMinimumChangePercent`.
- Use `requireProfileForPromotion` or `requireMechanismForPromotion` only when the task contract makes that evidence blocking.
- Treat the compact overview classification as presentation metadata. The original `REPORT.md`, six dimensions, playbook matches, source hotspots, PM timeline, NCU rules, and ranked recommendations remain authoritative.

The durable story must remain:

`hypothesis → candidate → change → correctness → benchmark → original NCU evidence → decision → next experiment`

Do not invent values or translate a missing original report into a profiler-backed claim.
