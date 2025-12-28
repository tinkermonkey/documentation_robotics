"""
Goal-to-Metric traceability validation.

This validator ensures that strategic goals from the Motivation layer (Layer 01)
are measurable through APM metrics in the Observability layer (Layer 11).

Spec Requirement: Goals should have measurable outcomes, and those outcomes
should be tracked by APM metrics to enable goal achievement measurement.
"""

import logging
from typing import Dict, List

from ..core.element import Element
from ..core.layer import Layer
from ..core.model import Model
from .base import BaseValidator, ValidationError, ValidationResult, ValidationWarning

logger = logging.getLogger(__name__)


class GoalToMetricTraceabilityValidator(BaseValidator):
    """
    Validates traceability from goals to metrics.

    Ensures that:
    1. Goals have measurable outcomes or KPIs
    2. APM metrics exist to measure those outcomes
    3. Metrics reference the goals they measure
    4. Complete traceability chain exists
    """

    def validate(self, model: Model) -> ValidationResult:
        """
        Validate goal-to-metric traceability.

        Args:
            model: The model to validate

        Returns:
            ValidationResult with errors and warnings
        """
        result = ValidationResult()

        # Check if motivation and APM layers exist
        if "motivation" not in model.list_layers():
            result.add_warning(
                ValidationWarning(
                    message="No motivation layer found. Cannot validate goal-to-metric traceability.",
                    element_id=None,
                    layer="motivation",
                )
            )
            return result

        if "apm" not in model.list_layers():
            result.add_warning(
                ValidationWarning(
                    message="No APM layer found. Cannot validate goal-to-metric traceability.",
                    element_id=None,
                    layer="apm",
                )
            )
            return result

        # Get layers
        motivation_layer = model.get_layer("motivation")
        apm_layer = model.get_layer("apm")

        # Build index of metrics and what they measure
        metric_to_goal = self._build_metric_index(apm_layer)

        # Validate each goal
        for element in motivation_layer.list_elements():
            if element.type == "goal":
                self._validate_goal(element, metric_to_goal, model, result)

        # Validate each metric references valid goals
        for element in apm_layer.list_elements():
            if element.type in ["metric", "measure"]:
                self._validate_metric(element, motivation_layer, result)

        return result

    def _build_metric_index(self, apm_layer: Layer) -> Dict[str, List[str]]:
        """
        Build index of metrics to goals they measure.

        Args:
            apm_layer: The APM layer

        Returns:
            Dictionary mapping metric IDs to goal IDs
        """
        metric_index = {}

        for element in apm_layer.list_elements():
            if element.type in ["metric", "measure"]:
                # Check for goal references
                goal_refs = self._get_goal_references(element)
                if goal_refs:
                    metric_index[element.id] = goal_refs

        return metric_index

    def _get_goal_references(self, element: Element) -> List[str]:
        """
        Extract goal references from a metric element.

        Args:
            element: The metric element

        Returns:
            List of goal IDs
        """
        refs = []

        # Check various property names
        goal_props = [
            "measures-goal",
            "measuresGoal",
            "goalRef",
            "goal",
            "relatedGoals",
            "supports-goals",
        ]

        for prop in goal_props:
            value = self._get_property(element, prop)
            if value:
                if isinstance(value, str):
                    refs.append(value)
                elif isinstance(value, list):
                    refs.extend([v for v in value if isinstance(v, str)])

        return refs

    def _validate_goal(
        self,
        goal: Element,
        metric_to_goal: Dict[str, List[str]],
        model: Model,
        result: ValidationResult,
    ) -> None:
        """
        Validate that a goal has associated metrics.

        Args:
            goal: The goal element
            metric_to_goal: Index of metrics to goals
            model: The model
            result: ValidationResult to add issues to
        """
        # Check if goal has KPI or outcome defined
        has_kpi = self._has_kpi_definition(goal)

        if not has_kpi:
            result.add_warning(
                ValidationWarning(
                    message=(
                        f"Goal '{goal.id}' lacks KPI or outcome definition. "
                        "Goals should have measurable outcomes."
                    ),
                    element_id=goal.id,
                    layer="motivation",
                    property_path="kpi",
                    suggestion="Add 'kpi', 'outcome', or 'measurableOutcome' property to define how this goal is measured",
                )
            )

        # Check if any metrics measure this goal
        measuring_metrics = []
        for metric_id, goal_ids in metric_to_goal.items():
            if goal.id in goal_ids:
                measuring_metrics.append(metric_id)

        if not measuring_metrics:
            result.add_warning(
                ValidationWarning(
                    message=(
                        f"Goal '{goal.id}' is not measured by any APM metrics. "
                        "Consider adding metrics to track goal achievement."
                    ),
                    element_id=goal.id,
                    layer="motivation",
                    suggestion=f"Create APM metric with 'measures-goal' property referencing '{goal.id}'",
                )
            )

    def _validate_metric(
        self, metric: Element, motivation_layer: Layer, result: ValidationResult
    ) -> None:
        """
        Validate that a metric references valid goals.

        Args:
            metric: The metric element
            motivation_layer: The motivation layer
            result: ValidationResult to add issues to
        """
        goal_refs = self._get_goal_references(metric)

        if not goal_refs:
            # Metrics don't necessarily need to measure goals
            # (some measure technical metrics), so this is just info
            return

        # Verify each referenced goal exists
        motivation_elements = {e.id: e for e in motivation_layer.list_elements()}

        for goal_ref in goal_refs:
            if goal_ref not in motivation_elements:
                result.add_error(
                    ValidationError(
                        message=(f"Metric '{metric.id}' references non-existent goal: {goal_ref}"),
                        element_id=metric.id,
                        layer="apm",
                        property_path="measures-goal",
                        suggestion=f"Ensure goal '{goal_ref}' exists in motivation layer or remove the reference",
                    )
                )
            else:
                # Verify it's actually a goal
                referenced_element = motivation_elements[goal_ref]
                if referenced_element.type != "goal":
                    result.add_warning(
                        ValidationWarning(
                            message=(
                                f"Metric '{metric.id}' references '{goal_ref}' which is a "
                                f"'{referenced_element.type}', not a goal"
                            ),
                            element_id=metric.id,
                            layer="apm",
                            property_path="measures-goal",
                            suggestion="Metrics should reference goals, not other motivation types",
                        )
                    )

    def _has_kpi_definition(self, goal: Element) -> bool:
        """
        Check if goal has a KPI or outcome definition.

        Args:
            goal: The goal element

        Returns:
            True if KPI is defined
        """
        kpi_props = ["kpi", "outcome", "measurableOutcome", "successCriteria", "target"]

        for prop in kpi_props:
            if self._get_property(goal, prop):
                return True

        return False

    def _get_property(self, element: Element, property_name: str):
        """Get property value from element."""
        # Check direct property
        if property_name in element.data:
            return element.data[property_name]

        # Check in properties dict
        if "properties" in element.data and property_name in element.data["properties"]:
            return element.data["properties"][property_name]

        # Check in spec dict
        if "spec" in element.data and isinstance(element.data["spec"], dict):
            if property_name in element.data["spec"]:
                return element.data["spec"][property_name]

        return None

    def generate_goal_achievement_report(self, model: Model) -> Dict:
        """
        Generate a report on goal achievement measurement.

        Args:
            model: The model to analyze

        Returns:
            Dictionary with goal achievement statistics
        """
        report = {
            "total_goals": 0,
            "goals_with_kpis": 0,
            "goals_with_metrics": 0,
            "goals_fully_measurable": 0,
            "unmeasured_goals": [],
            "metrics_per_goal": {},
            "orphaned_metrics": [],
        }

        if "motivation" not in model.list_layers():
            return report

        motivation_layer = model.get_layer("motivation")
        goals = [e for e in motivation_layer.list_elements() if e.type == "goal"]
        report["total_goals"] = len(goals)

        # Check if APM layer exists
        if "apm" not in model.list_layers():
            report["unmeasured_goals"] = [g.id for g in goals]
            return report

        apm_layer = model.get_layer("apm")
        metric_to_goal = self._build_metric_index(apm_layer)

        # Analyze each goal
        for goal in goals:
            has_kpi = self._has_kpi_definition(goal)
            if has_kpi:
                report["goals_with_kpis"] += 1

            # Find metrics measuring this goal
            measuring_metrics = []
            for metric_id, goal_ids in metric_to_goal.items():
                if goal.id in goal_ids:
                    measuring_metrics.append(metric_id)

            if measuring_metrics:
                report["goals_with_metrics"] += 1
                report["metrics_per_goal"][goal.id] = measuring_metrics

                if has_kpi:
                    report["goals_fully_measurable"] += 1
            else:
                report["unmeasured_goals"].append(goal.id)

        # Find orphaned metrics (don't measure any goals)
        all_metrics = [e for e in apm_layer.list_elements() if e.type in ["metric", "measure"]]
        for metric in all_metrics:
            goal_refs = self._get_goal_references(metric)
            if not goal_refs:
                report["orphaned_metrics"].append(metric.id)

        # Calculate percentages
        if report["total_goals"] > 0:
            report["kpi_coverage_percentage"] = (
                report["goals_with_kpis"] / report["total_goals"]
            ) * 100
            report["metric_coverage_percentage"] = (
                report["goals_with_metrics"] / report["total_goals"]
            ) * 100
            report["full_measurability_percentage"] = (
                report["goals_fully_measurable"] / report["total_goals"]
            ) * 100
        else:
            report["kpi_coverage_percentage"] = 0.0
            report["metric_coverage_percentage"] = 0.0
            report["full_measurability_percentage"] = 0.0

        return report

    def suggest_metrics_for_goals(self, model: Model) -> List[Dict]:
        """
        Suggest metrics for goals that don't have them.

        Args:
            model: The model to analyze

        Returns:
            List of metric suggestions
        """
        suggestions = []

        if "motivation" not in model.list_layers():
            return suggestions

        motivation_layer = model.get_layer("motivation")

        # Check if APM layer exists
        if "apm" not in model.list_layers():
            metric_to_goal = {}
        else:
            apm_layer = model.get_layer("apm")
            metric_to_goal = self._build_metric_index(apm_layer)

        # Find goals without metrics
        for element in motivation_layer.list_elements():
            if element.type != "goal":
                continue

            # Check if this goal has metrics
            has_metrics = False
            for metric_id, goal_ids in metric_to_goal.items():
                if element.id in goal_ids:
                    has_metrics = True
                    break

            if not has_metrics:
                # Suggest a metric based on goal description/name
                suggestion = self._generate_metric_suggestion(element)
                suggestions.append(suggestion)

        return suggestions

    def _generate_metric_suggestion(self, goal: Element) -> Dict:
        """
        Generate a metric suggestion for a goal.

        Args:
            goal: The goal element

        Returns:
            Dictionary with metric suggestion
        """
        goal_name = goal.data.get("name", "Unknown Goal")
        goal_description = goal.data.get("description", "")

        # Generate metric name based on goal
        metric_name = f"{goal_name} Achievement"

        # Suggest metric type based on keywords
        metric_type = "gauge"  # default
        if any(word in goal_description.lower() for word in ["increase", "grow", "improve"]):
            metric_type = "counter"
        elif any(word in goal_description.lower() for word in ["reduce", "decrease", "minimize"]):
            metric_type = "counter"

        return {
            "goal_id": goal.id,
            "goal_name": goal_name,
            "suggested_metric": {
                "id": f"apm.metric.{goal.id.split('.')[-1]}-achievement",
                "name": metric_name,
                "type": metric_type,
                "measures-goal": goal.id,
                "description": f"Measures achievement of goal: {goal_name}",
            },
        }
