#!/usr/bin/env python3
"""
Prepare build by copying integration files to package source.
"""

import shutil
from pathlib import Path

def main():
    root = Path(__file__).parent.parent
    src_root = root / "src" / "documentation_robotics"
    integrations_root = root.parent / "integrations"

    print(f"Root: {root}")
    print(f"Source Root: {src_root}")
    print(f"Integrations Root: {integrations_root}")

    # Define mappings
    mappings = [
        {
            "source": integrations_root / "claude_code",
            "target": src_root / "claude_integration",
            "name": "Claude Integration"
        },
        {
            "source": integrations_root / "github_copilot",
            "target": src_root / "copilot_integration",
            "name": "GitHub Copilot Integration"
        }
    ]

    for mapping in mappings:
        source = mapping["source"]
        target = mapping["target"]
        name = mapping["name"]

        print(f"\nProcessing {name}...")
        if not source.exists():
            print(f"Error: Source not found: {source}")
            continue

        if target.exists():
            print(f"Removing existing {target}...")
            shutil.rmtree(target)

        print(f"Copying {source} to {target}...")
        shutil.copytree(source, target)
        print("Done.")

if __name__ == "__main__":
    main()
