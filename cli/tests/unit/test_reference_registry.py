"""Unit tests for ReferenceRegistry."""
import pytest
from documentation_robotics.core.reference_registry import (
    Reference,
    ReferenceRegistry,
    ReferenceDefinition
)
from documentation_robotics.core.element import Element


class TestReference:
    """Tests for Reference dataclass."""

    def test_reference_creation(self):
        """Test creating a reference."""
        ref = Reference(
            source_id="business.service.test",
            target_id="application.service.test",
            property_path="realizes",
            reference_type="realization",
            required=True
        )

        assert ref.source_id == "business.service.test"
        assert ref.target_id == "application.service.test"
        assert ref.property_path == "realizes"
        assert ref.reference_type == "realization"
        assert ref.required is True

    def test_reference_equality(self):
        """Test reference equality."""
        ref1 = Reference("a", "b", "realizes", "realization")
        ref2 = Reference("a", "b", "realizes", "realization")
        ref3 = Reference("a", "c", "realizes", "realization")

        assert ref1 == ref2
        assert ref1 != ref3

    def test_reference_hash(self):
        """Test reference hashing."""
        ref1 = Reference("a", "b", "realizes", "realization")
        ref2 = Reference("a", "b", "realizes", "realization")

        assert hash(ref1) == hash(ref2)

        # Can be used in sets
        ref_set = {ref1, ref2}
        assert len(ref_set) == 1


class TestReferenceRegistry:
    """Tests for ReferenceRegistry."""

    def test_registry_creation(self):
        """Test creating a registry."""
        registry = ReferenceRegistry()

        assert len(registry.references) == 0
        assert len(registry.reference_definitions) == 0

    def test_add_reference(self):
        """Test adding a reference."""
        registry = ReferenceRegistry()
        ref = Reference("a", "b", "realizes", "realization")

        registry.add_reference(ref)

        assert len(registry.references) == 1
        assert ref in registry.references

    def test_get_references_from(self):
        """Test getting references from an element."""
        registry = ReferenceRegistry()
        ref1 = Reference("a", "b", "realizes", "realization")
        ref2 = Reference("a", "c", "uses", "usage")
        ref3 = Reference("b", "c", "uses", "usage")

        registry.add_reference(ref1)
        registry.add_reference(ref2)
        registry.add_reference(ref3)

        from_a = registry.get_references_from("a")
        assert len(from_a) == 2
        assert ref1 in from_a
        assert ref2 in from_a

    def test_get_references_to(self):
        """Test getting references to an element."""
        registry = ReferenceRegistry()
        ref1 = Reference("a", "b", "realizes", "realization")
        ref2 = Reference("c", "b", "uses", "usage")
        ref3 = Reference("a", "c", "uses", "usage")

        registry.add_reference(ref1)
        registry.add_reference(ref2)
        registry.add_reference(ref3)

        to_b = registry.get_references_to("b")
        assert len(to_b) == 2
        assert ref1 in to_b
        assert ref2 in to_b

    def test_get_references_by_type(self):
        """Test getting references by type."""
        registry = ReferenceRegistry()
        ref1 = Reference("a", "b", "realizes", "realization")
        ref2 = Reference("c", "d", "realizes", "realization")
        ref3 = Reference("a", "c", "uses", "usage")

        registry.add_reference(ref1)
        registry.add_reference(ref2)
        registry.add_reference(ref3)

        realizations = registry.get_references_by_type("realization")
        assert len(realizations) == 2
        assert ref1 in realizations
        assert ref2 in realizations

    def test_remove_reference(self):
        """Test removing a reference."""
        registry = ReferenceRegistry()
        ref = Reference("a", "b", "realizes", "realization")

        registry.add_reference(ref)
        assert len(registry.references) == 1

        registry.remove_reference("a", "b")
        assert len(registry.references) == 0

    def test_find_broken_references(self):
        """Test finding broken references."""
        registry = ReferenceRegistry()
        ref1 = Reference("a", "b", "realizes", "realization")
        ref2 = Reference("a", "nonexistent", "uses", "usage")

        registry.add_reference(ref1)
        registry.add_reference(ref2)

        valid_ids = {"a", "b", "c"}
        broken = registry.find_broken_references(valid_ids)

        assert len(broken) == 1
        assert broken[0].target_id == "nonexistent"

    def test_register_element(self, sample_element_with_refs):
        """Test registering an element."""
        registry = ReferenceRegistry()

        registry.register_element(sample_element_with_refs)

        refs = registry.get_references_from("application.service.test-app-service")
        assert len(refs) > 0

        # Check realizes reference
        realizes_refs = [r for r in refs if r.property_path == "realizes"]
        assert len(realizes_refs) == 1
        assert realizes_refs[0].target_id == "business.service.test-service"

    def test_extract_references(self, sample_element_with_refs):
        """Test extracting references from element."""
        registry = ReferenceRegistry()

        refs = registry._extract_references(sample_element_with_refs)

        # Should extract realizes and uses references
        assert len(refs) >= 3  # 1 realizes + 2 uses

        target_ids = {ref.target_id for ref in refs}
        assert "business.service.test-service" in target_ids
        assert "data_model.entity.customer" in target_ids
        assert "data_model.entity.order" in target_ids

    def test_infer_reference_type(self):
        """Test reference type inference."""
        registry = ReferenceRegistry()

        assert registry._infer_reference_type("realizes") == "realization"
        assert registry._infer_reference_type("serves") == "serving"
        assert registry._infer_reference_type("accesses") == "access"
        assert registry._infer_reference_type("uses") == "usage"
        assert registry._infer_reference_type("unknown") == "association"

    def test_get_dependency_graph(self):
        """Test building dependency graph."""
        registry = ReferenceRegistry()
        ref1 = Reference("a", "b", "realizes", "realization")
        ref2 = Reference("b", "c", "uses", "usage")

        registry.add_reference(ref1)
        registry.add_reference(ref2)

        graph = registry.get_dependency_graph()

        assert "a" in graph.nodes()
        assert "b" in graph.nodes()
        assert "c" in graph.nodes()
        assert graph.has_edge("a", "b")
        assert graph.has_edge("b", "c")

    def test_find_circular_dependencies(self):
        """Test finding circular dependencies."""
        registry = ReferenceRegistry()

        # Create circular chain: a -> b -> c -> a
        registry.add_reference(Reference("a", "b", "uses", "usage"))
        registry.add_reference(Reference("b", "c", "uses", "usage"))
        registry.add_reference(Reference("c", "a", "uses", "usage"))

        cycles = registry.find_circular_dependencies()

        assert len(cycles) > 0
        # Should find the cycle
        assert any("a" in cycle for cycle in cycles)

    def test_get_impact_analysis(self):
        """Test impact analysis."""
        registry = ReferenceRegistry()

        # Create dependency chain: a <- b <- c
        registry.add_reference(Reference("b", "a", "uses", "usage"))
        registry.add_reference(Reference("c", "b", "uses", "usage"))

        # If we change 'a', 'b' and 'c' are impacted
        impacted = registry.get_impact_analysis("a")

        assert "b" in impacted
        assert "c" in impacted

    def test_get_impact_analysis_with_depth(self):
        """Test impact analysis with depth limit."""
        registry = ReferenceRegistry()

        # Create chain: a <- b <- c <- d
        registry.add_reference(Reference("b", "a", "uses", "usage"))
        registry.add_reference(Reference("c", "b", "uses", "usage"))
        registry.add_reference(Reference("d", "c", "uses", "usage"))

        # With depth 1, only b is impacted
        impacted = registry.get_impact_analysis("a", max_depth=1)

        assert "b" in impacted
        assert "c" not in impacted

    def test_scan_nested_references(self):
        """Test scanning nested references."""
        registry = ReferenceRegistry()

        element = Element(
            id="test.element.nested",
            element_type="test",
            layer="test",
            data={
                "nested": {
                    "dataRef": "data.entity.customer",
                    "apiRef": "api.operation.get-customer"
                }
            }
        )

        refs = registry._scan_nested_references(element, element.data)

        assert len(refs) >= 2
        target_ids = {ref.target_id for ref in refs}
        assert "data.entity.customer" in target_ids
        assert "api.operation.get-customer" in target_ids


class TestReferenceDefinition:
    """Tests for ReferenceDefinition."""

    def test_definition_creation(self):
        """Test creating a reference definition."""
        ref_def = ReferenceDefinition(
            layer="business",
            element_type="service",
            property_path="realizes",
            target_layer="application",
            target_type="service",
            reference_type="realization",
            required=True,
            cardinality="1"
        )

        assert ref_def.layer == "business"
        assert ref_def.element_type == "service"
        assert ref_def.required is True
        assert ref_def.cardinality == "1"
