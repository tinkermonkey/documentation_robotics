"""
Test for validation ID duplication bug fix.

This test verifies that element IDs are not duplicated during validation.
Bug: Element IDs were being prefixed multiple times, causing errors like:
  security.security.policy.local-access.security.policy.local-access: 'id' is a required property
"""

from pathlib import Path

import pytest
from documentation_robotics.core.model import Model


def test_validation_does_not_duplicate_element_ids(tmp_path):
    """Test that validation does not duplicate element IDs.

    Regression test for bug where element IDs were duplicated like:
    security.security.policy.local-access.security.policy.local-access
    """
    # Create a test project structure
    model_dir = tmp_path / "documentation-robotics" / "model"
    model_dir.mkdir(parents=True)

    # Create manifest
    manifest_content = """version: "0.1.0"
schema: "documentation-robotics-v1"
cli_version: "0.7.2"
spec_version: "0.5.0"
project:
  name: "test-project"
  description: "Test project"
  version: "1.0.0"
layers:
  security:
    order: 3
    name: "Security"
    path: "documentation-robotics/model/03_security/"
    schema: ".dr/schemas/03-security-layer.schema.json"
    enabled: true
    elements: {}
"""
    (model_dir / "manifest.yaml").write_text(manifest_content)

    # Create security layer directory
    security_dir = model_dir / "03_security"
    security_dir.mkdir(parents=True)

    # Create a policy element with proper ID
    policy_content = """local-access:
  id: security.policy.local-access
  type: policy
  name: Local File Access
  description: Policy for local file access
  risk_level: high
"""
    (security_dir / "policies.yaml").write_text(policy_content)

    # Load the model
    model = Model(tmp_path)

    # Validate the model
    result = model.validate(strict=False)

    # Check that there are no errors with duplicated IDs
    for error in result.errors:
        # The element_id should not contain duplicates
        # If the bug exists, we'd see: security.security.policy.local-access.security.policy.local-access
        # After fix, we should see: security.policy.local-access
        if error.element_id:
            parts = error.element_id.split(".")
            # Count occurrences of each part
            part_counts = {}
            for part in parts:
                part_counts[part] = part_counts.get(part, 0) + 1

            # No part should appear more than once (except for valid cases)
            # In a valid ID like "security.policy.local-access", each part appears once
            for part, count in part_counts.items():
                assert count == 1, (
                    f"Element ID has duplicated parts: {error.element_id}. "
                    f"Part '{part}' appears {count} times. "
                    f"This indicates the ID duplication bug is not fixed."
                )


def test_layer_validation_preserves_element_ids(tmp_path):
    """Test that layer validation preserves element IDs without adding prefixes."""
    from documentation_robotics.core.element import Element
    from documentation_robotics.core.layer import Layer

    # Create a test element
    element_id = "security.policy.test-policy"
    element = Element(
        id=element_id,
        element_type="policy",
        layer="security",
        data={
            "id": element_id,
            "type": "policy",
            "name": "Test Policy",
            "description": "A test policy",
            "risk_level": "high",
        },
        file_path=Path("/fake/path.yaml"),
    )

    # Create a layer with the element
    layer = Layer(
        name="security",
        path=tmp_path / "security",
        config={"schema": None, "enabled": True},  # No schema validation for this test
    )
    layer.elements[element_id] = element

    # Validate the layer (with no schema, this should return empty result)
    result = layer.validate(strict=False)

    # If there are any errors or warnings, check that IDs are not duplicated
    for error in result.errors:
        if error.element_id:
            # The element_id should be exactly as provided, not prefixed
            assert error.element_id == element_id or not error.element_id.startswith(
                f"{element_id}.{element_id}"
            ), (
                f"Layer validation duplicated element ID. "
                f"Expected: {element_id}, Got: {error.element_id}"
            )

    for warning in result.warnings:
        if warning.element_id:
            assert warning.element_id == element_id or not warning.element_id.startswith(
                f"{element_id}.{element_id}"
            ), (
                f"Layer validation duplicated element ID in warning. "
                f"Expected: {element_id}, Got: {warning.element_id}"
            )


def test_model_validation_does_not_add_layer_prefix_to_complete_ids(tmp_path):
    """Test that model validation doesn't add layer name to already-complete element IDs."""
    # Create a test project structure
    model_dir = tmp_path / "documentation-robotics" / "model"
    model_dir.mkdir(parents=True)

    # Create manifest with UX layer
    manifest_content = """version: "0.1.0"
schema: "documentation-robotics-v1"
cli_version: "0.7.2"
spec_version: "0.5.0"
project:
  name: "test-project"
  description: "Test project"
  version: "1.0.0"
layers:
  ux:
    order: 10
    name: "User Experience"
    path: "documentation-robotics/model/10_ux/"
    schema: ".dr/schemas/10-ux-layer.schema.json"
    enabled: true
    elements: {}
"""
    (model_dir / "manifest.yaml").write_text(manifest_content)

    # Create UX layer directory
    ux_dir = model_dir / "10_ux"
    ux_dir.mkdir(parents=True)

    # Create a view element
    view_content = """c4-view:
  id: ux.view.c4-view
  type: view
  name: C4 Architecture View
  description: C4 model view
"""
    (ux_dir / "views.yaml").write_text(view_content)

    # Load and validate
    model = Model(tmp_path)
    result = model.validate(strict=False)

    # Check for duplicated layer names in element IDs
    for error in result.errors:
        if error.element_id:
            # Should not see: ux.ux.view.c4-view
            # Should see: ux.view.c4-view
            parts = error.element_id.split(".")
            if len(parts) >= 2 and parts[0] == parts[1]:
                pytest.fail(
                    f"Model validation added layer prefix to complete ID: {error.element_id}. "
                    f"First two parts are duplicated: {parts[0]} == {parts[1]}"
                )
