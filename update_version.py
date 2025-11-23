#!/usr/bin/env python3
"""
Script to update spec version references across the repository.

Usage:
    python update_version.py --from 1.0.0 --to 0.1.0 --dry-run
    python update_version.py --from 1.0.0 --to 0.1.0
"""

import argparse
import re
from pathlib import Path
from typing import List, Tuple

# Files to completely exclude from version updates
EXCLUDE_FILES = {
    "pyproject.toml",
    "package.json",
    "package-lock.json",
    "poetry.lock",
    "Pipfile.lock",
    "requirements.txt",
    "update_version.py",  # Don't update this script itself
}

# Directories to completely exclude
EXCLUDE_DIRS = {
    ".git",
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
    ".pytest_cache",
    ".mypy_cache",
}

# Patterns to skip (regex patterns for lines that should not be modified)
SKIP_PATTERNS = [
    r"keepachangelog\.com/en/\d+\.\d+\.\d+",  # Keep a Changelog URL
    r">=\d+\.\d+\.\d+",  # Dependency version constraints
    r"~=\d+\.\d+\.\d+",  # Dependency version constraints
    r"\^=\d+\.\d+\.\d+",  # Dependency version constraints
]


def should_skip_line(line: str, skip_patterns: List[str]) -> bool:
    """Check if a line should be skipped based on patterns."""
    for pattern in skip_patterns:
        if re.search(pattern, line):
            return True
    return False


def update_file(
    file_path: Path,
    from_version: str,
    to_version: str,
    skip_patterns: List[str],
    dry_run: bool = True,
) -> Tuple[bool, int]:
    """
    Update version references in a single file.

    Returns:
        Tuple of (was_modified, num_replacements)
    """
    try:
        content = file_path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, PermissionError):
        # Skip binary files or files we can't read
        return False, 0

    lines = content.split("\n")
    modified_lines = []
    num_replacements = 0

    for line in lines:
        if should_skip_line(line, skip_patterns):
            # Keep line unchanged if it matches a skip pattern
            modified_lines.append(line)
        else:
            # Replace version in this line
            new_line = line.replace(from_version, to_version)
            if new_line != line:
                num_replacements += 1
            modified_lines.append(new_line)

    new_content = "\n".join(modified_lines)

    if new_content != content:
        if not dry_run:
            file_path.write_text(new_content, encoding="utf-8")
        return True, num_replacements

    return False, 0


def find_files(root_dir: Path, include_dirs: List[str]) -> List[Path]:
    """Find all files to process in the specified directories."""
    files_to_process = []

    for include_dir in include_dirs:
        search_path = root_dir / include_dir
        if not search_path.exists():
            print(f"Warning: Directory {include_dir} does not exist, skipping")
            continue

        if search_path.is_file():
            # If it's a file, just add it
            files_to_process.append(search_path)
        else:
            # If it's a directory, walk it
            for file_path in search_path.rglob("*"):
                # Skip if it's a directory
                if file_path.is_dir():
                    continue

                # Skip if in excluded directory
                if any(excluded in file_path.parts for excluded in EXCLUDE_DIRS):
                    continue

                # Skip if excluded file
                if file_path.name in EXCLUDE_FILES:
                    continue

                files_to_process.append(file_path)

    return sorted(files_to_process)


def main():
    parser = argparse.ArgumentParser(
        description="Update spec version references across the repository"
    )
    parser.add_argument(
        "--from",
        dest="from_version",
        required=True,
        help="Version to replace (e.g., 1.0.0)",
    )
    parser.add_argument(
        "--to",
        dest="to_version",
        required=True,
        help="New version (e.g., 0.1.0)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be changed without modifying files",
    )
    parser.add_argument(
        "--include",
        nargs="+",
        default=["spec", "README.md", "CLAUD.md", "RELEASE_PROCESS.md", ".github"],
        help="Directories or files to include (default: spec README.md CLAUD.md RELEASE_PROCESS.md .github)",
    )

    args = parser.parse_args()

    root_dir = Path(__file__).parent

    print(f"Updating version references: {args.from_version} -> {args.to_version}")
    print(f"Root directory: {root_dir}")
    print(f"Include: {', '.join(args.include)}")
    if args.dry_run:
        print("DRY RUN MODE - No files will be modified")
    print()

    files_to_process = find_files(root_dir, args.include)

    print(f"Found {len(files_to_process)} files to process")
    print()

    modified_files = []
    total_replacements = 0

    for file_path in files_to_process:
        was_modified, num_replacements = update_file(
            file_path,
            args.from_version,
            args.to_version,
            SKIP_PATTERNS,
            args.dry_run,
        )

        if was_modified:
            rel_path = file_path.relative_to(root_dir)
            modified_files.append(str(rel_path))
            total_replacements += num_replacements
            print(f"{'Would modify' if args.dry_run else 'Modified'}: {rel_path} ({num_replacements} replacements)")

    print()
    print(f"Summary:")
    print(f"  Files {'that would be ' if args.dry_run else ''}modified: {len(modified_files)}")
    print(f"  Total replacements: {total_replacements}")

    if args.dry_run and modified_files:
        print()
        print("Run without --dry-run to apply these changes")


if __name__ == "__main__":
    main()
