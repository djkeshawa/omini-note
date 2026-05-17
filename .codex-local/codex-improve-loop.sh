#!/usr/bin/env bash
set -euo pipefail

# Local-only Codex improvement loop.
# This directory is ignored by Git; tune these values before running.
ITERATIONS="${ITERATIONS:-3}"
MODEL="${MODEL:-gpt-5.5}"
REASONING_EFFORT="${REASONING_EFFORT:-high}"
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
RUN_DIR="${RUN_DIR:-$PROJECT_ROOT/.codex-local/runs/$(date +%Y%m%d-%H%M%S)}"
COMMIT_AFTER_EACH_ITERATION="${COMMIT_AFTER_EACH_ITERATION:-1}"
COMMIT_MESSAGE_PREFIX="${COMMIT_MESSAGE_PREFIX:-chore: automated codex improvement}"
STREAM_CODEX_EVENTS="${STREAM_CODEX_EVENTS:-1}"
CODEX_EVENT_OUTPUT_LINES="${CODEX_EVENT_OUTPUT_LINES:-24}"
CODEX_EVENT_OUTPUT_CHARS="${CODEX_EVENT_OUTPUT_CHARS:-6000}"

mkdir -p "$RUN_DIR"

interrupted=0
current_child_pid=""

stop_loop() {
  interrupted=1
  echo >&2
  echo "==> Stop requested; ending active Codex iteration before exiting" >&2

  if [[ -n "$current_child_pid" ]] && kill -0 "$current_child_pid" 2>/dev/null; then
    kill -INT "$current_child_pid" 2>/dev/null || true
  fi
}

trap stop_loop INT TERM

if ! command -v codex >/dev/null 2>&1; then
  echo "codex CLI not found on PATH" >&2
  exit 127
fi

if ! [[ "$ITERATIONS" =~ ^[1-9][0-9]*$ ]]; then
  echo "ITERATIONS must be a positive integer, got: $ITERATIONS" >&2
  exit 2
fi

if [[ "$COMMIT_AFTER_EACH_ITERATION" != "0" && "$COMMIT_AFTER_EACH_ITERATION" != "1" ]]; then
  echo "COMMIT_AFTER_EACH_ITERATION must be 0 or 1, got: $COMMIT_AFTER_EACH_ITERATION" >&2
  exit 2
fi

if [[ "$STREAM_CODEX_EVENTS" != "0" && "$STREAM_CODEX_EVENTS" != "1" ]]; then
  echo "STREAM_CODEX_EVENTS must be 0 or 1, got: $STREAM_CODEX_EVENTS" >&2
  exit 2
fi

if ! [[ "$CODEX_EVENT_OUTPUT_LINES" =~ ^[0-9]+$ ]]; then
  echo "CODEX_EVENT_OUTPUT_LINES must be a non-negative integer, got: $CODEX_EVENT_OUTPUT_LINES" >&2
  exit 2
fi

if ! [[ "$CODEX_EVENT_OUTPUT_CHARS" =~ ^[0-9]+$ ]]; then
  echo "CODEX_EVENT_OUTPUT_CHARS must be a non-negative integer, got: $CODEX_EVENT_OUTPUT_CHARS" >&2
  exit 2
fi

render_codex_events() {
  if ! command -v python3 >/dev/null 2>&1; then
    cat
    return
  fi

  CODEX_EVENT_OUTPUT_LINES="$CODEX_EVENT_OUTPUT_LINES" \
    CODEX_EVENT_OUTPUT_CHARS="$CODEX_EVENT_OUTPUT_CHARS" \
    python3 -c '
import json
import os
import shutil
import sys
import textwrap

line_limit = int(os.environ.get("CODEX_EVENT_OUTPUT_LINES", "24"))
char_limit = int(os.environ.get("CODEX_EVENT_OUTPUT_CHARS", "6000"))
use_color = (
    sys.stdout.isatty()
    and os.environ.get("NO_COLOR") is None
    and os.environ.get("TERM") != "dumb"
)
width = shutil.get_terminal_size((100, 20)).columns
commands = {}

styles = {
    "bold": "\033[1m",
    "dim": "\033[2m",
    "red": "\033[31m",
    "green": "\033[32m",
    "yellow": "\033[33m",
    "cyan": "\033[36m",
    "reset": "\033[0m",
}


def color(text, style):
    if not use_color or not style:
        return text
    return "{}{}{}".format(styles[style], text, styles["reset"])


def println(text="", style=None):
    print(color(text, style), flush=True)


def wrapped(prefix, text, style=None):
    body_width = max(24, width - len(prefix))
    lines = str(text or "").splitlines() or [""]
    for line in lines:
        chunks = textwrap.wrap(
            line,
            width=body_width,
            replace_whitespace=False,
            drop_whitespace=False,
        ) or [""]
        for chunk in chunks:
            println(prefix + chunk, style)


def brief_command(command):
    return " ".join(str(command or "").split())


def print_output(output):
    if line_limit == 0 or char_limit == 0 or not output:
        return

    text = str(output).rstrip("\n")
    if not text:
        return

    omitted_chars = 0
    if len(text) > char_limit:
        omitted_chars = len(text) - char_limit
        text = text[-char_limit:]

    lines = text.splitlines()
    omitted_lines = 0
    if len(lines) > line_limit:
        omitted_lines = len(lines) - line_limit
        lines = lines[-line_limit:]

    println("    output:", "dim")
    if omitted_chars:
        println(f"      ... ({omitted_chars} earlier characters omitted)", "dim")
    if omitted_lines:
        println(f"      ... ({omitted_lines} earlier lines omitted)", "dim")

    max_line = max(20, width - 8)
    for line in lines:
        if len(line) > max_line:
            line = line[: max_line - 3] + "..."
        println("      " + line)


def print_changes(changes):
    for change in changes or []:
        path = change.get("path", "?")
        kind = change.get("kind", "change")
        println(f"    - {kind}: {path}")


for raw_line in sys.stdin:
    raw_line = raw_line.rstrip("\n")
    if not raw_line:
        continue

    try:
        event = json.loads(raw_line)
    except json.JSONDecodeError:
        println(raw_line)
        continue

    event_type = event.get("type", "event")
    item = event.get("item") or {}
    item_type = item.get("type")
    item_id = item.get("id", "?")

    if event_type == "thread.started":
        thread_id = event.get("thread_id", "started")
        println(f"==> Codex thread {thread_id}", "cyan")
        continue

    if event_type == "turn.started":
        println("==> Turn started", "cyan")
        continue

    if item_type == "agent_message":
        println("")
        println("-- Codex message", "bold")
        wrapped("   ", item.get("text", ""))
        continue

    if item_type == "command_execution":
        command = item.get("command", "")
        command_text = brief_command(command)
        if event_type == "item.started":
            commands[item_id] = command_text
            println("")
            println(f"-- Command {item_id}", "bold")
            wrapped("   $ ", command_text, "cyan")
            continue

        status = item.get("status") or "completed"
        exit_code = item.get("exit_code")
        command_text = commands.get(item_id, command_text)
        if item_id not in commands and command_text:
            println("")
            println(f"-- Command {item_id}", "bold")
            wrapped("   $ ", command_text, "cyan")
        ok = status == "completed" and exit_code == 0
        state = "[ok]" if ok else f"[{status}]"
        if exit_code is not None:
            state += f" exit {exit_code}"
        println(f"   {state}", "green" if ok else "red")
        print_output(item.get("aggregated_output", ""))
        continue

    if item_type == "file_change":
        changes = item.get("changes", [])
        if event_type == "item.started":
            println("")
            println(f"-- File changes {item_id}", "bold")
            print_changes(changes)
            continue
        file_status = item.get("status", "completed")
        println(f"   [{file_status}]", "green")
        continue

    if event_type.startswith("item."):
        label = item_type or item.get("type") or "item"
        status = item.get("status")
        suffix = f" ({status})" if status else ""
        println(f"-- {label} {item_id}{suffix}", "dim")
        continue

    println(f"==> {event_type}", "dim")
'
}

previous_summary=""

for ((iteration = 1; iteration <= ITERATIONS; iteration++)); do
  prompt_file="$RUN_DIR/prompt-$iteration.md"
  output_file="$RUN_DIR/output-$iteration.md"
  json_log="$RUN_DIR/events-$iteration.jsonl"

  cat >"$prompt_file" <<PROMPT
You are running iteration $iteration of $ITERATIONS in an automated local improvement loop.

Repository: $PROJECT_ROOT

Goal:
Improve this project pragmatically. Inspect the repository, identify real issues, bugs, missing tests, broken checks, confusing behavior, security vulnerabilities, performance problems, inefficient implementation details, existing feature gaps, overly large code files that would benefit from modularization, or small high-value maintainability improvements. Fix only validated, scoped problems. Preserve unrelated user changes.

Iteration focus:
- Fix issues and bugs that can be reproduced, traced, or strongly validated from the code and tests.
- Optimize the application where there is a concrete inefficiency or measurable performance risk.
- Improve existing features in small, compatible ways instead of inventing unrelated new product surface.
- Check for security vulnerabilities in changed and nearby code paths, then fix validated findings with tests or clear verification.
- Improve performance only when the change is scoped, justified, and does not reduce correctness or maintainability.
- Refactor large code files into smaller cohesive modules and subfolder structures when there is a clear boundary, behavior can be preserved, and the result follows established project conventions and sound software engineering practices.

Rules:
- Start by checking git status and reading relevant project files.
- Do not revert unrelated changes.
- Prefer existing project patterns.
- For refactors, preserve public contracts and runtime behavior, keep module boundaries cohesive, update imports and tests, and avoid broad mechanical rewrites unless they are necessary for the split.
- Use the necessary Codex skills for the work you choose, such as mindful-coder for implementation, codex-security skills for vulnerability review and fixes, crazy-tester for quality investigation, and playwright for browser or UI verification when applicable.
- When parallel exploration, verification, security review, or a bounded implementation slice would reduce the GPT-5.5 high-effort main model's workload, use GPT-5.3-Codex-Spark subagents. To select GPT-5.3-Codex-Spark, do not spawn with a full-history fork; pass only the concise task context the subagent needs. If a full-history fork is required, omit agent_type, model, and reasoning_effort so the subagent inherits them. Keep each subagent task concrete, disjoint where files may be edited, and review its output before integrating it.
- Run the narrowest meaningful tests or checks after changes.
- If you cannot run a useful check, say exactly why.
- Keep changes focused; do not do broad rewrites.
- Do not create a git commit yourself; the wrapper script commits successful iteration changes.
- At the end, provide a concise summary of changes, files touched, verification run, and remaining risks.
- When done, finish your final response. Do not wait for more input; codex exec will exit automatically.

Previous iteration summary:
$previous_summary
PROMPT

  echo "==> Starting Codex iteration $iteration/$ITERATIONS"
  if [[ "$STREAM_CODEX_EVENTS" == "1" ]]; then
    echo "==> Streaming formatted Codex events to terminal"
    echo "    Raw JSON event log: $json_log"
  else
    echo "==> Writing Codex JSON events to $json_log"
  fi

  codex_args=(
    exec
    --dangerously-bypass-approvals-and-sandbox
    --cd "$PROJECT_ROOT"
    -c "model_reasoning_effort=\"$REASONING_EFFORT\""
    --json
    --output-last-message "$output_file"
  )

  if [[ -n "$MODEL" ]]; then
    codex_args+=(--model "$MODEL")
  fi

  set +e
  if [[ "$STREAM_CODEX_EVENTS" == "1" ]]; then
    codex "${codex_args[@]}" - <"$prompt_file" > >(tee "$json_log" | render_codex_events) &
  else
    codex "${codex_args[@]}" - <"$prompt_file" >"$json_log" &
  fi
  current_child_pid=$!
  wait "$current_child_pid"
  status=$?
  current_child_pid=""
  set -e

  if [[ "$interrupted" == "1" || $status -eq 130 || $status -eq 143 ]]; then
    echo "==> Stopped during Codex iteration $iteration/$ITERATIONS" >&2
    echo "Prompt: $prompt_file" >&2
    echo "Event log: $json_log" >&2
    echo "Last message: $output_file" >&2
    exit 130
  fi

  if [[ $status -ne 0 ]]; then
    echo "Codex iteration $iteration failed with exit code $status" >&2
    echo "Prompt: $prompt_file" >&2
    echo "Event log: $json_log" >&2
    echo "Last message: $output_file" >&2
    exit "$status"
  fi

  if [[ -f "$output_file" ]]; then
    previous_summary="$(sed -n '1,160p' "$output_file")"
  else
    previous_summary="Iteration $iteration completed, but no output file was written."
  fi

  echo "==> Completed Codex iteration $iteration/$ITERATIONS"
  echo "    Last message: $output_file"
  echo "    Event log: $json_log"

  if [[ "$COMMIT_AFTER_EACH_ITERATION" == "1" ]]; then
    pushd "$PROJECT_ROOT" >/dev/null
    if [[ -n "$(git status --porcelain)" ]]; then
      git add -A
      git commit -m "$COMMIT_MESSAGE_PREFIX iteration $iteration"
      echo "==> Committed changes for iteration $iteration"
    else
      echo "==> No changes to commit for iteration $iteration"
    fi
    popd >/dev/null
  fi
done

echo "==> All $ITERATIONS iteration(s) complete"
echo "    Run artifacts: $RUN_DIR"
