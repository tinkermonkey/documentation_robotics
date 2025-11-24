"""
Projection engine - automatically creates elements across layers.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import yaml
from jinja2 import Template


@dataclass
class ProjectionCondition:
    """Advanced condition for projection rules."""

    field: str
    operator: str  # equals, not_equals, contains, matches, exists, gt, lt, in
    value: Optional[Any] = None
    pattern: Optional[str] = None

    def evaluate(self, element: Any) -> bool:
        """Evaluate condition against element."""
        # Get field value from element
        if "." in self.field:
            # Nested property access
            field_value = self._get_nested(element.data, self.field)
        else:
            field_value = element.data.get(self.field)

        # Evaluate based on operator
        if self.operator == "exists":
            return field_value is not None
        elif self.operator == "equals":
            return field_value == self.value
        elif self.operator == "not_equals":
            return field_value != self.value
        elif self.operator == "contains":
            return self.value in str(field_value) if field_value else False
        elif self.operator == "matches":
            import re

            return (
                bool(re.match(self.pattern, str(field_value)))
                if field_value and self.pattern
                else False
            )
        elif self.operator == "gt":
            return field_value > self.value if field_value else False
        elif self.operator == "lt":
            return field_value < self.value if field_value else False
        elif self.operator == "in":
            return field_value in self.value if isinstance(self.value, list) else False

        return False

    def _get_nested(self, data: Dict, path: str) -> Any:
        """Get nested property using dot notation."""
        parts = path.split(".")
        current = data
        for part in parts:
            if isinstance(current, dict):
                current = current.get(part)
            else:
                return None
        return current


@dataclass
class PropertyTransform:
    """Transform for property values."""

    type: str  # uppercase, lowercase, kebab, snake, pascal, prefix, suffix, template
    value: Optional[str] = None  # For prefix/suffix/template

    def apply(self, value: Any) -> Any:
        """Apply transformation to value."""
        if value is None:
            return None

        str_value = str(value)

        if self.type == "uppercase":
            return str_value.upper()
        elif self.type == "lowercase":
            return str_value.lower()
        elif self.type == "kebab":
            return str_value.lower().replace(" ", "-").replace("_", "-")
        elif self.type == "snake":
            return str_value.lower().replace(" ", "_").replace("-", "_")
        elif self.type == "pascal":
            words = str_value.replace("-", " ").replace("_", " ").split()
            return "".join(w.capitalize() for w in words)
        elif self.type == "prefix" and self.value:
            return f"{self.value}{str_value}"
        elif self.type == "suffix" and self.value:
            return f"{str_value}{self.value}"
        elif self.type == "template" and self.value:
            return self.value.format(value=str_value)

        return value


@dataclass
class PropertyMapping:
    """Enhanced property mapping with transformations."""

    source: str
    target: str
    default: Optional[Any] = None
    required: bool = False
    transform: Optional[PropertyTransform] = None


@dataclass
class ProjectionRule:
    """Defines how to project from one layer to another."""

    name: str
    from_layer: str
    from_type: str
    to_layer: str
    to_type: str
    name_template: str
    property_mappings: Union[Dict[str, str], List[PropertyMapping]]  # Support both formats
    conditions: List[ProjectionCondition] = None  # Optional conditions for projection
    template_file: Optional[str] = None
    create_bidirectional: bool = True  # Auto-create reverse relationships

    def __post_init__(self):
        """Initialize default values for mutable fields."""
        if self.conditions is None:
            self.conditions = []


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

        # Parse conditions
        conditions = []
        for cond_data in rule_data.get("conditions", []):
            conditions.append(
                ProjectionCondition(
                    field=cond_data["field"],
                    operator=cond_data.get("operator", "equals"),
                    value=cond_data.get("value"),
                    pattern=cond_data.get("pattern"),
                )
            )

        # Parse property mappings
        mappings = []
        for source, target_spec in rule_details.get("properties", {}).items():
            if isinstance(target_spec, dict):
                # Advanced mapping with transform
                transform = None
                if "transform" in target_spec:
                    transform = PropertyTransform(
                        type=target_spec["transform"], value=target_spec.get("transform_value")
                    )

                mappings.append(
                    PropertyMapping(
                        source=source,
                        target=target_spec.get("target", source),
                        default=target_spec.get("default"),
                        required=target_spec.get("required", False),
                        transform=transform,
                    )
                )
            else:
                # Simple mapping (target property path)
                mappings.append(PropertyMapping(source=source, target=target_spec))

        return ProjectionRule(
            name=rule_data.get("name", f"{from_layer}-to-{to_layer}"),
            from_layer=from_layer,
            from_type=from_type,
            to_layer=to_layer,
            to_type=rule_details.get("create_type", to_type),
            name_template=rule_details.get("name_template", "{source.name}"),
            property_mappings=mappings,
            conditions=conditions,
            template_file=rule_details.get("template"),
            create_bidirectional=rule_details.get("create_bidirectional", True),
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
            if rule.conditions and not all(cond.evaluate(source) for cond in rule.conditions):
                continue

            applicable.append(rule)

        return applicable

    def _check_conditions(
        self, element: Any, conditions: Union[Dict[str, Any], List[ProjectionCondition]]
    ) -> bool:
        """Check if element meets projection conditions."""
        # Handle dict format (for simpler condition specifications)
        if isinstance(conditions, dict):
            condition_list = []
            for field, value in conditions.items():
                if isinstance(value, list):
                    # Check if field value is in the list
                    condition_list.append(
                        ProjectionCondition(field=field, operator="in", value=value)
                    )
                else:
                    # Check if field value equals the value
                    condition_list.append(
                        ProjectionCondition(field=field, operator="equals", value=value)
                    )
        else:
            condition_list = conditions

        return all(cond.evaluate(element) for cond in condition_list)

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

        # Add mapped properties (handle both dict and List[PropertyMapping])
        if isinstance(rule.property_mappings, dict):
            # Old dict-based format
            # In dict format: key is target property, value is source (template or property path)
            for target_key, source_spec in rule.property_mappings.items():
                if source_spec.startswith("{") or source_spec.startswith("{{"):
                    value = self._render_template(source_spec, source)
                else:
                    value = self._get_nested_property(source.data, source_spec)

                if value is not None:
                    self._set_nested_property(data, target_key, value)
        else:
            # New List[PropertyMapping] format
            for mapping in rule.property_mappings:
                # Get source value
                if mapping.source.startswith("{") or mapping.source.startswith("{{"):
                    # Template
                    value = self._render_template(mapping.source, source)
                else:
                    # Direct property access - check element attributes first
                    if mapping.source in ("id", "layer", "type", "name"):
                        value = getattr(source, mapping.source, None)
                    else:
                        value = self._get_nested_property(source.data, mapping.source)

                # Use default if value is None
                if value is None:
                    value = mapping.default

                # Check required
                if mapping.required and value is None:
                    raise ValueError(f"Required property '{mapping.source}' is missing")

                # Apply transformation
                if value is not None and mapping.transform:
                    value = mapping.transform.apply(value)

                # Set target property
                if value is not None:
                    self._set_nested_property(data, mapping.target, value)

        # Create bidirectional relationship
        if rule.create_bidirectional:
            if "properties" not in data:
                data["properties"] = {}
            data["properties"]["realizes"] = source.id

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

    def _get_nested_property(self, data: dict, path: str) -> Any:
        """Get a nested property using dot notation."""
        keys = path.split(".")
        current = data

        for key in keys:
            if isinstance(current, dict):
                current = current.get(key)
            else:
                return None

        return current

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
