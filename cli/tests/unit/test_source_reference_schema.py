"""Unit tests for SourceReference schema validation."""

from __future__ import annotations

import json
from pathlib import Path

import jsonschema
import pytest


@pytest.fixture
def source_reference_schema():
    """Load the source reference schema."""
    schema_path = (
        Path(__file__).parent.parent.parent
        / "src"
        / "documentation_robotics"
        / "schemas"
        / "bundled"
        / "common"
        / "source-references.schema.json"
    )
    with open(schema_path) as f:
        return json.load(f)


class TestSourceReferenceSchema:
    """Tests for SourceReference schema definition."""

    def test_schema_is_valid_draft7(self, source_reference_schema):
        """Schema should be valid JSON Schema draft-07."""
        # This will raise an exception if the schema is invalid
        jsonschema.Draft7Validator.check_schema(source_reference_schema)

    def test_schema_has_required_definitions(self, source_reference_schema):
        """Schema should define all required types."""
        definitions = source_reference_schema.get("definitions", {})
        assert "ProvenanceType" in definitions
        assert "SourceLocation" in definitions
        assert "RepositoryContext" in definitions
        assert "SourceReference" in definitions

    def test_provenance_type_has_four_values(self, source_reference_schema):
        """ProvenanceType should have exactly four enum values."""
        provenance = source_reference_schema["definitions"]["ProvenanceType"]
        assert provenance["type"] == "string"
        assert set(provenance["enum"]) == {
            "extracted",
            "manual",
            "inferred",
            "generated",
        }

    def test_source_location_requires_file(self, source_reference_schema):
        """SourceLocation should require file field."""
        source_location = source_reference_schema["definitions"]["SourceLocation"]
        assert "file" in source_location["required"]
        assert "symbol" not in source_location.get("required", [])

    def test_source_reference_requires_provenance_and_locations(
        self, source_reference_schema
    ):
        """SourceReference should require provenance and locations."""
        source_ref = source_reference_schema["definitions"]["SourceReference"]
        assert set(source_ref["required"]) == {"provenance", "locations"}

    def test_repository_context_all_optional(self, source_reference_schema):
        """RepositoryContext should have no required fields."""
        repository = source_reference_schema["definitions"]["RepositoryContext"]
        assert "required" not in repository or len(repository["required"]) == 0

    def test_commit_sha_pattern_validation(self, source_reference_schema):
        """Commit field should validate 40-character hex pattern."""
        repository = source_reference_schema["definitions"]["RepositoryContext"]
        commit_pattern = repository["properties"]["commit"]["pattern"]
        assert commit_pattern == "^[0-9a-f]{40}$"


class TestSourceReferenceValidation:
    """Tests for validating SourceReference instances."""

    @pytest.fixture
    def validator(self, source_reference_schema):
        """Create a validator for SourceReference."""
        # Create a schema that validates a SourceReference directly
        validation_schema = {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "definitions": source_reference_schema["definitions"],
            "$ref": "#/definitions/SourceReference",
        }
        return jsonschema.Draft7Validator(validation_schema)

    def test_valid_extracted_reference(self, validator):
        """Validate a complete extracted source reference."""
        data = {
            "provenance": "extracted",
            "locations": [
                {"file": "src/main.py", "symbol": "MyClass.my_method"}
            ],
            "repository": {
                "url": "https://github.com/example/repo",
                "commit": "a" * 40,  # Valid 40-char hex
            },
        }
        validator.validate(data)

    def test_valid_manual_reference_without_repository(self, validator):
        """Validate manual reference without repository context."""
        data = {
            "provenance": "manual",
            "locations": [{"file": "src/utils.py", "symbol": "helper_function"}],
        }
        validator.validate(data)

    def test_valid_multiple_locations(self, validator):
        """Validate reference with multiple source locations."""
        data = {
            "provenance": "inferred",
            "locations": [
                {"file": "src/a.py", "symbol": "ClassA.method"},
                {"file": "src/b.py", "symbol": "ClassB.method"},
                {"file": "src/c.py"},  # Location without symbol
            ],
        }
        validator.validate(data)

    def test_valid_generated_reference(self, validator):
        """Validate generated code reference."""
        data = {
            "provenance": "generated",
            "locations": [{"file": "generated/models.py"}],
        }
        validator.validate(data)

    def test_invalid_missing_provenance(self, validator):
        """Should reject reference without provenance."""
        data = {"locations": [{"file": "src/main.py"}]}
        with pytest.raises(jsonschema.ValidationError) as exc_info:
            validator.validate(data)
        assert "provenance" in str(exc_info.value).lower()

    def test_invalid_missing_locations(self, validator):
        """Should reject reference without locations."""
        data = {"provenance": "manual"}
        with pytest.raises(jsonschema.ValidationError) as exc_info:
            validator.validate(data)
        assert "locations" in str(exc_info.value).lower()

    def test_invalid_empty_locations(self, validator):
        """Should reject reference with empty locations array."""
        data = {"provenance": "manual", "locations": []}
        with pytest.raises(jsonschema.ValidationError):
            validator.validate(data)

    def test_invalid_provenance_type(self, validator):
        """Should reject invalid provenance value."""
        data = {
            "provenance": "unknown",
            "locations": [{"file": "src/main.py"}],
        }
        with pytest.raises(jsonschema.ValidationError) as exc_info:
            validator.validate(data)
        assert "provenance" in str(exc_info.value).lower()

    def test_invalid_location_missing_file(self, validator):
        """Should reject location without file field."""
        data = {
            "provenance": "manual",
            "locations": [{"symbol": "MyClass.method"}],
        }
        with pytest.raises(jsonschema.ValidationError) as exc_info:
            validator.validate(data)
        assert "file" in str(exc_info.value).lower()

    def test_invalid_commit_sha_too_short(self, validator):
        """Should reject commit SHA that's too short."""
        data = {
            "provenance": "extracted",
            "locations": [{"file": "src/main.py"}],
            "repository": {
                "url": "https://github.com/example/repo",
                "commit": "abc123",  # Only 6 chars
            },
        }
        with pytest.raises(jsonschema.ValidationError):
            validator.validate(data)

    def test_invalid_commit_sha_wrong_format(self, validator):
        """Should reject commit SHA with invalid characters."""
        data = {
            "provenance": "extracted",
            "locations": [{"file": "src/main.py"}],
            "repository": {
                "url": "https://github.com/example/repo",
                "commit": "g" * 40,  # 'g' is not hex
            },
        }
        with pytest.raises(jsonschema.ValidationError):
            validator.validate(data)

    def test_repository_url_accepts_various_formats(self, validator):
        """Repository URL should accept HTTPS and SSH formats.

        Note: The schema specifies format: "uri" which is advisory.
        JSON Schema format validation is optional and implementations
        may vary. This test verifies that valid Git remote URLs are accepted.
        """
        # Test HTTPS URL
        data_https = {
            "provenance": "extracted",
            "locations": [{"file": "src/main.py"}],
            "repository": {
                "url": "https://github.com/user/repo.git",
                "commit": "a" * 40,
            },
        }
        validator.validate(data_https)

        # Test SSH URL
        data_ssh = {
            "provenance": "extracted",
            "locations": [{"file": "src/main.py"}],
            "repository": {
                "url": "git@github.com:user/repo.git",
                "commit": "a" * 40,
            },
        }
        validator.validate(data_ssh)


class TestProvenanceSemantics:
    """Document and test provenance type semantics."""

    def test_extracted_provenance_semantics(self):
        """Document expected behavior for extracted provenance.

        Extracted provenance indicates the reference was created by
        automated ingestion (e.g., /dr-ingest command). These references
        may be regenerated on re-ingest.
        """
        provenance = "extracted"
        assert provenance in ["extracted", "manual", "inferred", "generated"]

    def test_manual_provenance_semantics(self):
        """Document expected behavior for manual provenance.

        Manual provenance indicates the reference was explicitly added
        by a user. These references should be preserved during re-ingest.
        """
        provenance = "manual"
        assert provenance in ["extracted", "manual", "inferred", "generated"]

    def test_inferred_provenance_semantics(self):
        """Document expected behavior for inferred provenance.

        Inferred provenance indicates the reference was created by
        pattern matching or naming conventions. These references may
        be regenerated.
        """
        provenance = "inferred"
        assert provenance in ["extracted", "manual", "inferred", "generated"]

    def test_generated_provenance_semantics(self):
        """Document expected behavior for generated provenance.

        Generated provenance indicates code was generated from the model.
        This provides reverse traceability from code to model.
        """
        provenance = "generated"
        assert provenance in ["extracted", "manual", "inferred", "generated"]


class TestSymbolFormatExamples:
    """Document symbol format conventions by language."""

    def test_python_symbol_formats(self):
        """Document Python symbol format examples."""
        examples = [
            "ClassName.method_name",
            "function_name",
            "ModuleName.ClassName.method_name",
        ]
        for symbol in examples:
            assert isinstance(symbol, str)
            assert len(symbol) > 0

    def test_typescript_symbol_formats(self):
        """Document TypeScript symbol format examples."""
        examples = [
            "ClassName.methodName",
            "functionName",
            "InterfaceName.propertyName",
        ]
        for symbol in examples:
            assert isinstance(symbol, str)
            assert len(symbol) > 0

    def test_java_symbol_formats(self):
        """Document Java symbol format examples."""
        examples = [
            "ClassName.methodName",
            "InterfaceName.methodName",
        ]
        for symbol in examples:
            assert isinstance(symbol, str)
            assert len(symbol) > 0

    def test_go_symbol_formats(self):
        """Document Go symbol format examples."""
        examples = [
            "packageName.FunctionName",
            "packageName.StructName.MethodName",
        ]
        for symbol in examples:
            assert isinstance(symbol, str)
            assert len(symbol) > 0
