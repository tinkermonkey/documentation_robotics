#!/usr/bin/env python3
"""
Prepare build by copying integration files to package source.

This script should be run before building the CLI package to ensure
integration files and schemas are up to date.
"""

import shutil
from pathlib import Path


def main():
    # Script is in scripts/, root is 1 level up
    root = Path(__file__).parent.parent
    cli_root = root / "cli"
    src_root = cli_root / "src" / "documentation_robotics"
    integrations_root = root / "integrations"
    spec_root = root / "spec"

    print(f"Project Root: {root}")
    print(f"CLI Root: {cli_root}")
    print(f"Source Root: {src_root}")
    print(f"Integrations Root: {integrations_root}")
    print(f"Spec Root: {spec_root}")

    # Define mappings
    mappings = [
        {
            "source": integrations_root / "claude_code",
            "target": src_root / "claude_integration",
            "name": "Claude Integration",
        },
        {
            "source": integrations_root / "github_copilot",
            "target": src_root / "copilot_integration",
            "name": "GitHub Copilot Integration",
        },
    ]

    for mapping in mappings:
        source = mapping["source"]
        target = mapping["target"]
        name = mapping["name"]

        print(f"\nProcessing {name}...")
        if not source.exists():
            print(f"Warning: Source not found: {source}")
            continue

        if target.exists():
            print(f"Removing existing {target}...")
            shutil.rmtree(target)

        print(f"Copying {source} to {target}...")
        shutil.copytree(source, target)
        print("Done.")

    # Copy link-registry.json
    print("\nProcessing Link Registry...")
    source_registry = spec_root / "schemas" / "link-registry.json"
    target_registry = src_root / "schemas" / "link-registry.json"

    if source_registry.exists():
        print(f"Copying {source_registry} to {target_registry}...")
        shutil.copy2(source_registry, target_registry)
        print("Done.")
    else:
        print(f"Warning: Link registry not found at {source_registry}")

    # Copy layer schemas to bundled directory
    print("\nProcessing Layer Schemas...")
    source_schemas_dir = spec_root / "schemas"
    target_bundled_dir = src_root / "schemas" / "bundled"

    if not target_bundled_dir.exists():
        print(f"Creating bundled directory: {target_bundled_dir}")
        target_bundled_dir.mkdir(parents=True, exist_ok=True)

    # Copy all layer schemas
    layer_schemas = list(source_schemas_dir.glob("*-layer.schema.json"))
    if layer_schemas:
        print(f"Found {len(layer_schemas)} layer schemas to copy...")
        for schema_file in sorted(layer_schemas):
            target_file = target_bundled_dir / schema_file.name
            print(f"  Copying {schema_file.name}...")
            shutil.copy2(schema_file, target_file)
        print("Done.")
    else:
        print(f"Warning: No layer schemas found in {source_schemas_dir}")

    print("\n✓ Build preparation complete!")
    print("\nNext steps:")
    print("  cd cli")
    print("  python -m build")


if __name__ == "__main__":
    main()
