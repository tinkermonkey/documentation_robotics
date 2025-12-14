#!/usr/bin/env python3
"""Update link-registry.json to allow cross-layer links in more layers."""

import json
from pathlib import Path

def main():
    spec_root = Path(__file__).parent.parent / "spec"
    registry_path = spec_root / "schemas" / "link-registry.json"

    print(f"Updating {registry_path}...")

    # Load the registry
    with open(registry_path, 'r', encoding='utf-8') as f:
        registry = json.load(f)

    # All layer prefixes (excluding 01-motivation which is the target, not source)
    all_layers = ["02-business", "03-security", "04-application", "05-technology",
                  "06-api", "07-data-model", "08-datastore", "09-ux",
                  "10-navigation", "11-apm-observability", "12-testing"]

    # Links to update and their new source layers
    updates = {
        "motivation-governed-by-principles": all_layers,
        "motivation-supports-goals": all_layers,
        "security-classification": all_layers,  # Allow all layers to reference security classifications
    }

    # Update the link types
    changes_made = 0
    for link_type in registry.get("linkTypes", []):
        link_id = link_type.get("id")
        if link_id in updates:
            old_sources = link_type.get("sourceLayers", [])
            new_sources = updates[link_id]

            print(f"\n  {link_id}:")
            print(f"    Old: {old_sources}")
            print(f"    New: {new_sources}")

            link_type["sourceLayers"] = new_sources

            # Also update sourceElementTypesByLayer if it exists
            if "sourceElementTypesByLayer" in link_type:
                # Get the element types from the first existing layer as template
                template_types = None
                for layer in old_sources:
                    if layer in link_type["sourceElementTypesByLayer"]:
                        template_types = link_type["sourceElementTypesByLayer"][layer]
                        break

                # Apply to all new layers (using empty list if no template found)
                if template_types is not None:
                    for layer in new_sources:
                        if layer not in link_type["sourceElementTypesByLayer"]:
                            link_type["sourceElementTypesByLayer"][layer] = template_types

            changes_made += 1

    # Save the updated registry
    with open(registry_path, 'w', encoding='utf-8') as f:
        json.dump(registry, f, indent=2, ensure_ascii=False)
        f.write('\n')

    print(f"\n✓ Updated {changes_made} link types")
    print(f"✓ Saved to {registry_path}")

if __name__ == "__main__":
    main()
