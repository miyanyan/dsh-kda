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

5. In the same execution environment, rebuild the run-level official Nsight Compute `Concat` report from the full candidate reports collected so far. Materialize only that final `.ncu-rep` into the session workspace when profiling ran in WSL or on a server.
6. After profiling, read [`references/ncu-assessment-schema.md`](references/ncu-assessment-schema.md), write the strict JSON sidecar beside the report, record the viewer-accessible Concat path as `mergedReportPath`, and make `ncuReportAssessmentCommand` print only that JSON file.
7. Call `kda_evaluate_candidate` for the implemented candidate before editing the next candidate. Use the returned decision and original NCU recommendations to choose the next hypothesis.
8. Repeat from step 3. Do not defer KDA recording until the end of the optimization run.

## Hard invariants

- Reuse one `optimizationRunId` for the baseline and every later candidate.
- Number candidates from zero: the measured baseline is candidate `0`, the first optimization is `1`, and later candidates increase by one. When a candidate id uses a numeric form such as `v0`, `v1`, or `v2`, its suffix must match this index.
- Record exactly one implemented candidate per tool call. Never invent, summarize, or bulk-backfill candidates that do not have their own evaluator result.
- Do not begin the next source change until the current candidate has a successful `kda_evaluate_candidate` result. If validation rejects the sidecar, fix the reported field and retry the same candidate id.
- Keep correctness, benchmark, workload, hardware, and measurement contexts stable.
- Set `profileArtifact` to the original `.ncu-rep` or report path.
- Make every profiled launch identifiable after reports are concatenated in the official Nsight Compute UI: wrap the target launch in an NVTX push/pop range whose name is exactly the KDA `candidate` id, collect with NCU NVTX support enabled, and verify that the saved result exposes `property__range_name`. Do not rely on the kernel symbol or report filename alone because those commonly stay identical across iterations.
- Run the official Report Merge Tool beside benchmark/profile execution, never in the KDA viewer. Put only per-candidate full reports in its input directory and write the output outside that directory with `--result-merge-operation concat`; source reports and an older Concat output must not be merge inputs.
- Treat `mergedReportPath` as the handoff boundary. It must resolve from the recorded KDA `workdir` in the current DSH environment. For Windows DSH with WSL execution, write or copy the final report through a mounted workspace path such as `/mnt/d/...`; for a remote server, transfer only the final Concat report into the local session workspace before recording the sidecar.
- Make `profileCommand` export exact metrics from the saved report as NCU CSV or `KDA_NCU_METRIC=<name>|<value>|<unit>` lines. Do not re-interpret values by eye.
- Make `ncuReportAssessmentCommand` read the saved sidecar through the evaluator's sandbox. Do not inline serialized JSON in the tool call. A profiled candidate without the validated sidecar and embedded verbatim `REPORT.md` is invalid.
- Predeclare only the one metric mechanism being tested through `expectedProfileMetric`, `expectedProfileDirection`, and `expectedProfileMinimumChangePercent`.
- Use `requireProfileForPromotion` or `requireMechanismForPromotion` only when the task contract makes that evidence blocking.
- Treat the compact overview classification as presentation metadata. The original `REPORT.md`, six dimensions, playbook matches, source hotspots, PM timeline, NCU rules, and ranked recommendations remain authoritative.

The durable story must remain:

`hypothesis → candidate → change → correctness → benchmark → original NCU evidence → decision → next experiment`

Do not invent values or translate a missing original report into a profiler-backed claim.
