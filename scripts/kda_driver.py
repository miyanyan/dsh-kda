#!/usr/bin/env python3
"""Reference JSONL command driver for non-dsh KDA integrations."""

from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_METRIC_PATTERN = r"KDA_METRIC\s*=\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)"


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def emit(event: dict[str, Any]) -> None:
    print(json.dumps(event, separators=(",", ":")), flush=True)


def parse_metric(text: str, pattern: str) -> float | None:
    value: float | None = None
    for match in re.finditer(pattern, text):
        raw = match.groupdict().get("metric") or (match.group(1) if match.groups() else match.group(0))
        candidate = float(raw)
        if math.isfinite(candidate):
            value = candidate
    return value


def run_stage(stage: str, command: str, request: dict[str, Any]) -> dict[str, Any]:
    started_at = timestamp()
    started = time.perf_counter()
    try:
        completed = subprocess.run(
            command,
            cwd=request["workdir"],
            shell=True,
            text=True,
            capture_output=True,
            timeout=request.get("timeoutSeconds", 300),
            check=False,
        )
        result: dict[str, Any] = {
            "stage": stage,
            "command": command,
            "startedAt": started_at,
            "durationMs": (time.perf_counter() - started) * 1000,
            "ok": completed.returncode == 0,
            "exitCode": completed.returncode,
            "signal": None,
            "timedOut": False,
            "aborted": False,
            "stdout": {"text": completed.stdout, "truncated": False},
            "stderr": {"text": completed.stderr, "truncated": False},
        }
    except subprocess.TimeoutExpired as error:
        result = {
            "stage": stage,
            "command": command,
            "startedAt": started_at,
            "durationMs": (time.perf_counter() - started) * 1000,
            "ok": False,
            "exitCode": None,
            "signal": None,
            "timedOut": True,
            "aborted": False,
            "stdout": {"text": error.stdout or "", "truncated": False},
            "stderr": {"text": error.stderr or "", "truncated": False},
        }
    if stage == "benchmark" and result["ok"]:
        metric = parse_metric(result["stdout"]["text"], request.get("metricPattern", DEFAULT_METRIC_PATTERN))
        if metric is not None:
            result["metric"] = metric
        if "metricUnit" in request:
            result["metricUnit"] = request["metricUnit"]
    if stage == "profile" and "profileArtifact" in request:
        result["artifact"] = request["profileArtifact"]
    return result


def decision(request: dict[str, Any], stages: list[dict[str, Any]]) -> tuple[str, str, float | None]:
    correctness = next(stage for stage in stages if stage["stage"] == "correctness")
    if not correctness["ok"]:
        return "reject", "Correctness validation failed.", None
    profile = next((stage for stage in stages if stage["stage"] == "profile"), None)
    if profile is not None and not profile["ok"]:
        return "revise", "Profiling failed; performance evidence is incomplete.", None
    benchmark = next((stage for stage in stages if stage["stage"] == "benchmark"), None)
    if benchmark is None:
        return "revise", "Correctness passed, but no benchmark command was provided.", None
    if not benchmark["ok"]:
        return "reject", "Benchmark command failed.", None
    if "metric" not in benchmark:
        return "revise", "Benchmark passed, but no metric could be parsed from its output.", None
    if "baselineMetric" not in request:
        return "revise", "Candidate metric was recorded, but no baseline metric was provided.", None
    baseline = float(request["baselineMetric"])
    candidate = float(benchmark["metric"])
    delta = baseline - candidate if request.get("lowerIsBetter", True) else candidate - baseline
    improvement = delta / abs(baseline) * 100 if baseline != 0 else (0 if candidate == 0 else math.copysign(math.inf, delta))
    minimum = float(request.get("minimumImprovementPercent", 0))
    if improvement >= minimum:
        return "promote", f"Correctness passed and the target metric improved by {improvement:.3f}%.", improvement
    return "revise", f"Correctness passed, but the target metric improved by only {improvement:.3f}%.", improvement


def evaluate(request: dict[str, Any]) -> dict[str, Any]:
    run_id = str(uuid.uuid4())
    emit({"type": "kda/run-started", "at": timestamp(), "runId": run_id, "task": request["task"], "objective": request["objective"]})
    proposed = {"type": "kda/candidate-proposed", "at": timestamp(), "runId": run_id, "candidate": request["candidate"]}
    if "parentCandidate" in request:
        proposed["parentCandidate"] = request["parentCandidate"]
    emit(proposed)
    stages: list[dict[str, Any]] = []
    for stage, key in (("correctness", "correctnessCommand"), ("benchmark", "benchmarkCommand"), ("profile", "profileCommand")):
        if key not in request or (stage != "correctness" and not stages[0]["ok"]):
            continue
        result = run_stage(stage, request[key], request)
        stages.append(result)
        emit({"type": "kda/stage-completed", "at": timestamp(), "runId": run_id, "candidate": request["candidate"], "result": result})
    outcome, reason, improvement = decision(request, stages)
    decision_event = {"type": "kda/decision-made", "at": timestamp(), "runId": run_id, "candidate": request["candidate"], "decision": outcome, "reason": reason}
    if improvement is not None:
        decision_event["improvementPercent"] = improvement
    emit(decision_event)
    emit({"type": "kda/run-finished", "at": timestamp(), "runId": run_id, "candidate": request["candidate"], "decision": outcome})
    benchmark = next((stage for stage in stages if stage["stage"] == "benchmark"), None)
    return {
        "schemaVersion": 1,
        "runId": run_id,
        "task": request["task"],
        "objective": request["objective"],
        "candidate": request["candidate"],
        "workdir": request["workdir"],
        "decision": outcome,
        "reason": reason,
        "stages": stages,
        **({"candidateMetric": benchmark["metric"]} if benchmark and "metric" in benchmark else {}),
        **({"improvementPercent": improvement} if improvement is not None else {}),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("request", nargs="?", help="JSON request file; defaults to stdin")
    parser.add_argument("--result", help="optional path for the final JSON result")
    args = parser.parse_args()
    request = json.loads(Path(args.request).read_text(encoding="utf-8") if args.request else sys.stdin.read())
    result = evaluate(request)
    emit({"type": "kda/result", "result": result})
    if args.result:
        Path(args.result).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
