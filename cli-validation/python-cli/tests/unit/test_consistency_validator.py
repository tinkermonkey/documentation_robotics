"""Unit tests for BidirectionalConsistencyValidator."""

from documentation_robotics.core.element import Element
from documentation_robotics.validators.consistency import BidirectionalConsistencyValidator


class TestBidirectionalConsistencyValidator:
    """Tests for BidirectionalConsistencyValidator."""

    def test_validator_creation(self):
        """Test creating validator."""
        validator = BidirectionalConsistencyValidator()
        assert validator is not None

    def test_validate_empty_model(self, initialized_model):
        """Test validating empty model."""
        validator = BidirectionalConsistencyValidator()
        result = validator.validate(initialized_model)

        assert result.is_valid()
        assert len(result.warnings) == 0

    def test_consistent_realizes_relationship(self, initialized_model):
        """Test consistent realizes/realizedBy relationship."""
        # Add business service with realizedBy
        biz_service = Element(
            id="business.service.biz-service",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.biz-service",
                "name": "Business Service",
                "realizedBy": "application.service.app-service",
            },
        )
        initialized_model.add_element("business", biz_service)

        # Add application service that realizes business service
        app_service = Element(
            id="application.service.app-service",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.app-service",
                "name": "App Service",
                "realizes": "business.service.biz-service",
            },
        )
        initialized_model.add_element("application", app_service)

        validator = BidirectionalConsistencyValidator()
        result = validator.validate(initialized_model)

        # Should have no warnings - relationship is consistent
        realizes_warnings = [w for w in result.warnings if "realization" in w.message]
        assert len(realizes_warnings) == 0

    def test_inconsistent_realizes_missing_backward(self, initialized_model):
        """Test inconsistent realizes relationship - missing backward reference."""
        # Add business service WITHOUT realizedBy
        biz_service = Element(
            id="business.service.biz-service",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.biz-service",
                "name": "Business Service",
                # Missing realizedBy
            },
        )
        initialized_model.add_element("business", biz_service)

        # Add application service that realizes business service
        app_service = Element(
            id="application.service.app-service",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.app-service",
                "name": "App Service",
                "realizes": "business.service.biz-service",
            },
        )
        initialized_model.add_element("application", app_service)

        validator = BidirectionalConsistencyValidator()
        result = validator.validate(initialized_model)

        # Should warn about incomplete relationship
        assert result.is_valid()  # Warnings, not errors
        assert len(result.warnings) > 0
        assert any(
            "Incomplete" in w.message and "realization" in w.message for w in result.warnings
        )

    def test_inconsistent_realizes_missing_forward(self, initialized_model):
        """Test inconsistent realizes relationship - missing forward reference."""
        # Add business service with realizedBy
        biz_service = Element(
            id="business.service.biz-service",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.biz-service",
                "name": "Business Service",
                "realizedBy": "application.service.app-service",
            },
        )
        initialized_model.add_element("business", biz_service)

        # Add application service WITHOUT realizes
        app_service = Element(
            id="application.service.app-service",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.app-service",
                "name": "App Service",
                # Missing realizes
            },
        )
        initialized_model.add_element("application", app_service)

        validator = BidirectionalConsistencyValidator()
        result = validator.validate(initialized_model)

        # Should warn about incomplete relationship
        assert result.is_valid()
        assert len(result.warnings) > 0
        assert any("Incomplete" in w.message for w in result.warnings)

    def test_inconsistent_realizes_wrong_backward(self, initialized_model):
        """Test inconsistent realizes - backward reference missing source."""
        # Add business service with realizedBy but missing one element
        biz_service = Element(
            id="business.service.biz-service",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.biz-service",
                "name": "Business Service",
                "realizedBy": ["application.service.other-service"],  # Wrong one
            },
        )
        initialized_model.add_element("business", biz_service)

        # Add application service that realizes business service
        app_service = Element(
            id="application.service.app-service",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.app-service",
                "name": "App Service",
                "realizes": "business.service.biz-service",
            },
        )
        initialized_model.add_element("application", app_service)

        validator = BidirectionalConsistencyValidator()
        result = validator.validate(initialized_model)

        # Should warn about inconsistent relationship
        assert result.is_valid()
        assert len(result.warnings) > 0
        assert any("Inconsistent" in w.message for w in result.warnings)

    def test_multiple_realizes_relationships(self, initialized_model):
        """Test multiple realizes relationships."""
        # Add business service
        biz_service = Element(
            id="business.service.biz-service",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.biz-service",
                "name": "Business Service",
                "realizedBy": [
                    "application.service.app-service-1",
                    "application.service.app-service-2",
                ],
            },
        )
        initialized_model.add_element("business", biz_service)

        # Add multiple application services
        for i in [1, 2]:
            app_service = Element(
                id=f"application.service.app-service-{i}",
                element_type="service",
                layer="application",
                data={
                    "id": f"application.service.app-service-{i}",
                    "name": f"App Service {i}",
                    "realizes": "business.service.biz-service",
                },
            )
            initialized_model.add_element("application", app_service)

        validator = BidirectionalConsistencyValidator()
        result = validator.validate(initialized_model)

        # Should have no warnings - all relationships are consistent
        realizes_warnings = [w for w in result.warnings if "biz-service" in w.message]
        assert len(realizes_warnings) == 0

    def test_serves_relationship(self, initialized_model):
        """Test serves/servedBy relationship."""
        # Add service
        service = Element(
            id="application.service.api-service",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.api-service",
                "name": "API Service",
                "serves": "ux.screen.dashboard",
            },
        )
        initialized_model.add_element("application", service)

        # Add screen with servedBy
        screen = Element(
            id="ux.screen.dashboard",
            element_type="screen",
            layer="ux",
            data={
                "id": "ux.screen.dashboard",
                "name": "Dashboard",
                "servedBy": "application.service.api-service",
            },
        )
        initialized_model.add_element("ux", screen)

        validator = BidirectionalConsistencyValidator()
        result = validator.validate(initialized_model)

        # Should have no warnings about serves relationship
        serves_warnings = [w for w in result.warnings if "serving" in w.message]
        assert len(serves_warnings) == 0

    def test_accesses_relationship(self, initialized_model):
        """Test accesses/accessedBy relationship."""
        # Add service that accesses datastore
        service = Element(
            id="application.service.data-service",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.data-service",
                "name": "Data Service",
                "accesses": "datastore.database.user-db",
            },
        )
        initialized_model.add_element("application", service)

        # Add datastore with accessedBy
        db = Element(
            id="datastore.database.user-db",
            element_type="database",
            layer="datastore",
            data={
                "id": "datastore.database.user-db",
                "name": "User DB",
                "accessedBy": "application.service.data-service",
            },
        )
        initialized_model.add_element("datastore", db)

        validator = BidirectionalConsistencyValidator()
        result = validator.validate(initialized_model)

        # Should have no warnings about access relationship
        access_warnings = [w for w in result.warnings if "access" in w.message]
        assert len(access_warnings) == 0

    def test_uses_relationship(self, initialized_model):
        """Test uses/usedBy relationship."""
        # Add service that uses another service
        consumer = Element(
            id="application.service.consumer",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.consumer",
                "name": "Consumer",
                "uses": "application.service.provider",
            },
        )
        initialized_model.add_element("application", consumer)

        # Add provider with usedBy
        provider = Element(
            id="application.service.provider",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.provider",
                "name": "Provider",
                "usedBy": "application.service.consumer",
            },
        )
        initialized_model.add_element("application", provider)

        validator = BidirectionalConsistencyValidator()
        result = validator.validate(initialized_model)

        # Should have no warnings about usage relationship
        usage_warnings = [w for w in result.warnings if "usage" in w.message]
        assert len(usage_warnings) == 0

    def test_composed_of_relationship(self, initialized_model):
        """Test composedOf/partOf relationship."""
        # Add composite service
        composite = Element(
            id="application.service.composite",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.composite",
                "name": "Composite",
                "composedOf": ["application.service.part-1", "application.service.part-2"],
            },
        )
        initialized_model.add_element("application", composite)

        # Add parts with partOf
        for i in [1, 2]:
            part = Element(
                id=f"application.service.part-{i}",
                element_type="service",
                layer="application",
                data={
                    "id": f"application.service.part-{i}",
                    "name": f"Part {i}",
                    "partOf": "application.service.composite",
                },
            )
            initialized_model.add_element("application", part)

        validator = BidirectionalConsistencyValidator()
        result = validator.validate(initialized_model)

        # Should have no warnings about composition relationship
        composition_warnings = [w for w in result.warnings if "composition" in w.message]
        assert len(composition_warnings) == 0

    def test_property_in_spec_dict(self, initialized_model):
        """Test that validator checks properties in spec dict."""
        # Add element with realizes in spec dict
        app_service = Element(
            id="application.service.app-service",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.app-service",
                "name": "App Service",
                "spec": {"realizes": "business.service.biz-service"},
            },
        )
        initialized_model.add_element("application", app_service)

        # Add business service without realizedBy
        biz_service = Element(
            id="business.service.biz-service",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.biz-service",
                "name": "Business Service",
            },
        )
        initialized_model.add_element("business", biz_service)

        validator = BidirectionalConsistencyValidator()
        result = validator.validate(initialized_model)

        # Should warn about missing backward reference
        assert len(result.warnings) > 0

    def test_property_in_properties_dict(self, initialized_model):
        """Test that validator checks properties in properties dict."""
        # Add element with realizes in properties dict
        app_service = Element(
            id="application.service.app-service",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.app-service",
                "name": "App Service",
                "properties": {"realizes": "business.service.biz-service"},
            },
        )
        initialized_model.add_element("application", app_service)

        # Add business service without realizedBy
        biz_service = Element(
            id="business.service.biz-service",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.biz-service",
                "name": "Business Service",
            },
        )
        initialized_model.add_element("business", biz_service)

        validator = BidirectionalConsistencyValidator()
        result = validator.validate(initialized_model)

        # Should warn about missing backward reference
        assert len(result.warnings) > 0

    def test_generate_consistency_report(self, initialized_model):
        """Test generating consistency report."""
        # Add some consistent and inconsistent relationships
        biz_service = Element(
            id="business.service.biz-service",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.biz-service",
                "name": "Business Service",
                # Missing realizedBy - inconsistent
            },
        )
        initialized_model.add_element("business", biz_service)

        app_service = Element(
            id="application.service.app-service",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.app-service",
                "name": "App Service",
                "realizes": "business.service.biz-service",
            },
        )
        initialized_model.add_element("application", app_service)

        validator = BidirectionalConsistencyValidator()
        report = validator.generate_consistency_report(initialized_model)

        assert "total_relationships" in report
        assert "consistent_relationships" in report
        assert "inconsistent_relationships" in report
        assert "incomplete_relationships" in report
        assert "consistency_percentage" in report
        assert report["total_relationships"] > 0

    def test_auto_fix_dry_run(self, initialized_model):
        """Test auto-fix in dry-run mode."""
        # Add inconsistent relationship
        biz_service = Element(
            id="business.service.biz-service",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.biz-service",
                "name": "Business Service",
            },
        )
        initialized_model.add_element("business", biz_service)

        app_service = Element(
            id="application.service.app-service",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.app-service",
                "name": "App Service",
                "realizes": "business.service.biz-service",
            },
        )
        initialized_model.add_element("application", app_service)

        validator = BidirectionalConsistencyValidator()
        stats = validator.auto_fix_inconsistencies(initialized_model, dry_run=True)

        assert "fixes_applied" in stats
        assert "fixes_skipped" in stats
        assert "errors" in stats

    def test_normalize_to_list_with_string(self):
        """Test normalizing string to list."""
        validator = BidirectionalConsistencyValidator()
        result = validator._normalize_to_list("single-value")
        assert result == ["single-value"]

    def test_normalize_to_list_with_list(self):
        """Test normalizing list to list."""
        validator = BidirectionalConsistencyValidator()
        result = validator._normalize_to_list(["value1", "value2"])
        assert result == ["value1", "value2"]

    def test_normalize_to_list_with_other(self):
        """Test normalizing other types to empty list."""
        validator = BidirectionalConsistencyValidator()
        result = validator._normalize_to_list(123)
        assert result == []

    def test_get_layer_from_id(self):
        """Test extracting layer from element ID."""
        validator = BidirectionalConsistencyValidator()
        layer = validator._get_layer_from_id("business.service.test-service")
        assert layer == "business"

    def test_get_layer_from_invalid_id(self):
        """Test extracting layer from invalid ID."""
        validator = BidirectionalConsistencyValidator()
        layer = validator._get_layer_from_id("invalid")
        assert layer == "invalid"

    def test_warning_includes_suggestion(self, initialized_model):
        """Test that warnings include helpful suggestions."""
        # Add inconsistent relationship
        biz_service = Element(
            id="business.service.biz-service",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.biz-service",
                "name": "Business Service",
            },
        )
        initialized_model.add_element("business", biz_service)

        app_service = Element(
            id="application.service.app-service",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.app-service",
                "name": "App Service",
                "realizes": "business.service.biz-service",
            },
        )
        initialized_model.add_element("application", app_service)

        validator = BidirectionalConsistencyValidator()
        result = validator.validate(initialized_model)

        assert len(result.warnings) > 0
        assert result.warnings[0].fix_suggestion is not None
        assert "Add" in result.warnings[0].fix_suggestion
