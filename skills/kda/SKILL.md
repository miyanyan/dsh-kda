---
name: kda
description: Evaluate CUDA kernel candidates with correctness, benchmark, profiling, and evidence-based promotion decisions.
---

# Kernel Design Agents workflow

Use this workflow for performance-sensitive CUDA kernel work.

1. State the objective, correctness constraints, validation command, benchmark command, metric direction, and promotion threshold.
2. Measure the baseline before editing the candidate.
3. Implement one candidate at a time and give it a stable id. Preserve the parent id for revisions.
4. Call `kda_evaluate_candidate` after each meaningful candidate. Correctness must run before performance measurement.
5. Make benchmark output include `KDA_METRIC=<number>`, or pass a metric pattern with capture group 1 or named group `metric`.
6. When NCU is available, save the `.ncu-rep` path and use a profile command that produces bounded textual evidence.
7. Promote only when the result says `promote`. For `revise` or `reject`, retain the stated reason and use it to choose the next candidate.

Do not treat profiler metrics as correctness evidence. Do not silently discard failed candidates; their tool results are part of the session trajectory.
