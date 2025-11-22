"""
ArchiMate XML exporter.
"""
from pathlib import Path
from typing import Dict, List, Set
from lxml import etree as ET
from datetime import datetime
from .export_manager import BaseExporter, ExportOptions
from ..core.element import Element


class ArchiMateExporter(BaseExporter):
    """
    Exports model to ArchiMate 3.2 XML format.

    Creates ArchiMate Exchange File that can be imported into
    ArchiMate tools like Archi, Enterprise Architect, etc.
    """

    # ArchiMate namespace
    ARCHIMATE_NS = "http://www.opengroup.org/xsd/archimate/3.0/"
    XSI_NS = "http://www.w3.org/2001/XMLSchema-instance"

    # Layer to ArchiMate element type mapping
    LAYER_TYPE_MAP = {
        # Motivation layer
        ("motivation", "stakeholder"): "Stakeholder",
        ("motivation", "driver"): "Driver",
        ("motivation", "assessment"): "Assessment",
        ("motivation", "goal"): "Goal",
        ("motivation", "outcome"): "Outcome",
        ("motivation", "principle"): "Principle",
        ("motivation", "requirement"): "Requirement",
        ("motivation", "constraint"): "Constraint",
        ("motivation", "meaning"): "Meaning",
        ("motivation", "value"): "Value",
        # Business layer
        ("business", "actor"): "BusinessActor",
        ("business", "role"): "BusinessRole",
        ("business", "collaboration"): "BusinessCollaboration",
        ("business", "interface"): "BusinessInterface",
        ("business", "process"): "BusinessProcess",
        ("business", "function"): "BusinessFunction",
        ("business", "interaction"): "BusinessInteraction",
        ("business", "event"): "BusinessEvent",
        ("business", "service"): "BusinessService",
        ("business", "object"): "BusinessObject",
        ("business", "contract"): "Contract",
        ("business", "representation"): "Representation",
        ("business", "product"): "Product",
        # Application layer
        ("application", "component"): "ApplicationComponent",
        ("application", "collaboration"): "ApplicationCollaboration",
        ("application", "interface"): "ApplicationInterface",
        ("application", "function"): "ApplicationFunction",
        ("application", "interaction"): "ApplicationInteraction",
        ("application", "event"): "ApplicationEvent",
        ("application", "service"): "ApplicationService",
        ("application", "process"): "ApplicationProcess",
        ("application", "object"): "DataObject",
        # Technology layer
        ("technology", "node"): "Node",
        ("technology", "device"): "Device",
        ("technology", "software"): "SystemSoftware",
        ("technology", "collaboration"): "TechnologyCollaboration",
        ("technology", "interface"): "TechnologyInterface",
        ("technology", "path"): "Path",
        ("technology", "network"): "CommunicationNetwork",
        ("technology", "function"): "TechnologyFunction",
        ("technology", "process"): "TechnologyProcess",
        ("technology", "interaction"): "TechnologyInteraction",
        ("technology", "event"): "TechnologyEvent",
        ("technology", "service"): "TechnologyService",
        ("technology", "artifact"): "Artifact",
    }

    # Relationship type mapping
    RELATIONSHIP_TYPE_MAP = {
        "realization": "Realization",
        "serving": "Serving",
        "access": "Access",
        "usage": "Usage",
        "composition": "Composition",
        "aggregation": "Aggregation",
        "assignment": "Assignment",
        "flow": "Flow",
        "triggering": "Triggering",
        "specialization": "Specialization",
        "association": "Association",
    }

    def export(self) -> Path:
        """
        Export to ArchiMate XML.

        Returns:
            Path to exported file
        """
        # Create XML structure
        root = self._create_root()

        # Add model metadata
        self._add_metadata(root)

        # Add elements
        elements_section = ET.SubElement(root, "elements")
        self._add_elements(elements_section)

        # Add relationships
        relationships_section = ET.SubElement(root, "relationships")
        self._add_relationships(relationships_section)

        # Add organizations (views/folders)
        organizations_section = ET.SubElement(root, "organizations")
        self._add_organizations(organizations_section)

        # Create XML tree
        tree = ET.ElementTree(root)

        # Ensure output directory exists
        self.options.output_path.parent.mkdir(parents=True, exist_ok=True)

        # Write to file
        tree.write(
            str(self.options.output_path),
            pretty_print=True,
            xml_declaration=True,
            encoding="UTF-8",
        )

        return self.options.output_path

    def _create_root(self) -> ET.Element:
        """Create root element with namespaces."""
        nsmap = {
            None: self.ARCHIMATE_NS,
            "xsi": self.XSI_NS,
        }

        root = ET.Element(
            "model",
            nsmap=nsmap,
            attrib={
                f"{{{self.XSI_NS}}}schemaLocation": f"{self.ARCHIMATE_NS} http://www.opengroup.org/xsd/archimate/3.1/archimate3_Diagram.xsd",
                "identifier": self._generate_id(),
                "version": "5.0.0",
            },
        )

        return root

    def _add_metadata(self, root: ET.Element) -> None:
        """Add model metadata."""
        metadata = ET.SubElement(root, "metadata")

        # Schema
        schema = ET.SubElement(metadata, "schema")
        schema.text = "3.2"

        # Creator
        creator = ET.SubElement(metadata, "creator")
        creator.text = "Documentation Robotics CLI"

        # Created
        created = ET.SubElement(metadata, "created")
        created.text = datetime.utcnow().isoformat() + "Z"

        # Name
        name = ET.SubElement(root, "name")
        name.text = self.model.manifest.project.get("name", "Architecture Model")

        # Documentation
        if "description" in self.model.manifest.project:
            documentation = ET.SubElement(root, "documentation")
            documentation.text = self.model.manifest.project["description"]

    def _add_elements(self, parent: ET.Element) -> None:
        """Add all elements to the export."""
        for layer in self.model.layers.values():
            # Skip non-ArchiMate layers
            if layer.name not in ["motivation", "business", "application", "technology"]:
                continue

            # Filter by layer if specified
            if self.options.layer_filter and layer.name != self.options.layer_filter:
                continue

            for element in layer.elements.values():
                self._add_element(parent, element)

    def _add_element(self, parent: ET.Element, element: Element) -> None:
        """Add a single element."""
        # Get ArchiMate type
        archimate_type = self.LAYER_TYPE_MAP.get(
            (element.layer, element.type), "ApplicationComponent"  # Default fallback
        )

        # Create element
        elem = ET.SubElement(
            parent,
            "element",
            attrib={
                "identifier": element.id,
                f"{{{self.XSI_NS}}}type": archimate_type,
            },
        )

        # Add name
        name = ET.SubElement(elem, "name")
        name.text = element.name

        # Add documentation
        if element.description:
            documentation = ET.SubElement(elem, "documentation")
            documentation.text = element.description

        # Add properties
        if self.options.include_metadata:
            self._add_properties(elem, element)

    def _add_properties(self, parent: ET.Element, element: Element) -> None:
        """Add element properties."""
        properties_section = ET.SubElement(parent, "properties")

        # Add all element data as properties (except standard fields)
        exclude_keys = {"id", "name", "description", "type"}

        for key, value in element.data.items():
            if key in exclude_keys:
                continue

            # Convert complex values to string
            if isinstance(value, (dict, list)):
                import json

                value_str = json.dumps(value)
            else:
                value_str = str(value)

            prop = ET.SubElement(
                properties_section, "property", attrib={"identifier": self._generate_id()}
            )

            prop_key = ET.SubElement(prop, "key")
            prop_key.text = key

            prop_value = ET.SubElement(prop, "value")
            prop_value.text = value_str

    def _add_relationships(self, parent: ET.Element) -> None:
        """Add all relationships to the export."""
        # Get all references from registry
        if not hasattr(self.model, "reference_registry"):
            return

        for ref in self.model.reference_registry.references:
            self._add_relationship(parent, ref)

    def _add_relationship(self, parent: ET.Element, reference) -> None:
        """Add a single relationship."""
        # Get ArchiMate relationship type
        archimate_type = self.RELATIONSHIP_TYPE_MAP.get(
            reference.reference_type, "Association"  # Default fallback
        )

        # Create relationship
        rel = ET.SubElement(
            parent,
            "relationship",
            attrib={
                "identifier": self._generate_id(),
                f"{{{self.XSI_NS}}}type": archimate_type,
                "source": reference.source_id,
                "target": reference.target_id,
            },
        )

        # Add name (optional)
        name = ET.SubElement(rel, "name")
        name.text = f"{reference.reference_type}: {reference.property_path}"

    def _add_organizations(self, parent: ET.Element) -> None:
        """Add organizational structure (folders/views)."""
        # Create folder for each layer
        for layer in self.model.layers.values():
            if layer.name not in ["motivation", "business", "application", "technology"]:
                continue

            folder = ET.SubElement(
                parent,
                "item",
                attrib={"identifier": self._generate_id(), "type": "folder"},
            )

            name = ET.SubElement(folder, "label")
            name.text = layer.config.get("name", layer.name.title())

            # Add elements to folder
            for element in layer.elements.values():
                item = ET.SubElement(folder, "item", attrib={"identifierRef": element.id})

    def _generate_id(self) -> str:
        """Generate unique identifier."""
        import uuid

        return f"id-{uuid.uuid4()}"

    def validate_output(self, output_path: Path) -> bool:
        """Validate exported ArchiMate XML."""
        try:
            # Parse XML
            tree = ET.parse(str(output_path))
            root = tree.getroot()

            # Check root element
            if root.tag != f"{{{self.ARCHIMATE_NS}}}model":
                return False

            # Define namespace for finding elements
            ns = {"archimate": self.ARCHIMATE_NS}

            # Check required sections
            required = ["metadata", "elements"]
            for section in required:
                if root.find(f"archimate:{section}", ns) is None:
                    return False

            return True

        except Exception as e:
            print(f"Validation error: {e}")
            return False
