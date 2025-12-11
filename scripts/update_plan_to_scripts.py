#!/usr/bin/env python3
"""Update plan file to use scripts/ instead of CLI commands."""

import re
from pathlib import Path

# Mapping of CLI paths to scripts paths
PATH_MAPPINGS = {
    r'cli/src/documentation_robotics/analysis/': 'scripts/analysis/',
    r'cli/src/documentation_robotics/validation/': 'scripts/validation/',
    r'cli/src/documentation_robotics/visualization/': 'scripts/visualization/',
    r'cli/src/documentation_robotics/query/': 'scripts/query/',
    r'cli/src/documentation_robotics/reports/': 'scripts/reports/',
    r'cli/src/documentation_robotics/commands/': 'scripts/',
    r'cli/src/documentation_robotics/tools/': 'scripts/tools/',
    r'cli/src/documentation_robotics/export/': 'scripts/export/',
    r'cli/src/documentation_robotics/migration/': 'scripts/migration/',
    r'cli/src/documentation_robotics/generators/': 'scripts/generators/',
    r'cli/src/documentation_robotics/core/link_registry.py': 'scripts/utils/link_registry.py',
    r'cli/src/documentation_robotics/cli.py': 'scripts/run_all_tools.py',
}

# CLI command mappings to script invocations
COMMAND_MAPPINGS = [
    (r'dr ontology analyze (\w+)', r'python scripts/analyze_ontology.py --mode \1'),
    (r'dr ontology validate (\w+)', r'python scripts/validate_links.py --type \1'),
    (r'dr ontology visualize (\w+)', r'python scripts/visualize_ontology.py --type \1'),
    (r'dr ontology report (\w+)', r'python scripts/generate_reports.py --report \1'),
    (r'dr ontology query (.+)', r'python scripts/query_ontology.py \1'),
    (r'dr ontology trace (.+)', r'python scripts/query_ontology.py --trace \1'),
    (r'dr ontology matrix (.+)', r'python scripts/query_ontology.py --matrix \1'),
    (r'dr ontology navigate (.+)', r'python scripts/query_ontology.py --navigate \1'),
    (r'dr ontology path (.+)', r'python scripts/query_ontology.py --path \1'),
    (r'dr ontology dashboard', r'python scripts/ontology_dashboard.py'),
    (r'dr ontology catalog instances', r'python scripts/catalog_link_instances.py'),
    (r'dr registry generate', r'python scripts/generators/generate_link_registry.py'),
    (r'dr registry validate', r'python scripts/validate_registry.py'),
    (r'dr registry (\w+) (.+)', r'python scripts/manage_registry.py --action \1 \2'),
    (r'dr docs generate (\w+) (.+)', r'python scripts/generate_docs.py --type \1 \2'),
    (r'dr docs validate (.+)', r'python scripts/validate_docs.py \1'),
    (r'dr migrate (.+)', r'python scripts/migration/\1.py'),
]

def update_plan(plan_path: Path):
    """Update plan file with script paths and commands."""
    content = plan_path.read_text()

    # Update file paths
    for old_path, new_path in PATH_MAPPINGS.items():
        content = content.replace(old_path, new_path)

    # Update command invocations
    for old_pattern, new_pattern in COMMAND_MAPPINGS:
        content = re.sub(old_pattern, new_pattern, content)

    # Additional specific updates
    content = content.replace(
        "**New Command Groups**:",
        "**Maintainer Scripts**:"
    )
    content = content.replace(
        "Integrate All Commands into CLI",
        "Create Unified Tool Runner"
    )
    content = content.replace(
        "CLI command interface",
        "Maintainer script interface"
    )
    content = content.replace(
        "CLI commands",
        "Maintainer scripts"
    )
    content = content.replace(
        "CLI validation commands",
        "Validation scripts"
    )
    content = content.replace(
        "CLI visualization commands",
        "Visualization scripts"
    )
    content = content.replace(
        "CLI query commands",
        "Query scripts"
    )
    content = content.replace(
        "CLI documentation commands",
        "Documentation scripts"
    )
    content = content.replace(
        "CLI registry commands",
        "Registry management scripts"
    )
    content = content.replace(
        "Integrated CLI with all commands",
        "Unified tool runner for all scripts"
    )
    content = content.replace(
        "All commands integrated into unified CLI",
        "All scripts accessible through unified runner"
    )

    plan_path.write_text(content)
    print(f"Updated {plan_path}")

if __name__ == "__main__":
    plan_path = Path.home() / ".claude" / "plans" / "greedy-munching-cake.md"
    if not plan_path.exists():
        print(f"Plan file not found: {plan_path}")
        exit(1)

    update_plan(plan_path)
    print("Plan updated successfully!")
