# lookin trigger eval summary

Date: 2026-03-31

## Setup

- Eval runner: `skill/lookin-workspace/scripts/run_trigger_eval.py`
- Project root for temporary command injection: `LookinCLI/.claude/commands`
- Claude invocation path: wrapped through `skill/lookin-workspace/bin/claude`
- Wrapper behavior: `source ~/.zshrc` -> `mm` -> real `claude`
- Model path after `mm`: MiniMax via local `claude` alias environment

## Eval set

- Positive queries: 7
- Negative queries: 6
- Eval file: `iteration-1/trigger-evals.json`

## Results

Current skill:
- Pass: `6/13`
- Fail: `7/13`
- Pattern: all 7 positive queries failed to trigger; all 6 negative queries correctly did not trigger

Baseline skill snapshot:
- Pass: `6/13`
- Fail: `7/13`
- Pattern: identical to current skill

## Positive-control check

Direct validation query:

`请直接使用 lookin 这个 skill，通过 LookinCLI 帮我看当前 iOS App 的 hierarchy。`

Observed result:

- `triggered = false`

## Interpretation

This round does **not** show a measurable trigger improvement between the old and new descriptions.

Because even the positive-control query failed, the more likely explanation is that under the required `mm -> claude` path, the active model/backend is not participating in the local skill-trigger mechanism used by this eval harness, or is suppressing trigger selection so aggressively that the benchmark cannot distinguish descriptions.

So this run is still useful as environment evidence, but it should **not** be treated as a reliable description-quality comparison between the two skill versions.

## Output files

- `iteration-1/results/current-trigger.json`
- `iteration-1/results/baseline-trigger.json`
- `iteration-1/trigger-evals.json`
