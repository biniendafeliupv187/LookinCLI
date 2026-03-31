#!/usr/bin/env python3
"""Sequential trigger eval runner for skills.

This mirrors the trigger-detection logic from skill-creator's run_eval.py,
but avoids ProcessPoolExecutor so it can run in sandboxed environments that
disallow semaphore creation.
"""

from __future__ import annotations

import argparse
import json
import os
import select
import subprocess
import sys
import time
import uuid
from pathlib import Path


def parse_skill_md(skill_path: Path) -> tuple[str, str]:
    content = (skill_path / "SKILL.md").read_text()
    lines = content.split("\n")
    if not lines or lines[0].strip() != "---":
        raise ValueError("SKILL.md missing frontmatter")

    end_idx = None
    for i, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            end_idx = i
            break
    if end_idx is None:
        raise ValueError("SKILL.md missing closing frontmatter")

    name = ""
    description = ""
    frontmatter_lines = lines[1:end_idx]
    i = 0
    while i < len(frontmatter_lines):
        line = frontmatter_lines[i]
        if line.startswith("name:"):
            name = line[len("name:") :].strip().strip('"').strip("'")
        elif line.startswith("description:"):
            value = line[len("description:") :].strip()
            if value in (">", "|", ">-", "|-"):
                continuation_lines: list[str] = []
                i += 1
                while i < len(frontmatter_lines) and (
                    frontmatter_lines[i].startswith("  ")
                    or frontmatter_lines[i].startswith("\t")
                ):
                    continuation_lines.append(frontmatter_lines[i].strip())
                    i += 1
                description = " ".join(continuation_lines)
                continue
            description = value.strip('"').strip("'")
        i += 1

    if not name or not description:
        raise ValueError("SKILL.md frontmatter missing name or description")
    return name, description


def run_single_query(
    query: str,
    skill_name: str,
    skill_description: str,
    timeout: int,
    project_root: Path,
    model: str | None = None,
) -> bool:
    unique_id = uuid.uuid4().hex[:8]
    clean_name = f"{skill_name}-skill-{unique_id}"
    commands_dir = project_root / ".claude" / "commands"
    command_file = commands_dir / f"{clean_name}.md"

    commands_dir.mkdir(parents=True, exist_ok=True)
    indented_desc = "\n  ".join(skill_description.split("\n"))
    command_content = (
        f"---\n"
        f"description: |\n"
        f"  {indented_desc}\n"
        f"---\n\n"
        f"# {skill_name}\n\n"
        f"This skill handles: {skill_description}\n"
    )
    command_file.write_text(command_content)

    try:
        cmd = [
            "claude",
            "-p",
            query,
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
        ]
        if model:
            cmd.extend(["--model", model])

        env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            cwd=project_root,
            env=env,
        )

        start_time = time.time()
        buffer = ""
        pending_tool_name = None
        accumulated_json = ""
        triggered = False

        try:
            while time.time() - start_time < timeout:
                if process.poll() is not None:
                    remaining = process.stdout.read() if process.stdout else b""
                    if remaining:
                        buffer += remaining.decode("utf-8", errors="replace")
                    break

                ready, _, _ = select.select([process.stdout], [], [], 1.0)
                if not ready:
                    continue

                chunk = os.read(process.stdout.fileno(), 8192)
                if not chunk:
                    break
                buffer += chunk.decode("utf-8", errors="replace")

                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    line = line.strip()
                    if not line:
                        continue

                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    if event.get("type") == "stream_event":
                        stream_event = event.get("event", {})
                        event_type = stream_event.get("type", "")

                        if event_type == "content_block_start":
                            block = stream_event.get("content_block", {})
                            if block.get("type") == "tool_use":
                                tool_name = block.get("name", "")
                                if tool_name in ("Skill", "Read"):
                                    pending_tool_name = tool_name
                                    accumulated_json = ""
                                else:
                                    return False

                        elif event_type == "content_block_delta" and pending_tool_name:
                            delta = stream_event.get("delta", {})
                            if delta.get("type") == "input_json_delta":
                                accumulated_json += delta.get("partial_json", "")
                                if skill_name in accumulated_json:
                                    return True

                        elif event_type in ("content_block_stop", "message_stop"):
                            if pending_tool_name:
                                return skill_name in accumulated_json
                            if event_type == "message_stop":
                                return False

                    elif event.get("type") == "assistant":
                        message = event.get("message", {})
                        for content_item in message.get("content", []):
                            if content_item.get("type") != "tool_use":
                                continue
                            tool_name = content_item.get("name", "")
                            tool_input = content_item.get("input", {})
                            if tool_name == "Skill" and skill_name in tool_input.get("skill", ""):
                                triggered = True
                            elif tool_name == "Read" and skill_name in tool_input.get("file_path", ""):
                                triggered = True
                            return triggered

                    elif event.get("type") == "result":
                        return triggered
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()

        return triggered
    finally:
        if command_file.exists():
            command_file.unlink()


def main() -> None:
    parser = argparse.ArgumentParser(description="Sequential trigger eval runner")
    parser.add_argument("--eval-set", required=True)
    parser.add_argument("--skill-path", required=True)
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--timeout", type=int, default=45)
    parser.add_argument("--model", default=None)
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    eval_set = json.loads(Path(args.eval_set).read_text())
    skill_path = Path(args.skill_path)
    project_root = Path(args.project_root)
    skill_name, description = parse_skill_md(skill_path)

    results = []
    for item in eval_set:
        query = item["query"]
        should_trigger = item["should_trigger"]
        if args.verbose:
            print(f"Running: expected={should_trigger} {query}", file=sys.stderr)
        triggered = run_single_query(
            query=query,
            skill_name=skill_name,
            skill_description=description,
            timeout=args.timeout,
            project_root=project_root,
            model=args.model,
        )
        passed = triggered == should_trigger
        results.append(
            {
                "query": query,
                "should_trigger": should_trigger,
                "trigger_rate": 1.0 if triggered else 0.0,
                "triggers": 1 if triggered else 0,
                "runs": 1,
                "pass": passed,
            }
        )
        if args.verbose:
            status = "PASS" if passed else "FAIL"
            print(f"  [{status}] triggered={triggered}", file=sys.stderr)

    output = {
        "skill_name": skill_name,
        "description": description,
        "results": results,
        "summary": {
            "total": len(results),
            "passed": sum(1 for item in results if item["pass"]),
            "failed": sum(1 for item in results if not item["pass"]),
        },
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
