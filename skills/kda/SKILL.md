---
name: kda
description: Run evidence-driven CUDA, Triton, CuTe, or CUTLASS kernel optimization loops with correctness checks, repeatable benchmarks, Nsight Compute profiling, candidate lineage, and promotion decisions. Use for requests to optimize or profile a GPU kernel, diagnose why a kernel is slow, analyze NCU evidence, compare kernel candidates, or continue an existing kernel optimization run, including Chinese requests such as “优化 kernel”, “看 NCU 报告”, “为什么慢”, and “继续迭代”.
---

# Kernel Design Agents loop

Treat the dsh session as the durable optimization record. Optimize one meaningful variable per candidate.

## Establish the run

1. Inspect the workspace and identify the exact kernel, dispatch path, representative workload, and target hardware.
2. State the task contract: correctness constraints, validation command, benchmark command, metric direction, and promotion threshold.
3. Choose one stable `optimizationRunId`; reuse it for every candidate in this run.
4. Measure the unmodified baseline before editing. Do not invent a baseline metric.
5. Record a stable candidate id, a testable hypothesis, and a source revision or concise change summary.

## Iterate

1. Make one hypothesis-driven change.
2. Run `kda_evaluate_candidate` immediately after the change. Reuse `optimizationRunId`; set `parentCandidate` to an earlier candidate after iteration one.
3. Make benchmark output include `KDA_METRIC=<number>`, or pass `metricPattern` with capture group 1 or named group `metric`.
4. Preserve the original baseline across the run. Later calls inherit it from durable prior results when omitted.
5. Read the returned `candidates`, `decision`, and `profileAnalysis`. For `revise` or `reject`, use that evidence to form the next single-variable hypothesis. Never silently discard a failed candidate.
6. Stop when a candidate is promoted, the user's budget is exhausted, or a blocker is explicit. Without a user budget, stop after five evaluated candidates and summarize the best evidence instead of looping indefinitely.

## Profile without guessing

Follow `Profile → Diagnose → Plan`.

- Check `nvidia-smi`, `nvcc --version`, and `ncu --version` before profiling.
- Use representative production shapes and the active dispatch path.
- Compile with `-lineinfo` when source attribution matters.
- Save each `.ncu-rep` under a distinct run/candidate path and pass it as `profileArtifact`.
- Make `profileCommand` emit NCU CSV with `Metric Name`, `Metric Unit`, and `Metric Value` columns. For custom extractors, emit one line per metric as `KDA_NCU_METRIC=<metric-name>|<number>|<unit>`.
- Prefer structured extraction from `.ncu-rep` through NVIDIA's `ncu_report` Python API when available. Do not diagnose by eyeballing a noisy terminal table.
- Cite exact metric names and values. Do not say “memory-bound” or “occupancy-limited” without supporting evidence.
- Collect source counters or PM sampling when overview metrics cannot distinguish latency, imbalance, or tail effects.

## Promotion rules

- Treat correctness as a gate, never as profiler evidence.
- Promote only when correctness passes and the measured metric meets the stated threshold.
- Treat a successful NCU command with no parseable metrics as incomplete profiling, not proof of a bottleneck.
- Keep the candidate graph, profiler artifact paths, benchmark outputs, and decisions reconstructable from the dsh trajectory.
