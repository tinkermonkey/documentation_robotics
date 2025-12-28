import os
import re
from pathlib import Path
from typing import Dict, List, Set, Tuple

import click
import pytest
from documentation_robotics.cli import cli

# --- 1. Extract CLI Schema ---


def get_command_schema(command: click.Command, parent_name: str = "dr") -> Dict[str, Set[str]]:
    """
    Recursively extracts commands and their valid options from a Click CLI object.
    Returns a dict: {"dr command": {"--option1", "--option2", "-o"}}
    """
    schema = {}

    # Get options for the current command
    options = set()
    for param in command.params:
        if isinstance(param, click.Option):
            options.update(param.opts)

    schema[parent_name] = options

    # Recurse if it's a group
    if isinstance(command, click.Group):
        for subcommand_name, subcommand in command.commands.items():
            full_name = f"{parent_name} {subcommand_name}"
            schema.update(get_command_schema(subcommand, full_name))

    return schema


CLI_SCHEMA = get_command_schema(cli)

# --- 2. Documentation Scanner ---

# Paths relative to the workspace root
DOCS_DIRS = [
    "cli/src/documentation_robotics/claude_integration",
    "integrations/github_copilot/src/prompts",
]

# Regex to find "dr <command> ..." lines
# Matches:
# - Start of line or after whitespace
# - "dr "
# - The rest of the line until newline or pipe or redirect
DR_CMD_PATTERN = re.compile(r"(?:^|\s|`)(dr\s+[a-z0-9-]+(?:[\s]+[a-z0-9-]+)*)(.*)")


def extract_commands_from_file(file_path: Path) -> List[Tuple[int, str, str]]:
    """
    Scans a file for 'dr ...' commands.
    Returns list of (line_number, full_command_string, file_path)
    """
    commands = []
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            lines = f.readlines()

        for i, line in enumerate(lines):
            clean_line = line.strip()

            # Skip comments in code blocks if possible, but hard to detect.
            # Skip lines that are just "dr"
            if clean_line == "dr":
                continue

            # Heuristic: It starts with "dr " or "$ dr " or "   dr "
            if "dr " in clean_line:
                # Remove prompt markers
                if clean_line.startswith("$ "):
                    clean_line = clean_line[2:]

                # Extract the command part
                match = DR_CMD_PATTERN.search(clean_line)
                if match:
                    cmd_base = match.group(1).strip()  # e.g. "dr validate"
                    args = match.group(2).strip()  # e.g. "--format json"

                    full_cmd = f"{cmd_base} {args}".strip()

                    # Cleanup: Remove trailing characters like ` | \` or ` > file`
                    full_cmd = full_cmd.split("|")[0].split(">")[0].strip()
                    full_cmd = full_cmd.replace("`", "").replace("\\", "").strip()

                    # Skip if it looks like prose (no flags, long string)
                    # But "dr validate" has no flags and is valid.
                    # "dr add business service" has no flags and is valid.

                    commands.append((i + 1, full_cmd, str(file_path)))

    except Exception as e:
        print(f"Error reading {file_path}: {e}")

    return commands


def get_all_doc_commands():
    # Assume we are at workspace root or cli root
    # Try to find the workspace root by looking for 'cli' folder
    cwd = Path(os.getcwd())
    root_dir = cwd
    if (cwd / "cli").exists():
        root_dir = cwd
    elif (cwd / "src").exists() and cwd.name == "cli":
        root_dir = cwd.parent

    all_commands = []

    for doc_dir in DOCS_DIRS:
        path = root_dir / doc_dir
        if not path.exists():
            # Try relative to cli/ if we are in cli/
            if (root_dir / ".." / doc_dir).exists():
                path = root_dir / ".." / doc_dir
            else:
                print(f"Warning: Docs dir not found: {path}")
                continue

        for root, _, files in os.walk(path):
            for file in files:
                if file.endswith(".md") or file.endswith(".ts") or file.endswith(".js"):
                    all_commands.extend(extract_commands_from_file(Path(root) / file))

    return all_commands


# --- 3. The Test ---


@pytest.mark.parametrize("line_num, cmd_str, file_path", get_all_doc_commands())
def test_doc_command_validity(line_num, cmd_str, file_path):
    """
    Validates a single 'dr' command found in documentation.
    """
    # 1. Parse the command string to find the longest matching command in CLI_SCHEMA
    matched_cmd = None

    # Sort schema keys by length (descending) to match most specific command first
    sorted_cmds = sorted(CLI_SCHEMA.keys(), key=len, reverse=True)

    for cmd in sorted_cmds:
        if cmd_str.startswith(cmd):
            # Ensure it's a whole word match
            if len(cmd_str) == len(cmd) or cmd_str[len(cmd)] == " ":
                matched_cmd = cmd
                break

    if not matched_cmd:
        # Allow "dr" by itself
        if cmd_str.strip() == "dr":
            return

        # If it has flags, it's likely a command we missed or is invalid
        if "-" in cmd_str:
            pytest.fail(f"Unknown command '{cmd_str}' in {file_path}:{line_num}")

        # If no flags, it might be prose like "dr tool" or "dr agent"
        # We'll skip it to avoid false positives on prose
        return

    # 2. Extract flags used in the command string
    # Regex to find --flag or -f
    # We need to be careful not to match values like "key=value" as flags unless they start with -
    used_flags = re.findall(r"(?:\s|^)(\-[a-zA-Z0-9-]+)", cmd_str)

    # 3. Validate flags
    valid_options = CLI_SCHEMA[matched_cmd]
    # Add global options
    valid_options.add("--help")
    valid_options.add("--verbose")
    valid_options.add("--version")

    for flag in used_flags:
        clean_flag = flag.strip()

        # Ignore placeholders like --format (if it's just describing the flag)
        # But here we are validating examples, so they should be real flags.

        if clean_flag not in valid_options:
            # Check for common false positives
            if clean_flag in ["-", "--"]:
                continue

            pytest.fail(
                f"Invalid option '{clean_flag}' for command '{matched_cmd}'\n"
                f"File: {file_path}:{line_num}\n"
                f"Command: {cmd_str}\n"
                f"Valid options: {sorted(valid_options)}"
            )
