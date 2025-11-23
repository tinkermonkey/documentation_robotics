"""
Projection engine - automatically creates elements across layers.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml
from jinja2 import Template


@dataclass
class ProjectionRule:
    """Defines how to project from one layer to another."""

    name: str
    from_layer: str
    from_type: str
    to_layer: str
    to_type: str
    name_template: str
    property_mappings: Dict[str, str]
    conditions: Optional[Dict[str, Any]] = None
    template_file: Optional[str] = None


class ProjectionEngine:
    """
    Manages cross-layer projections.

    Projects elements from source layers to target layers based on rules.
    """

    def __init__(self, model: Any, rules_path: Optional[Path] = None):
        """
        Initialize projection engine.

        Args:
            model: The architecture model
            rules_path: Path to projection-rules.yaml
        """
        self.model = model
        self.rules: List[ProjectionRule] = []

        if rules_path and rules_path.exists():
            self.load_rules(rules_path)

    def load_rules(self, path: Path) -> None:
        """
        Load projection rules from file.

        Args:
            path: Path to projection-rules.yaml
        """
        with open(path, "r") as f:
            data = yaml.safe_load(f)

        if not data or "projections" not in data:
            return

        for rule_data in data["projections"]:
            self.rules.append(self._parse_rule(rule_data))

    def _parse_rule(self, rule_data: Dict[str, Any]) -> ProjectionRule:
        """Parse a projection rule from YAML data."""
        # Parse from/to specifications
        from_spec = rule_data["from"].split(".")
        from_layer = from_spec[0]
        from_type = from_spec[1] if len(from_spec) > 1 else None

        to_spec = rule_data["to"].split(".")
        to_layer = to_spec[0]
        to_type = to_spec[1] if len(to_spec) > 1 else None

        # Get first rule (simplified - could support multiple)
        rule_details = rule_data["rules"][0] if "rules" in rule_data else {}

        return ProjectionRule(
            name=rule_data.get("name", f"{from_layer}-to-{to_layer}"),
            from_layer=from_layer,
            from_type=from_type,
            to_layer=to_layer,
            to_type=rule_details.get("create_type", to_type),
            name_template=rule_details.get("name_template", "{source.name}"),
            property_mappings=rule_details.get("properties", {}),
            conditions=rule_data.get("conditions"),
            template_file=rule_details.get("template"),
        )

    def find_applicable_rules(
        self, source: Any, target_layer: Optional[str] = None
    ) -> List[ProjectionRule]:
        """
        Find projection rules applicable to a source element.

        Args:
            source: Source element
            target_layer: Optional target layer filter

        Returns:
            List of applicable projection rules
        """
        applicable = []

        for rule in self.rules:
            # Check layer match
            if rule.from_layer != source.layer:
                continue

            # Check type match
            if rule.from_type and rule.from_type != source.type:
                continue

            # Check target layer filter
            if target_layer and rule.to_layer != target_layer:
                continue

            # Check conditions
            if rule.conditions and not self._check_conditions(source, rule.conditions):
                continue

            applicable.append(rule)

        return applicable

    def _check_conditions(self, element: Any, conditions: Dict[str, Any]) -> bool:
        """Check if element meets projection conditions."""
        for key, expected_value in conditions.items():
            actual_value = element.get(key)

            if isinstance(expected_value, list):
                if actual_value not in expected_value:
                    return False
            elif actual_value != expected_value:
                return False

        return True

    def project_element(
        self,
        source: Any,
        target_layer: str,
        rule: Optional[ProjectionRule] = None,
        dry_run: bool = False,
    ) -> Optional[Any]:
        """
        Project an element to a target layer.

        Args:
            source: Source element to project
            target_layer: Target layer name
            rule: Optional specific rule to use
            dry_run: If True, don't actually create the element

        Returns:
            Projected element if successful, None otherwise
        """
        # Find rule if not provided
        if not rule:
            rules = self.find_applicable_rules(source, target_layer)
            if not rules:
                raise ValueError(f"No projection rule found for {source.id} -> {target_layer}")
            rule = rules[0]  # Use first matching rule

        # Build projected element
        projected = self._build_projected_element(source, rule)

        if dry_run:
            return projected

        # Add to model
        try:
            self.model.add_element(rule.to_layer, projected)

            # Update reference registry
            if hasattr(self.model, "reference_registry"):
                self.model.reference_registry.register_element(projected)

            return projected

        except Exception as e:
            raise ValueError(f"Failed to project element: {e}")

    def _build_projected_element(self, source: Any, rule: ProjectionRule) -> Any:
        """
        Build projected element from source and rule.

        Args:
            source: Source element
            rule: Projection rule

        Returns:
            New projected element
        """
        from ..utils.id_generator import generate_element_id
        from .element import Element

        # Render name template
        name = self._render_template(rule.name_template, source)

        # Generate ID
        element_id = generate_element_id(rule.to_layer, rule.to_type, name)

        # Build data dictionary
        data = {
            "id": element_id,
            "name": name,
        }

        # Add mapped properties
        for target_prop, source_template in rule.property_mappings.items():
            value = self._render_template(source_template, source)
            self._set_nested_property(data, target_prop, value)

        # Create element
        return Element(id=element_id, element_type=rule.to_type, layer=rule.to_layer, data=data)

    def _render_template(self, template_str: str, source: Any) -> str:
        """
        Render a template string with source element data.

        Args:
            template_str: Template string (e.g., "{source.name}Service")
            source: Source element

        Returns:
            Rendered string
        """
        from ..utils.id_generator import to_kebab_case

        # Create template context with nested structure for Jinja2
        source_dict = {
            **source.data,
            "id": source.id,
            "layer": source.layer,
            "type": source.type,
            "name": source.name,
            "name_pascal": self._to_pascal_case(source.name),
            "name_kebab": to_kebab_case(source.name),
            "name_snake": self._to_snake_case(source.name),
        }

        context = {"source": source_dict}

        # Render template (support both Jinja2 and simple format)
        if "{{" in template_str:
            # Jinja2 style - supports nested access
            template = Template(template_str)
            return template.render(**context)
        else:
            # Python format style - use string replacement
            # Replace {source.xxx} with actual values
            result = template_str
            for key, value in source_dict.items():
                placeholder = f"{{source.{key}}}"
                if placeholder in result:
                    result = result.replace(placeholder, str(value))

            return result

    def _to_pascal_case(self, text: str) -> str:
        """Convert to PascalCase."""
        words = text.replace("-", " ").replace("_", " ").split()
        return "".join(word.capitalize() for word in words)

    def _to_snake_case(self, text: str) -> str:
        """Convert to snake_case."""
        from ..utils.id_generator import to_kebab_case

        return to_kebab_case(text).replace("-", "_")

    def _set_nested_property(self, data: dict, path: str, value: Any) -> None:
        """Set a nested property using dot notation."""
        keys = path.split(".")
        current = data

        for key in keys[:-1]:
            if key not in current:
                current[key] = {}
            current = current[key]

        current[keys[-1]] = value

    def project_all(
        self,
        from_layer: Optional[str] = None,
        to_layer: Optional[str] = None,
        dry_run: bool = False,
    ) -> List[Any]:
        """
        Project all applicable elements.

        Args:
            from_layer: Optional source layer filter
            to_layer: Optional target layer filter
            dry_run: If True, don't actually create elements

        Returns:
            List of projected elements
        """
        projected = []

        # Get source elements
        source_elements = []

        if from_layer:
            layer = self.model.get_layer(from_layer)
            if layer:
                source_elements = list(layer.elements.values())
        else:
            for layer in self.model.layers.values():
                source_elements.extend(layer.elements.values())

        # Project each element
        for source in source_elements:
            rules = self.find_applicable_rules(source, to_layer)

            for rule in rules:
                try:
                    element = self.project_element(source, rule.to_layer, rule, dry_run)
                    if element:
                        projected.append(element)
                except Exception as e:
                    # Log error but continue
                    print(f"Warning: Failed to project {source.id}: {e}")

        return projected
