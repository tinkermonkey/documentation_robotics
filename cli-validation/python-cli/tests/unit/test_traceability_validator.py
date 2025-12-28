"""Unit tests for UpwardTraceabilityValidator."""

from documentation_robotics.core.element import Element
from documentation_robotics.validators.traceability import UpwardTraceabilityValidator


class TestUpwardTraceabilityValidator:
    """Tests for UpwardTraceabilityValidator."""

    def test_validator_creation(self):
        """Test creating validator."""
        validator = UpwardTraceabilityValidator()
        assert validator is not None

    def test_validate_empty_model(self, initialized_model):
        """Test validating empty model."""
        validator = UpwardTraceabilityValidator()
        result = validator.validate(initialized_model)

        assert result.is_valid()
        assert len(result.errors) == 0

    def test_application_service_without_realizes_fails(self, initialized_model):
        """Test that application service without 'realizes' reference fails."""
        # Add application service without 'realizes' reference
        service = Element(
            id="application.service.test",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.test",
                "name": "Test Service",
                # Missing 'realizes' - should be error
            },
        )
        initialized_model.add_element("application", service)

        validator = UpwardTraceabilityValidator()
        result = validator.validate(initialized_model)

        assert not result.is_valid()
        assert len(result.errors) >= 1
        assert any("realizes" in err.message for err in result.errors)
        assert any("business.service" in err.message for err in result.errors)

    def test_application_service_with_realizes_passes(self, initialized_model):
        """Test that application service with 'realizes' reference passes."""
        # Add business service first
        biz_service = Element(
            id="business.service.customer",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.customer",
                "name": "Customer Service",
            },
        )
        initialized_model.add_element("business", biz_service)

        # Add application service that realizes it
        app_service = Element(
            id="application.service.customer-api",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.customer-api",
                "name": "Customer API",
                "realizes": "business.service.customer",
            },
        )
        initialized_model.add_element("application", app_service)

        validator = UpwardTraceabilityValidator()
        result = validator.validate(initialized_model)

        # Should pass the must_reference check (no errors about realizes)
        # May have warnings about should_reference (supports-goals)
        realizes_errors = [e for e in result.errors if "realizes" in e.message]
        assert len(realizes_errors) == 0

    def test_business_process_without_traceability_warns(self, initialized_model):
        """Test that business process without motivation refs gets warning."""
        process = Element(
            id="business.process.onboarding",
            element_type="process",
            layer="business",
            data={
                "id": "business.process.onboarding",
                "name": "Customer Onboarding",
                # No supports-goals or fulfills-requirements
            },
        )
        initialized_model.add_element("business", process)

        validator = UpwardTraceabilityValidator()
        result = validator.validate(initialized_model)

        # Should be valid (warnings only) but have warnings
        assert result.is_valid()
        assert len(result.warnings) > 0
        assert any(
            "supports-goals" in w.message or "fulfills-requirements" in w.message
            for w in result.warnings
        )

    def test_api_operation_without_service_ref_fails(self, initialized_model):
        """Test that API operation without service reference fails."""
        operation = Element(
            id="api.operation.get-user",
            element_type="operation",
            layer="api",
            data={
                "id": "api.operation.get-user",
                "name": "Get User",
                # Missing applicationServiceRef
            },
        )
        initialized_model.add_element("api", operation)

        validator = UpwardTraceabilityValidator()
        result = validator.validate(initialized_model)

        assert not result.is_valid()
        assert len(result.errors) >= 1
        assert any("applicationServiceRef" in err.message for err in result.errors)

    def test_ux_screen_without_api_warns(self, initialized_model):
        """Test that UX screen without API reference gets warning."""
        screen = Element(
            id="ux.screen.dashboard",
            element_type="screen",
            layer="ux",
            data={
                "id": "ux.screen.dashboard",
                "name": "Dashboard",
                # No uses-api reference
            },
        )
        initialized_model.add_element("ux", screen)

        validator = UpwardTraceabilityValidator()
        result = validator.validate(initialized_model)

        assert result.is_valid()  # Warning, not error
        assert len(result.warnings) > 0
        assert any("uses-api" in w.message for w in result.warnings)

    def test_datastore_table_without_implements_warns(self, initialized_model):
        """Test that datastore table without schema reference warns."""
        table = Element(
            id="datastore.table.users",
            element_type="table",
            layer="datastore",
            data={
                "id": "datastore.table.users",
                "name": "users",
                # No implements reference
            },
        )
        initialized_model.add_element("datastore", table)

        validator = UpwardTraceabilityValidator()
        result = validator.validate(initialized_model)

        assert result.is_valid()
        assert len(result.warnings) > 0
        assert any("implements" in w.message for w in result.warnings)

    def test_element_with_nested_property_reference(self, initialized_model):
        """Test that validator finds references in nested 'properties' dict."""
        # Add motivation goal
        goal = Element(
            id="motivation.goal.improve-ux",
            element_type="goal",
            layer="motivation",
            data={
                "id": "motivation.goal.improve-ux",
                "name": "Improve UX",
            },
        )
        initialized_model.add_element("motivation", goal)

        # Add service with nested properties
        service = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.test",
                "name": "Test",
                "properties": {
                    "supports-goals": "motivation.goal.improve-ux",
                },
            },
        )
        initialized_model.add_element("business", service)

        validator = UpwardTraceabilityValidator()
        result = validator.validate(initialized_model)

        # Should not warn about missing supports-goals
        goal_warnings = [
            w
            for w in result.warnings
            if "supports-goals" in w.message and "test" in w.message.lower()
        ]
        assert len(goal_warnings) == 0

    def test_element_with_spec_property_reference(self, initialized_model):
        """Test that validator finds references in nested 'spec' dict."""
        service = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.test",
                "name": "Test",
                "spec": {
                    "supports-goals": "motivation.goal.test",
                },
            },
        )
        initialized_model.add_element("business", service)

        validator = UpwardTraceabilityValidator()
        result = validator.validate(initialized_model)

        # Should not warn about missing supports-goals
        goal_warnings = [
            w
            for w in result.warnings
            if "supports-goals" in w.message and "test" in w.message.lower()
        ]
        assert len(goal_warnings) == 0

    def test_validate_traceability_path_to_motivation(self, initialized_model):
        """Test tracing path from implementation to motivation."""
        # Create traceability chain
        goal = Element(
            id="motivation.goal.efficiency",
            element_type="goal",
            layer="motivation",
            data={"id": "motivation.goal.efficiency", "name": "Improve Efficiency"},
        )
        initialized_model.add_element("motivation", goal)

        biz_service = Element(
            id="business.service.automation",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.automation",
                "name": "Automation Service",
                "supports-goals": "motivation.goal.efficiency",
            },
        )
        initialized_model.add_element("business", biz_service)

        app_service = Element(
            id="application.service.automation-api",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.automation-api",
                "name": "Automation API",
                "realizes": "business.service.automation",
            },
        )
        initialized_model.add_element("application", app_service)

        validator = UpwardTraceabilityValidator()
        is_traceable, path = validator.validate_traceability_path(
            "application.service.automation-api", initialized_model
        )

        assert is_traceable
        assert "application.service.automation-api" in path
        assert "business.service.automation" in path
        assert "motivation.goal.efficiency" in path

    def test_validate_traceability_path_broken_chain(self, initialized_model):
        """Test tracing path with broken chain."""
        # Add service without upward reference
        service = Element(
            id="application.service.orphan",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.orphan",
                "name": "Orphan Service",
                # No realizes reference
            },
        )
        initialized_model.add_element("application", service)

        validator = UpwardTraceabilityValidator()
        is_traceable, path = validator.validate_traceability_path(
            "application.service.orphan", initialized_model
        )

        assert not is_traceable

    def test_validate_traceability_path_circular_reference(self, initialized_model):
        """Test handling of circular references."""
        # Create circular reference (shouldn't happen but test it)
        service1 = Element(
            id="business.service.service1",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.service1",
                "name": "Service 1",
                "realizes": "business.service.service2",
            },
        )
        service2 = Element(
            id="business.service.service2",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.service2",
                "name": "Service 2",
                "realizes": "business.service.service1",
            },
        )
        initialized_model.add_element("business", service1)
        initialized_model.add_element("business", service2)

        validator = UpwardTraceabilityValidator()
        is_traceable, path = validator.validate_traceability_path(
            "business.service.service1", initialized_model
        )

        # Should detect circular reference and return False
        assert not is_traceable

    def test_generate_traceability_report(self, initialized_model):
        """Test generating traceability report."""
        # Add goal
        goal = Element(
            id="motivation.goal.test",
            element_type="goal",
            layer="motivation",
            data={"id": "motivation.goal.test", "name": "Test Goal"},
        )
        initialized_model.add_element("motivation", goal)

        # Add traceable service
        traceable = Element(
            id="business.service.traceable",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.traceable",
                "name": "Traceable",
                "supports-goals": "motivation.goal.test",
            },
        )
        initialized_model.add_element("business", traceable)

        # Add orphaned service
        orphan = Element(
            id="business.service.orphan",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.orphan",
                "name": "Orphan",
            },
        )
        initialized_model.add_element("business", orphan)

        validator = UpwardTraceabilityValidator()
        report = validator.generate_traceability_report(initialized_model)

        assert "total_elements" in report
        assert "traceable_elements" in report
        assert "untraceable_elements" in report
        assert "orphaned_elements" in report
        assert "traceability_percentage" in report

        assert report["total_elements"] == 2
        assert report["traceable_elements"] == 1
        assert len(report["untraceable_elements"]) == 1
        assert "business.service.orphan" in report["orphaned_elements"]

    def test_find_upward_references_with_list(self, initialized_model):
        """Test finding upward references when property is a list."""
        service = Element(
            id="business.service.multi",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.multi",
                "name": "Multi Goal Service",
                "supports-goals": [
                    "motivation.goal.goal1",
                    "motivation.goal.goal2",
                ],
            },
        )
        initialized_model.add_element("business", service)

        validator = UpwardTraceabilityValidator()
        refs = validator._find_upward_references(service)

        assert len(refs) == 2
        assert "motivation.goal.goal1" in refs
        assert "motivation.goal.goal2" in refs

    def test_multiple_elements_validation(self, initialized_model):
        """Test validating multiple elements at once."""
        # Add several elements with missing traceability
        for i in range(3):
            service = Element(
                id=f"application.service.service{i}",
                element_type="service",
                layer="application",
                data={
                    "id": f"application.service.service{i}",
                    "name": f"Service {i}",
                    # Missing realizes
                },
            )
            initialized_model.add_element("application", service)

        validator = UpwardTraceabilityValidator()
        result = validator.validate(initialized_model)

        assert not result.is_valid()
        # Should have at least 3 errors (one per service)
        assert len(result.errors) >= 3

    def test_apm_trace_without_instruments_warns(self, initialized_model):
        """Test that APM trace without instruments reference warns."""
        trace = Element(
            id="apm.trace.user-login",
            element_type="trace",
            layer="apm",
            data={
                "id": "apm.trace.user-login",
                "name": "User Login Trace",
                # No instruments reference
            },
        )
        initialized_model.add_element("apm", trace)

        validator = UpwardTraceabilityValidator()
        result = validator.validate(initialized_model)

        assert result.is_valid()
        assert len(result.warnings) > 0
        assert any("instruments" in w.message for w in result.warnings)

    def test_apm_metric_without_measures_goal_warns(self, initialized_model):
        """Test that APM metric without goal reference warns."""
        metric = Element(
            id="apm.metric.response-time",
            element_type="metric",
            layer="apm",
            data={
                "id": "apm.metric.response-time",
                "name": "Response Time",
                # No measures-goal reference
            },
        )
        initialized_model.add_element("apm", metric)

        validator = UpwardTraceabilityValidator()
        result = validator.validate(initialized_model)

        assert result.is_valid()
        assert len(result.warnings) > 0
        assert any("measures-goal" in w.message for w in result.warnings)

    def test_traceability_rules_coverage(self):
        """Test that traceability rules are defined correctly."""
        validator = UpwardTraceabilityValidator()
        rules = validator.TRACEABILITY_RULES

        # Verify some key rules exist
        assert "business.process" in rules
        assert "business.service" in rules
        assert "application.service" in rules
        assert "api.operation" in rules
        assert "ux.screen" in rules
        assert "datastore.table" in rules
        assert "apm.trace" in rules
        assert "apm.metric" in rules

        # Verify must_reference vs should_reference
        assert "must_reference" in rules["application.service"]
        assert "should_reference" in rules["business.service"]

    def test_error_includes_suggestion(self, initialized_model):
        """Test that validation errors include helpful suggestions."""
        service = Element(
            id="application.service.test",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.test",
                "name": "Test",
            },
        )
        initialized_model.add_element("application", service)

        validator = UpwardTraceabilityValidator()
        result = validator.validate(initialized_model)

        assert not result.is_valid()
        # Check that error has a suggestion
        assert len(result.errors) > 0
        assert result.errors[0].fix_suggestion is not None
        assert "realizes" in result.errors[0].fix_suggestion
