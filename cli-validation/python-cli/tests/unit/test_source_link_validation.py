"""Unit tests for source code reference validation in LinkValidator.

Tests cover:
- File existence validation
- Symbol existence validation
- Error handling for missing fields
- Support for different field path structures
"""

import os
import tempfile
from pathlib import Path

from documentation_robotics.core.link_analyzer import LinkAnalyzer
from documentation_robotics.core.link_registry import LinkRegistry
from documentation_robotics.validators.link_validator import (
    LinkValidator,
    ValidationSeverity,
)


class MockElement:
    """Mock element for testing."""

    def __init__(self, element_id: str, data: dict):
        self.id = element_id
        self.data = data


class MockLayer:
    """Mock layer for testing."""

    def __init__(self, layer_name: str, elements: dict = None):
        self.name = layer_name
        self.elements = elements or {}


class MockModel:
    """Mock model for testing."""

    def __init__(self, layers: dict = None):
        self.layers = layers or {}


class TestSourceReferenceExtraction:
    """Test source reference extraction from element data."""

    def test_extract_x_source_reference(self):
        """Test extraction of x-source-reference field."""
        registry = LinkRegistry()
        analyzer = LinkAnalyzer(registry)
        validator = LinkValidator(registry, analyzer)

        data = {
            "id": "api-op-001",
            "x-source-reference": {
                "provenance": "extracted",
                "locations": [{"file": "src/orders.py"}],
            },
        }

        refs = validator._extract_source_references(data)

        assert len(refs) == 1
        assert refs[0][0] == "x-source-reference"
        assert refs[0][1]["provenance"] == "extracted"

    def test_extract_source_reference(self):
        """Test extraction of source.reference field."""
        registry = LinkRegistry()
        analyzer = LinkAnalyzer(registry)
        validator = LinkValidator(registry, analyzer)

        data = {
            "id": "ux-component-001",
            "source": {
                "reference": {
                    "provenance": "manual",
                    "locations": [{"file": "src/components/Form.tsx"}],
                }
            },
        }

        refs = validator._extract_source_references(data)

        assert len(refs) == 1
        assert refs[0][0] == "source.reference"

    def test_extract_properties_source_reference(self):
        """Test extraction of properties.source.reference field."""
        registry = LinkRegistry()
        analyzer = LinkAnalyzer(registry)
        validator = LinkValidator(registry, analyzer)

        data = {
            "id": "app-component-001",
            "properties": {
                "source": {
                    "reference": {
                        "provenance": "extracted",
                        "locations": [{"file": "src/components/OrderService.java"}],
                    }
                }
            },
        }

        refs = validator._extract_source_references(data)

        assert len(refs) == 1
        assert refs[0][0] == "properties.source.reference"

    def test_extract_multiple_references(self):
        """Test extraction when multiple reference types exist."""
        registry = LinkRegistry()
        analyzer = LinkAnalyzer(registry)
        validator = LinkValidator(registry, analyzer)

        data = {
            "id": "api-op-001",
            "x-source-reference": {
                "provenance": "extracted",
                "locations": [{"file": "src/api.py"}],
            },
            "source": {
                "reference": {
                    "provenance": "manual",
                    "locations": [{"file": "src/handlers.py"}],
                }
            },
        }

        refs = validator._extract_source_references(data)

        assert len(refs) == 2

    def test_extract_no_references(self):
        """Test extraction when no references exist."""
        registry = LinkRegistry()
        analyzer = LinkAnalyzer(registry)
        validator = LinkValidator(registry, analyzer)

        data = {"id": "element-001", "name": "Test Element"}

        refs = validator._extract_source_references(data)

        assert len(refs) == 0


class TestFileExistenceValidation:
    """Test file existence validation."""

    def test_valid_file_exists(self):
        """Test validation passes when file exists."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create a test file
            test_file = Path(tmpdir) / "test.py"
            test_file.write_text("# test file")

            # Change to temp directory for validation
            old_cwd = os.getcwd()
            try:
                os.chdir(tmpdir)

                registry = LinkRegistry()
                analyzer = LinkAnalyzer(registry)
                validator = LinkValidator(registry, analyzer)

                source_ref = {
                    "provenance": "extracted",
                    "locations": [{"file": "test.py"}],
                }

                issues = validator._validate_source_reference(
                    "element-001", source_ref, "x-source-reference", deep_validation=False
                )

                assert len(issues) == 0
            finally:
                os.chdir(old_cwd)

    def test_missing_file_error(self):
        """Test validation fails when file doesn't exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            old_cwd = os.getcwd()
            try:
                os.chdir(tmpdir)

                registry = LinkRegistry()
                analyzer = LinkAnalyzer(registry)
                validator = LinkValidator(registry, analyzer)

                source_ref = {
                    "provenance": "extracted",
                    "locations": [{"file": "nonexistent.py"}],
                }

                issues = validator._validate_source_reference(
                    "element-001", source_ref, "x-source-reference", deep_validation=False
                )

                assert len(issues) == 1
                assert issues[0].severity == ValidationSeverity.ERROR
                assert issues[0].issue_type == "source-file-not-found"
                assert "nonexistent.py" in issues[0].message
            finally:
                os.chdir(old_cwd)

    def test_multiple_locations_partial_missing(self):
        """Test validation with multiple locations where some are missing."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create one file
            test_file = Path(tmpdir) / "existing.py"
            test_file.write_text("# exists")

            old_cwd = os.getcwd()
            try:
                os.chdir(tmpdir)

                registry = LinkRegistry()
                analyzer = LinkAnalyzer(registry)
                validator = LinkValidator(registry, analyzer)

                source_ref = {
                    "provenance": "extracted",
                    "locations": [
                        {"file": "existing.py", "symbol": "func1"},
                        {"file": "missing.py", "symbol": "func2"},
                    ],
                }

                issues = validator._validate_source_reference(
                    "element-001", source_ref, "x-source-reference", deep_validation=False
                )

                # Should have one error for missing file
                assert len(issues) == 1
                assert issues[0].issue_type == "source-file-not-found"
            finally:
                os.chdir(old_cwd)

    def test_nested_directory_path(self):
        """Test validation with nested directory paths."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create nested structure
            nested_dir = Path(tmpdir) / "src" / "services"
            nested_dir.mkdir(parents=True)
            test_file = nested_dir / "payment.py"
            test_file.write_text("# payment service")

            old_cwd = os.getcwd()
            try:
                os.chdir(tmpdir)

                registry = LinkRegistry()
                analyzer = LinkAnalyzer(registry)
                validator = LinkValidator(registry, analyzer)

                source_ref = {
                    "provenance": "extracted",
                    "locations": [{"file": "src/services/payment.py"}],
                }

                issues = validator._validate_source_reference(
                    "element-001", source_ref, "x-source-reference", deep_validation=False
                )

                assert len(issues) == 0
            finally:
                os.chdir(old_cwd)


class TestSymbolValidation:
    """Test Python symbol existence validation."""

    def test_valid_function_symbol(self):
        """Test validation passes for valid function."""
        with tempfile.TemporaryDirectory() as tmpdir:
            test_file = Path(tmpdir) / "test.py"
            test_file.write_text("def my_function():\n    pass")

            old_cwd = os.getcwd()
            try:
                os.chdir(tmpdir)

                registry = LinkRegistry()
                analyzer = LinkAnalyzer(registry)
                validator = LinkValidator(registry, analyzer)

                source_ref = {
                    "provenance": "extracted",
                    "locations": [{"file": "test.py", "symbol": "my_function"}],
                }

                issues = validator._validate_source_reference(
                    "element-001", source_ref, "x-source-reference", deep_validation=True
                )

                assert len(issues) == 0
            finally:
                os.chdir(old_cwd)

    def test_valid_class_symbol(self):
        """Test validation passes for valid class."""
        with tempfile.TemporaryDirectory() as tmpdir:
            test_file = Path(tmpdir) / "test.py"
            test_file.write_text("class MyClass:\n    def method(self):\n        pass")

            old_cwd = os.getcwd()
            try:
                os.chdir(tmpdir)

                registry = LinkRegistry()
                analyzer = LinkAnalyzer(registry)
                validator = LinkValidator(registry, analyzer)

                source_ref = {
                    "provenance": "extracted",
                    "locations": [{"file": "test.py", "symbol": "MyClass"}],
                }

                issues = validator._validate_source_reference(
                    "element-001", source_ref, "x-source-reference", deep_validation=True
                )

                assert len(issues) == 0
            finally:
                os.chdir(old_cwd)

    def test_valid_method_symbol(self):
        """Test validation passes for valid method."""
        with tempfile.TemporaryDirectory() as tmpdir:
            test_file = Path(tmpdir) / "test.py"
            test_file.write_text("class MyClass:\n    def my_method(self):\n        pass")

            old_cwd = os.getcwd()
            try:
                os.chdir(tmpdir)

                registry = LinkRegistry()
                analyzer = LinkAnalyzer(registry)
                validator = LinkValidator(registry, analyzer)

                source_ref = {
                    "provenance": "extracted",
                    "locations": [{"file": "test.py", "symbol": "MyClass.my_method"}],
                }

                issues = validator._validate_source_reference(
                    "element-001", source_ref, "x-source-reference", deep_validation=True
                )

                assert len(issues) == 0
            finally:
                os.chdir(old_cwd)

    def test_missing_function_symbol(self):
        """Test validation fails for missing function."""
        with tempfile.TemporaryDirectory() as tmpdir:
            test_file = Path(tmpdir) / "test.py"
            test_file.write_text("def existing_function():\n    pass")

            old_cwd = os.getcwd()
            try:
                os.chdir(tmpdir)

                registry = LinkRegistry()
                analyzer = LinkAnalyzer(registry)
                validator = LinkValidator(registry, analyzer)

                source_ref = {
                    "provenance": "extracted",
                    "locations": [{"file": "test.py", "symbol": "missing_function"}],
                }

                issues = validator._validate_source_reference(
                    "element-001", source_ref, "x-source-reference", deep_validation=True
                )

                assert len(issues) == 1
                assert issues[0].severity == ValidationSeverity.WARNING
                assert issues[0].issue_type == "source-symbol-not-found"
            finally:
                os.chdir(old_cwd)

    def test_missing_method_symbol(self):
        """Test validation fails for missing method."""
        with tempfile.TemporaryDirectory() as tmpdir:
            test_file = Path(tmpdir) / "test.py"
            test_file.write_text("class MyClass:\n    def existing_method(self):\n        pass")

            old_cwd = os.getcwd()
            try:
                os.chdir(tmpdir)

                registry = LinkRegistry()
                analyzer = LinkAnalyzer(registry)
                validator = LinkValidator(registry, analyzer)

                source_ref = {
                    "provenance": "extracted",
                    "locations": [{"file": "test.py", "symbol": "MyClass.missing_method"}],
                }

                issues = validator._validate_source_reference(
                    "element-001", source_ref, "x-source-reference", deep_validation=True
                )

                assert len(issues) == 1
                assert issues[0].severity == ValidationSeverity.WARNING
                assert issues[0].issue_type == "source-symbol-not-found"
            finally:
                os.chdir(old_cwd)

    def test_symbol_validation_non_python_file(self):
        """Test symbol validation is skipped for non-Python files."""
        with tempfile.TemporaryDirectory() as tmpdir:
            test_file = Path(tmpdir) / "test.ts"
            test_file.write_text("export class MyClass {}")

            old_cwd = os.getcwd()
            try:
                os.chdir(tmpdir)

                registry = LinkRegistry()
                analyzer = LinkAnalyzer(registry)
                validator = LinkValidator(registry, analyzer)

                source_ref = {
                    "provenance": "extracted",
                    "locations": [{"file": "test.ts", "symbol": "NonExistentClass"}],
                }

                issues = validator._validate_source_reference(
                    "element-001", source_ref, "x-source-reference", deep_validation=True
                )

                # Should not have symbol validation error for non-Python file
                assert len(issues) == 0
            finally:
                os.chdir(old_cwd)

    def test_symbol_validation_without_deep_flag(self):
        """Test symbol validation is skipped when deep_validation is False."""
        with tempfile.TemporaryDirectory() as tmpdir:
            test_file = Path(tmpdir) / "test.py"
            test_file.write_text("def existing_function():\n    pass")

            old_cwd = os.getcwd()
            try:
                os.chdir(tmpdir)

                registry = LinkRegistry()
                analyzer = LinkAnalyzer(registry)
                validator = LinkValidator(registry, analyzer)

                source_ref = {
                    "provenance": "extracted",
                    "locations": [{"file": "test.py", "symbol": "missing_function"}],
                }

                issues = validator._validate_source_reference(
                    "element-001", source_ref, "x-source-reference", deep_validation=False
                )

                # Should not have symbol validation error when deep_validation is False
                assert len(issues) == 0
            finally:
                os.chdir(old_cwd)


class TestSourceReferenceFieldValidation:
    """Test validation of source reference structure."""

    def test_missing_locations_field(self):
        """Test error when locations field is missing."""
        registry = LinkRegistry()
        analyzer = LinkAnalyzer(registry)
        validator = LinkValidator(registry, analyzer)

        source_ref = {"provenance": "extracted"}

        issues = validator._validate_source_reference(
            "element-001", source_ref, "x-source-reference", deep_validation=False
        )

        assert len(issues) == 1
        assert issues[0].issue_type == "missing-locations"

    def test_empty_locations_array(self):
        """Test error when locations array is empty."""
        registry = LinkRegistry()
        analyzer = LinkAnalyzer(registry)
        validator = LinkValidator(registry, analyzer)

        source_ref = {"provenance": "extracted", "locations": []}

        issues = validator._validate_source_reference(
            "element-001", source_ref, "x-source-reference", deep_validation=False
        )

        assert len(issues) == 1
        assert issues[0].issue_type == "empty-locations"

    def test_missing_file_in_location(self):
        """Test error when file is missing from location."""
        registry = LinkRegistry()
        analyzer = LinkAnalyzer(registry)
        validator = LinkValidator(registry, analyzer)

        source_ref = {"provenance": "extracted", "locations": [{"symbol": "MyClass"}]}

        issues = validator._validate_source_reference(
            "element-001", source_ref, "x-source-reference", deep_validation=False
        )

        assert len(issues) == 1
        assert issues[0].issue_type == "missing-file"

    def test_invalid_location_format(self):
        """Test error when location is not an object."""
        registry = LinkRegistry()
        analyzer = LinkAnalyzer(registry)
        validator = LinkValidator(registry, analyzer)

        source_ref = {"provenance": "extracted", "locations": ["src/file.py"]}

        issues = validator._validate_source_reference(
            "element-001", source_ref, "x-source-reference", deep_validation=False
        )

        assert len(issues) == 1
        assert issues[0].issue_type == "invalid-location-format"


class TestFullModelValidation:
    """Test validation across full model with multiple layers."""

    def test_validate_source_references_full_model(self):
        """Test source reference validation across full model."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create test files
            (Path(tmpdir) / "src").mkdir()
            (Path(tmpdir) / "src" / "api.py").write_text("def create():\n    pass")
            (Path(tmpdir) / "src" / "ux.tsx").write_text("export class Form {}")

            old_cwd = os.getcwd()
            try:
                os.chdir(tmpdir)

                # Create mock model
                api_element = MockElement(
                    "api-op-001",
                    {
                        "x-source-reference": {
                            "provenance": "extracted",
                            "locations": [{"file": "src/api.py", "symbol": "create"}],
                        }
                    },
                )
                api_layer = MockLayer("api", {"api-op-001": api_element})

                ux_element = MockElement(
                    "ux-comp-001",
                    {
                        "source": {
                            "reference": {
                                "provenance": "extracted",
                                "locations": [{"file": "src/ux.tsx"}],
                            }
                        }
                    },
                )
                ux_layer = MockLayer("ux", {"ux-comp-001": ux_element})

                model = MockModel({"api": api_layer, "ux": ux_layer})

                registry = LinkRegistry()
                analyzer = LinkAnalyzer(registry)
                validator = LinkValidator(registry, analyzer)

                issues = validator.validate_source_references(model, deep_validation=True)

                assert len(issues) == 0
            finally:
                os.chdir(old_cwd)

    def test_validate_source_references_with_errors(self):
        """Test source reference validation returns errors for missing files."""
        with tempfile.TemporaryDirectory() as tmpdir:
            old_cwd = os.getcwd()
            try:
                os.chdir(tmpdir)

                # Create mock model with missing file references
                api_element = MockElement(
                    "api-op-001",
                    {
                        "x-source-reference": {
                            "provenance": "extracted",
                            "locations": [{"file": "src/missing.py"}],
                        }
                    },
                )
                api_layer = MockLayer("api", {"api-op-001": api_element})

                model = MockModel({"api": api_layer})

                registry = LinkRegistry()
                analyzer = LinkAnalyzer(registry)
                validator = LinkValidator(registry, analyzer)

                issues = validator.validate_source_references(model, deep_validation=False)

                assert len(issues) == 1
                assert issues[0].issue_type == "source-file-not-found"
            finally:
                os.chdir(old_cwd)

    def test_validate_relationships_and_source_links_together(self):
        """Test that source link validation works alongside relationship validation.

        This tests the edge case where both --validate-relationships and
        --validate-source-links are used without --validate-links.
        The validator should be created once and reused.
        """
        old_cwd = os.getcwd()
        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                os.chdir(tmpdir)

                # Create test file
                test_file = Path(tmpdir) / "service.py"
                test_file.write_text("class MyService:\n    pass")

                # Create mock elements with both relationships and source references
                element_data = {
                    "x-relationships": [
                        {
                            "target": "api-endpoint-get-user",
                            "predicate": "api:calls",
                        }
                    ],
                    "x-source-reference": {
                        "provenance": "extracted",
                        "locations": [{"file": "service.py", "symbol": "MyService"}],
                    },
                }
                api_element = MockElement("application-service-my-service", element_data)
                app_layer = MockLayer(
                    "application", {"application-service-my-service": api_element}
                )

                model = MockModel({"application": app_layer})

                registry = LinkRegistry()
                analyzer = LinkAnalyzer(registry)
                validator = LinkValidator(registry, analyzer)

                # Validate source references
                source_issues = validator.validate_source_references(model, deep_validation=True)

                # Should not have errors for valid references and existing symbols
                source_errors = [
                    issue for issue in source_issues if issue.severity == ValidationSeverity.ERROR
                ]
                assert len(source_errors) == 0

                # Symbol should be found (not a warning)
                source_warnings = [
                    issue for issue in source_issues if issue.severity == ValidationSeverity.WARNING
                ]
                symbol_warnings = [
                    w for w in source_warnings if w.issue_type == "source-symbol-not-found"
                ]
                assert len(symbol_warnings) == 0

        finally:
            os.chdir(old_cwd)
