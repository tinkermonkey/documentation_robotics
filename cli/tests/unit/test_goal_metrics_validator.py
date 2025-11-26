"""Unit tests for GoalToMetricTraceabilityValidator."""

from documentation_robotics.core.element import Element
from documentation_robotics.validators.goal_metrics import GoalToMetricTraceabilityValidator


class TestGoalToMetricTraceabilityValidator:
    """Tests for GoalToMetricTraceabilityValidator."""

    def test_validator_creation(self):
        """Test creating validator."""
        validator = GoalToMetricTraceabilityValidator()
        assert validator is not None

    def test_validate_empty_model(self, initialized_model):
        """Test validating empty model."""
        validator = GoalToMetricTraceabilityValidator()
        result = validator.validate(initialized_model)

        # Empty model with no goals should be valid with no warnings
        # (both layers exist but are empty)
        assert result.is_valid()

    def test_validate_model_without_goals(self, initialized_model):
        """Test model with APM layer but no goals."""
        # Add just a metric without any goals
        metric = Element(
            id="apm.metric.test",
            element_type="metric",
            layer="apm",
            data={
                "id": "apm.metric.test",
                "name": "Test Metric",
            },
        )
        initialized_model.add_element("apm", metric)

        validator = GoalToMetricTraceabilityValidator()
        result = validator.validate(initialized_model)

        # Should be valid - no goals to validate
        assert result.is_valid()

    def test_validate_goal_in_model(self, initialized_model):
        """Test model with a goal."""
        # Add motivation layer with goal
        goal = Element(
            id="motivation.goal.efficiency",
            element_type="goal",
            layer="motivation",
            data={
                "id": "motivation.goal.efficiency",
                "name": "Improve Efficiency",
            },
        )
        initialized_model.add_element("motivation", goal)

        validator = GoalToMetricTraceabilityValidator()
        result = validator.validate(initialized_model)

        # Should have warnings about goal lacking KPI and metrics
        assert result.is_valid()
        assert len(result.warnings) > 0

    def test_goal_without_kpi_warns(self, initialized_model):
        """Test that goal without KPI gets warning."""
        # Add goal without KPI
        goal = Element(
            id="motivation.goal.efficiency",
            element_type="goal",
            layer="motivation",
            data={
                "id": "motivation.goal.efficiency",
                "name": "Improve Efficiency",
                # No KPI defined
            },
        )
        initialized_model.add_element("motivation", goal)

        # Add empty APM layer
        metric = Element(
            id="apm.metric.dummy",
            element_type="metric",
            layer="apm",
            data={"id": "apm.metric.dummy", "name": "Dummy"},
        )
        initialized_model.add_element("apm", metric)

        validator = GoalToMetricTraceabilityValidator()
        result = validator.validate(initialized_model)

        assert result.is_valid()
        assert len(result.warnings) > 0
        assert any("lacks KPI" in w.message for w in result.warnings)

    def test_goal_with_kpi_property(self, initialized_model):
        """Test goal with KPI property."""
        # Add goal with KPI
        goal = Element(
            id="motivation.goal.efficiency",
            element_type="goal",
            layer="motivation",
            data={
                "id": "motivation.goal.efficiency",
                "name": "Improve Efficiency",
                "kpi": "Reduce processing time by 50%",
            },
        )
        initialized_model.add_element("motivation", goal)

        # Add metric measuring the goal
        metric = Element(
            id="apm.metric.processing-time",
            element_type="metric",
            layer="apm",
            data={
                "id": "apm.metric.processing-time",
                "name": "Processing Time",
                "measures-goal": "motivation.goal.efficiency",
            },
        )
        initialized_model.add_element("apm", metric)

        validator = GoalToMetricTraceabilityValidator()
        result = validator.validate(initialized_model)

        # Should not warn about missing KPI
        kpi_warnings = [
            w for w in result.warnings if "lacks KPI" in w.message and "efficiency" in w.message
        ]
        assert len(kpi_warnings) == 0

    def test_goal_with_outcome_property(self, initialized_model):
        """Test goal with outcome property."""
        goal = Element(
            id="motivation.goal.efficiency",
            element_type="goal",
            layer="motivation",
            data={
                "id": "motivation.goal.efficiency",
                "name": "Improve Efficiency",
                "outcome": "50% reduction in processing time",
            },
        )
        initialized_model.add_element("motivation", goal)

        # Add APM layer
        metric = Element(
            id="apm.metric.dummy",
            element_type="metric",
            layer="apm",
            data={"id": "apm.metric.dummy", "name": "Dummy"},
        )
        initialized_model.add_element("apm", metric)

        validator = GoalToMetricTraceabilityValidator()
        result = validator.validate(initialized_model)

        # Should not warn about missing KPI
        kpi_warnings = [
            w for w in result.warnings if "lacks KPI" in w.message and "efficiency" in w.message
        ]
        assert len(kpi_warnings) == 0

    def test_goal_without_metrics_warns(self, initialized_model):
        """Test that goal without metrics gets warning."""
        # Add goal
        goal = Element(
            id="motivation.goal.efficiency",
            element_type="goal",
            layer="motivation",
            data={
                "id": "motivation.goal.efficiency",
                "name": "Improve Efficiency",
                "kpi": "Reduce processing time",
            },
        )
        initialized_model.add_element("motivation", goal)

        # Add metric that doesn't measure this goal
        metric = Element(
            id="apm.metric.other",
            element_type="metric",
            layer="apm",
            data={
                "id": "apm.metric.other",
                "name": "Other Metric",
            },
        )
        initialized_model.add_element("apm", metric)

        validator = GoalToMetricTraceabilityValidator()
        result = validator.validate(initialized_model)

        assert result.is_valid()
        assert len(result.warnings) > 0
        assert any("not measured by any APM metrics" in w.message for w in result.warnings)

    def test_goal_with_measuring_metric(self, initialized_model):
        """Test goal with metric that measures it."""
        # Add goal
        goal = Element(
            id="motivation.goal.efficiency",
            element_type="goal",
            layer="motivation",
            data={
                "id": "motivation.goal.efficiency",
                "name": "Improve Efficiency",
                "kpi": "Reduce processing time",
            },
        )
        initialized_model.add_element("motivation", goal)

        # Add metric measuring the goal
        metric = Element(
            id="apm.metric.processing-time",
            element_type="metric",
            layer="apm",
            data={
                "id": "apm.metric.processing-time",
                "name": "Processing Time",
                "measures-goal": "motivation.goal.efficiency",
            },
        )
        initialized_model.add_element("apm", metric)

        validator = GoalToMetricTraceabilityValidator()
        result = validator.validate(initialized_model)

        # Should not warn about missing metrics for this goal
        metric_warnings = [
            w for w in result.warnings if "not measured" in w.message and "efficiency" in w.message
        ]
        assert len(metric_warnings) == 0

    def test_metric_with_nonexistent_goal_fails(self, initialized_model):
        """Test metric referencing nonexistent goal."""
        # Add goal
        goal = Element(
            id="motivation.goal.efficiency",
            element_type="goal",
            layer="motivation",
            data={
                "id": "motivation.goal.efficiency",
                "name": "Improve Efficiency",
            },
        )
        initialized_model.add_element("motivation", goal)

        # Add metric referencing wrong goal
        metric = Element(
            id="apm.metric.test",
            element_type="metric",
            layer="apm",
            data={
                "id": "apm.metric.test",
                "name": "Test Metric",
                "measures-goal": "motivation.goal.nonexistent",
            },
        )
        initialized_model.add_element("apm", metric)

        validator = GoalToMetricTraceabilityValidator()
        result = validator.validate(initialized_model)

        assert not result.is_valid()
        assert len(result.errors) > 0
        assert any("non-existent goal" in e.message for e in result.errors)

    def test_metric_referencing_non_goal_element_warns(self, initialized_model):
        """Test metric referencing non-goal motivation element."""
        # Add driver (not a goal)
        driver = Element(
            id="motivation.driver.compliance",
            element_type="driver",
            layer="motivation",
            data={
                "id": "motivation.driver.compliance",
                "name": "Compliance Driver",
            },
        )
        initialized_model.add_element("motivation", driver)

        # Add metric referencing driver instead of goal
        metric = Element(
            id="apm.metric.test",
            element_type="metric",
            layer="apm",
            data={
                "id": "apm.metric.test",
                "name": "Test Metric",
                "measures-goal": "motivation.driver.compliance",
            },
        )
        initialized_model.add_element("apm", metric)

        validator = GoalToMetricTraceabilityValidator()
        result = validator.validate(initialized_model)

        assert result.is_valid()  # Warning, not error
        assert len(result.warnings) > 0
        assert any("not a goal" in w.message for w in result.warnings)

    def test_multiple_goal_references(self, initialized_model):
        """Test metric measuring multiple goals."""
        # Add goals
        for i in [1, 2]:
            goal = Element(
                id=f"motivation.goal.goal-{i}",
                element_type="goal",
                layer="motivation",
                data={
                    "id": f"motivation.goal.goal-{i}",
                    "name": f"Goal {i}",
                    "kpi": f"KPI {i}",
                },
            )
            initialized_model.add_element("motivation", goal)

        # Add metric measuring both goals
        metric = Element(
            id="apm.metric.combined",
            element_type="metric",
            layer="apm",
            data={
                "id": "apm.metric.combined",
                "name": "Combined Metric",
                "measures-goal": [
                    "motivation.goal.goal-1",
                    "motivation.goal.goal-2",
                ],
            },
        )
        initialized_model.add_element("apm", metric)

        validator = GoalToMetricTraceabilityValidator()
        result = validator.validate(initialized_model)

        # Both goals should have metrics
        metric_warnings = [w for w in result.warnings if "not measured" in w.message]
        assert len(metric_warnings) == 0

    def test_alternative_goal_property_names(self, initialized_model):
        """Test that validator recognizes alternative property names."""
        # Add goal
        goal = Element(
            id="motivation.goal.efficiency",
            element_type="goal",
            layer="motivation",
            data={
                "id": "motivation.goal.efficiency",
                "name": "Improve Efficiency",
            },
        )
        initialized_model.add_element("motivation", goal)

        # Test various property names
        property_names = ["measuresGoal", "goalRef", "goal", "relatedGoals", "supports-goals"]

        for i, prop_name in enumerate(property_names):
            metric = Element(
                id=f"apm.metric.test-{i}",
                element_type="metric",
                layer="apm",
                data={
                    "id": f"apm.metric.test-{i}",
                    "name": f"Test Metric {i}",
                    prop_name: "motivation.goal.efficiency",
                },
            )
            initialized_model.add_element("apm", metric)

        validator = GoalToMetricTraceabilityValidator()
        result = validator.validate(initialized_model)

        # Goal should have metrics
        metric_warnings = [
            w for w in result.warnings if "not measured" in w.message and "efficiency" in w.message
        ]
        assert len(metric_warnings) == 0

    def test_kpi_alternative_properties(self, initialized_model):
        """Test that validator recognizes alternative KPI property names."""
        property_names = ["measurableOutcome", "successCriteria", "target"]

        for i, prop_name in enumerate(property_names):
            goal = Element(
                id=f"motivation.goal.goal-{i}",
                element_type="goal",
                layer="motivation",
                data={
                    "id": f"motivation.goal.goal-{i}",
                    "name": f"Goal {i}",
                    prop_name: "Some measurable outcome",
                },
            )
            initialized_model.add_element("motivation", goal)

        # Add APM layer
        metric = Element(
            id="apm.metric.dummy",
            element_type="metric",
            layer="apm",
            data={"id": "apm.metric.dummy", "name": "Dummy"},
        )
        initialized_model.add_element("apm", metric)

        validator = GoalToMetricTraceabilityValidator()
        result = validator.validate(initialized_model)

        # Should not warn about missing KPIs
        kpi_warnings = [w for w in result.warnings if "lacks KPI" in w.message]
        assert len(kpi_warnings) == 0

    def test_property_in_properties_dict(self, initialized_model):
        """Test that validator checks properties in properties dict."""
        # Add goal with KPI in properties dict
        goal = Element(
            id="motivation.goal.efficiency",
            element_type="goal",
            layer="motivation",
            data={
                "id": "motivation.goal.efficiency",
                "name": "Improve Efficiency",
                "properties": {"kpi": "Reduce processing time"},
            },
        )
        initialized_model.add_element("motivation", goal)

        # Add APM layer
        metric = Element(
            id="apm.metric.dummy",
            element_type="metric",
            layer="apm",
            data={"id": "apm.metric.dummy", "name": "Dummy"},
        )
        initialized_model.add_element("apm", metric)

        validator = GoalToMetricTraceabilityValidator()
        result = validator.validate(initialized_model)

        # Should not warn about missing KPI
        kpi_warnings = [
            w for w in result.warnings if "lacks KPI" in w.message and "efficiency" in w.message
        ]
        assert len(kpi_warnings) == 0

    def test_property_in_spec_dict(self, initialized_model):
        """Test that validator checks properties in spec dict."""
        # Add goal with KPI in spec dict
        goal = Element(
            id="motivation.goal.efficiency",
            element_type="goal",
            layer="motivation",
            data={
                "id": "motivation.goal.efficiency",
                "name": "Improve Efficiency",
                "spec": {"kpi": "Reduce processing time"},
            },
        )
        initialized_model.add_element("motivation", goal)

        # Add APM layer
        metric = Element(
            id="apm.metric.dummy",
            element_type="metric",
            layer="apm",
            data={"id": "apm.metric.dummy", "name": "Dummy"},
        )
        initialized_model.add_element("apm", metric)

        validator = GoalToMetricTraceabilityValidator()
        result = validator.validate(initialized_model)

        # Should not warn about missing KPI
        kpi_warnings = [
            w for w in result.warnings if "lacks KPI" in w.message and "efficiency" in w.message
        ]
        assert len(kpi_warnings) == 0

    def test_generate_goal_achievement_report(self, initialized_model):
        """Test generating goal achievement report."""
        # Add goals with various states
        goal1 = Element(
            id="motivation.goal.goal-1",
            element_type="goal",
            layer="motivation",
            data={
                "id": "motivation.goal.goal-1",
                "name": "Goal 1",
                "kpi": "KPI 1",
            },
        )
        initialized_model.add_element("motivation", goal1)

        goal2 = Element(
            id="motivation.goal.goal-2",
            element_type="goal",
            layer="motivation",
            data={
                "id": "motivation.goal.goal-2",
                "name": "Goal 2",
                # No KPI
            },
        )
        initialized_model.add_element("motivation", goal2)

        # Add metric for goal 1 only
        metric = Element(
            id="apm.metric.test",
            element_type="metric",
            layer="apm",
            data={
                "id": "apm.metric.test",
                "name": "Test Metric",
                "measures-goal": "motivation.goal.goal-1",
            },
        )
        initialized_model.add_element("apm", metric)

        validator = GoalToMetricTraceabilityValidator()
        report = validator.generate_goal_achievement_report(initialized_model)

        assert report["total_goals"] == 2
        assert report["goals_with_kpis"] == 1
        assert report["goals_with_metrics"] == 1
        assert report["goals_fully_measurable"] == 1
        assert "motivation.goal.goal-2" in report["unmeasured_goals"]
        assert "kpi_coverage_percentage" in report
        assert "metric_coverage_percentage" in report

    def test_suggest_metrics_for_goals(self, initialized_model):
        """Test generating metric suggestions for goals."""
        # Add goal without metrics
        goal = Element(
            id="motivation.goal.efficiency",
            element_type="goal",
            layer="motivation",
            data={
                "id": "motivation.goal.efficiency",
                "name": "Improve Efficiency",
                "description": "Increase system throughput",
            },
        )
        initialized_model.add_element("motivation", goal)

        # Add APM layer (empty)
        metric = Element(
            id="apm.metric.dummy",
            element_type="metric",
            layer="apm",
            data={"id": "apm.metric.dummy", "name": "Dummy"},
        )
        initialized_model.add_element("apm", metric)

        validator = GoalToMetricTraceabilityValidator()
        suggestions = validator.suggest_metrics_for_goals(initialized_model)

        assert len(suggestions) > 0
        assert suggestions[0]["goal_id"] == "motivation.goal.efficiency"
        assert "suggested_metric" in suggestions[0]
        assert "measures-goal" in suggestions[0]["suggested_metric"]

    def test_metric_type_counter(self, initialized_model):
        """Test metric suggestion with counter type."""
        goal = Element(
            id="motivation.goal.growth",
            element_type="goal",
            layer="motivation",
            data={
                "id": "motivation.goal.growth",
                "name": "Growth Goal",
                "description": "Increase user base",
            },
        )
        initialized_model.add_element("motivation", goal)

        # Add APM layer
        metric = Element(
            id="apm.metric.dummy",
            element_type="metric",
            layer="apm",
            data={"id": "apm.metric.dummy", "name": "Dummy"},
        )
        initialized_model.add_element("apm", metric)

        validator = GoalToMetricTraceabilityValidator()
        suggestions = validator.suggest_metrics_for_goals(initialized_model)

        # Should suggest counter type for "increase"
        assert suggestions[0]["suggested_metric"]["type"] == "counter"

    def test_metric_type_reduction(self, initialized_model):
        """Test metric suggestion with reduction keywords."""
        goal = Element(
            id="motivation.goal.efficiency",
            element_type="goal",
            layer="motivation",
            data={
                "id": "motivation.goal.efficiency",
                "name": "Efficiency Goal",
                "description": "Reduce processing time",
            },
        )
        initialized_model.add_element("motivation", goal)

        # Add APM layer
        metric = Element(
            id="apm.metric.dummy",
            element_type="metric",
            layer="apm",
            data={"id": "apm.metric.dummy", "name": "Dummy"},
        )
        initialized_model.add_element("apm", metric)

        validator = GoalToMetricTraceabilityValidator()
        suggestions = validator.suggest_metrics_for_goals(initialized_model)

        # Should suggest counter type for "reduce"
        assert suggestions[0]["suggested_metric"]["type"] == "counter"

    def test_measure_element_type(self, initialized_model):
        """Test that 'measure' element type is also validated."""
        # Add goal
        goal = Element(
            id="motivation.goal.efficiency",
            element_type="goal",
            layer="motivation",
            data={
                "id": "motivation.goal.efficiency",
                "name": "Improve Efficiency",
            },
        )
        initialized_model.add_element("motivation", goal)

        # Add measure (not metric) measuring the goal
        measure = Element(
            id="apm.measure.processing-time",
            element_type="measure",
            layer="apm",
            data={
                "id": "apm.measure.processing-time",
                "name": "Processing Time",
                "measures-goal": "motivation.goal.efficiency",
            },
        )
        initialized_model.add_element("apm", measure)

        validator = GoalToMetricTraceabilityValidator()
        result = validator.validate(initialized_model)

        # Goal should have metrics (measure counts as metric)
        metric_warnings = [
            w for w in result.warnings if "not measured" in w.message and "efficiency" in w.message
        ]
        assert len(metric_warnings) == 0

    def test_orphaned_metrics_in_report(self, initialized_model):
        """Test that report identifies orphaned metrics."""
        # Add goal
        goal = Element(
            id="motivation.goal.efficiency",
            element_type="goal",
            layer="motivation",
            data={
                "id": "motivation.goal.efficiency",
                "name": "Improve Efficiency",
            },
        )
        initialized_model.add_element("motivation", goal)

        # Add metric without goal reference
        metric = Element(
            id="apm.metric.orphan",
            element_type="metric",
            layer="apm",
            data={
                "id": "apm.metric.orphan",
                "name": "Orphan Metric",
                # No measures-goal
            },
        )
        initialized_model.add_element("apm", metric)

        validator = GoalToMetricTraceabilityValidator()
        report = validator.generate_goal_achievement_report(initialized_model)

        assert "apm.metric.orphan" in report["orphaned_metrics"]

    def test_warning_includes_suggestion(self, initialized_model):
        """Test that warnings include helpful suggestions."""
        # Add goal without metrics
        goal = Element(
            id="motivation.goal.efficiency",
            element_type="goal",
            layer="motivation",
            data={
                "id": "motivation.goal.efficiency",
                "name": "Improve Efficiency",
            },
        )
        initialized_model.add_element("motivation", goal)

        # Add APM layer
        metric = Element(
            id="apm.metric.dummy",
            element_type="metric",
            layer="apm",
            data={"id": "apm.metric.dummy", "name": "Dummy"},
        )
        initialized_model.add_element("apm", metric)

        validator = GoalToMetricTraceabilityValidator()
        result = validator.validate(initialized_model)

        assert len(result.warnings) > 0
        metric_warnings = [w for w in result.warnings if "not measured" in w.message]
        assert len(metric_warnings) > 0
        assert metric_warnings[0].fix_suggestion is not None
