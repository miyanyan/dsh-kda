# dsh-kda Agent Instructions

These instructions apply to the entire repository.

## Product purpose

`dsh-kda` is a semantic Trajectory viewer for CUDA kernel optimization. Its job is to make an existing optimization process easier to understand, inspect, recover, and compare.

The core story shown by the plugin is:

```text
hypothesis -> candidate -> change -> correctness -> benchmark -> profile -> decision -> next iteration
```

The plugin is not a GPU execution platform or a benchmark service.

## Scope

The following capabilities are in scope:

- Projecting ordinary DSH conversation and Trajectory data into a CUDA-optimization-specific view.
- Displaying optimization runs and candidate lineage.
- Comparing baseline and candidate performance.
- Associating correctness, benchmark, and NCU evidence with the candidate that produced it.
- Showing how profiler evidence led to a diagnosis, decision, and next hypothesis.
- Linking semantic KDA entries back to their original Trajectory or Subtool evidence.
- Reconstructing the view after session reload or recovery.
- Producing an evidence-backed summary of why a kernel became faster or why a candidate failed.

The following capabilities are out of scope for the plugin core:

- Providing or brokering local, cloud, or remote GPUs.
- Implementing a remote execution sandbox.
- Owning benchmark datasets, hidden tests, competitions, or leaderboards.
- Reimplementing KernelBench, ComputeEval, GPU Mode, or similar platforms.
- Replacing a project's existing correctness tests, benchmark harness, or profiling commands.
- Becoming a general CUDA optimization agent framework independent of DSH Trajectory.

External benchmark platforms may be optional data-source adapters. They must remain outside the core model and must not be required for the standard KDA experience.

If a proposed change crosses this boundary, stop and explicitly identify it as a scope expansion before implementing it. Do not introduce an external platform integration unless the user specifically requests that integration.

## Data architecture

- Treat the standard `ConversationSnapshot.nodes` stream as the durable source of truth.
- KDA and the native Trajectory view must read the same underlying session data. KDA is a semantic projection, not a second event history.
- Prefer ordinary structured tool results, especially `kda_evaluate_candidate`, as the durable evidence format.
- Do not add a parallel database, event log, session store, or hidden in-memory history for KDA presentation data.
- Do not add custom conversation event types, event projectors, or session assemblers without explicit approval and a demonstrated need that standard nodes cannot satisfy.
- Preserve the original native Trajectory and Subtool evidence. KDA must summarize and organize it, never replace or suppress it.
- Missing, partial, failed, old-schema, and still-running results must degrade to an honest partial view rather than crash the conversation slot.
- Never invent benchmark values, profiler metrics, diagnoses, candidate relationships, or decisions that are absent from durable evidence.

## DSH integration constraints

- Keep KDA in the existing `dsh-kda` plugin unless a separate plugin is explicitly requested.
- Register the dedicated UI through the standard session-scoped `conversation.view` slot.
- Use stable, plugin-specific slot IDs and avoid shadowing or replacing Chat, Trajectory, or views contributed by other plugins.
- Preserve DSH session recovery and standard slot lifecycle behavior.
- Keep projection logic pure and independently testable wherever practical.
- Host-side evaluator commands may execute project-provided correctness, benchmark, and NCU commands, but the UI must remain independent of any particular harness.

## Presentation priorities

Optimize the UI for causal understanding, not raw log volume. A user should be able to answer:

1. What was the optimization hypothesis?
2. What changed in this candidate and what was its parent?
3. Did correctness pass?
4. How did performance change relative to the baseline and previous best?
5. What did NCU or other profiling evidence show?
6. Why was the candidate promoted, revised, or rejected?
7. What evidence or Trajectory node supports each claim?
8. What should the next iteration try?

Prefer progressive disclosure: show the candidate story and key metrics first, with commands, stdout/stderr, and raw evidence available on demand.

## Validation requirements

For changes to parsers, projections, or UI:

- Add or update focused unit tests for structured-result parsing, run grouping, candidate ordering, deduplication, and partial/failure cases.
- Run type checking, the full repository test suite, and the production build.
- For conversation-view changes, verify in a real DSH browser session that the KDA tab renders, an unrelated session shows an empty state, and the native Trajectory tab still works.
- A GPU is not required to validate UI projection and session recovery. A GPU is required only when validating real CUDA correctness, benchmark, or NCU commands.

## Change discipline

- Preserve unrelated user changes in a dirty worktree.
- Do not commit, push, publish, or create a repository unless the user explicitly requests that action for the current change.
- Keep README and user-facing instructions aligned with the scope in this file.
