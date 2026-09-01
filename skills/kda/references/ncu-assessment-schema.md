# Original NCU report assessment contract

Create this JSON only after completing the bundled `ncu-report-skill` workflow and writing `REPORT.md`.
Save it as a sidecar file. Pass a sandboxed `ncuReportAssessmentCommand` to `kda_evaluate_candidate` that prints exactly this file and no logging or decoration. For example:

```text
Get-Content -Raw profile/run/ncu-assessment.json
```

or, when the evidence is in WSL:

```text
wsl.exe -- bash -lc "cat /path/to/profile/run/ncu-assessment.json"
```

Rules:

- Use `source="mit-han-lab/ncu-report-skill"` and `sourceCommit="1cf238d6b41c79bd35041192506c4d45e765a3f1"`.
- Include each of the six dimensions exactly once. Use `missing-evidence` honestly; never omit a dimension.
- Include the complete `REPORT.md` text in `reportMarkdown`. JSON-escape it verbatim; do not summarize or truncate it.
- Set `mergedReportPath` to the run-level Concat report produced by the official Report Merge Tool in the benchmark/profile environment. Rebuild it after each profiled candidate from only the per-candidate full reports collected so far.
- Make `mergedReportPath` resolve from the KDA `workdir` in the DSH viewer environment. If profiling runs in WSL or on a server, materialize only the final Concat report into that shared or local workspace before writing the sidecar.
- Copy metric values, source locations, NCU rules, estimated speedups, and conclusions from durable report evidence.
- Match only playbook Pattern `A`–`N`. Do not create a match without its signals, cause, first-line fix, and checked exceptions.
- Rank recommendations by evidence and expected impact. Ranks are unique positive integers.
- Use empty arrays when no pattern, rule, recommendation, secondary finding, or limitation is supported.

```json
{
  "source": "mit-han-lab/ncu-report-skill",
  "sourceCommit": "1cf238d6b41c79bd35041192506c4d45e765a3f1",
  "reportPath": "profile/run/REPORT.md",
  "reportMarkdown": "# NCU Profiling Report\\n\\n<complete REPORT.md content>",
  "fullReportPath": "profile/run/reports/full.ncu-rep",
  "sourceReportPath": "profile/run/reports/source.ncu-rep",
  "mergedReportPath": "profile/run/merged/run-concat.ncu-rep",
  "analysisPath": "profile/run/analysis",
  "targetHardware": "NVIDIA B200 / sm_100",
  "targetKernel": "kernel_name",
  "workload": "representative shape and dispatch path",
  "dimensions": [
    {"dimension":"launch-occupancy","status":"analyzed","conclusion":"Grid and launch-resource conclusion.","signals":[],"limitations":[]},
    {"dimension":"workload-balance","status":"analyzed","conclusion":"Per-SM balance and tail conclusion.","signals":[],"limitations":[]},
    {"dimension":"stall-hotspots","status":"analyzed","conclusion":"Aggregate and source-line stall conclusion.","signals":[],"limitations":[]},
    {"dimension":"tensor-core","status":"not-applicable","conclusion":"Why tensor cores are or are not relevant.","signals":[],"limitations":[]},
    {"dimension":"timeline","status":"analyzed","conclusion":"PM-sampling timeline shape.","signals":[],"limitations":[]},
    {"dimension":"memory","status":"analyzed","conclusion":"DRAM, cache, coalescing, and spill conclusion.","signals":[],"limitations":[]}
  ],
  "patterns": [
    {
      "id":"E",
      "name":"Latency-bound (long-scoreboard-dominated)",
      "confidence":"high",
      "estimatedSpeedupPercent":18,
      "signals":["Exact report signal"],
      "cause":"Evidence-backed cause.",
      "firstLineFix":"Cheapest supported change.",
      "exceptions":[]
    }
  ],
  "rules": [
    {"name":"NCU rule name","severity":"optimization","message":"Rule output.","estimatedSpeedupPercent":18,"evidence":["Rule evidence"]}
  ],
  "primaryDiagnosis":"One-line cross-dimension synthesis with exact values.",
  "secondaryFindings":[],
  "recommendations":[
    {"rank":1,"action":"One concrete change.","rationale":"Why this is first.","expectedImpact":"Expected impact from evidence.","supportingPatterns":["E"],"requiredMetrics":["duration","long-scoreboard"]}
  ],
  "limitations":[]
}
```

Each `signals[]` entry has this shape:

```json
{"statement":"What was measured.","source":"full report, source line, rule, or PM timeline","metric":"exact_metric_name","value":42,"unit":"%"}
```

Omit `metric`, `value`, or `unit` only for qualitative artifacts such as a timeline shape or source annotation.
