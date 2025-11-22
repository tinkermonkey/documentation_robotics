"""
Manifest management - tracks model metadata and layer registry.
"""
from pathlib import Path
from typing import Dict, Any, Optional
from datetime import datetime
import yaml


class Manifest:
    """
    Represents the model manifest file.

    Tracks metadata, layer configuration, statistics, and conventions.
    """

    def __init__(self, path: Path, data: Dict[str, Any]):
        """
        Initialize manifest.

        Args:
            path: Path to manifest.yaml file
            data: Manifest data dictionary
        """
        self.path = path
        self.data = data
        self.version = data.get("version", "1.0.0")
        self.project = data.get("project", {})
        self.layers = data.get("layers", {})
        self.statistics = data.get("statistics", {})
        self.conventions = data.get("conventions", {})

    @classmethod
    def load(cls, path: Path) -> "Manifest":
        """Load manifest from file."""
        if not path.exists():
            raise FileNotFoundError(f"Manifest not found: {path}")

        with open(path, "r") as f:
            data = yaml.safe_load(f)

        return cls(path, data)

    @classmethod
    def create(
        cls,
        path: Path,
        project_name: str,
        project_description: str = "",
        project_version: str = "1.0.0"
    ) -> "Manifest":
        """
        Create a new manifest.

        Args:
            path: Path to save manifest
            project_name: Project name
            project_description: Project description
            project_version: Project version

        Returns:
            New Manifest instance
        """
        now = datetime.utcnow().isoformat() + "Z"

        data = {
            "version": "1.0.0",
            "schema": "documentation-robotics-v1",
            "created": now,
            "updated": now,
            "project": {
                "name": project_name,
                "description": project_description,
                "version": project_version,
            },
            "documentation": ".dr/README.md",
            "layers": cls._default_layers(),
            "cross_references": {
                "total": 0,
                "by_type": {},
            },
            "statistics": {
                "total_elements": 0,
                "total_relationships": 0,
                "completeness": 0.0,
                "last_validation": None,
                "validation_status": "not_validated",
            },
            "conventions": {
                "id_format": "{layer}.{type}.{kebab-case-name}",
                "file_naming": {
                    "api": "{service-name}-api.yaml",
                    "schema": "{entity-name}.schema.json",
                    "ux": "{screen-name}.ux.yaml",
                },
            },
        }

        manifest = cls(path, data)
        manifest.save()
        return manifest

    @staticmethod
    def _default_layers() -> Dict[str, Any]:
        """Get default layer configuration."""
        return {
            "motivation": {
                "order": 1,
                "name": "Motivation",
                "path": "model/01_motivation/",
                "schema": ".dr/schemas/01-motivation-layer.schema.json",
                "enabled": True,
                "elements": {},
            },
            "business": {
                "order": 2,
                "name": "Business",
                "path": "model/02_business/",
                "schema": ".dr/schemas/02-business-layer.schema.json",
                "enabled": True,
                "elements": {},
            },
            "security": {
                "order": 3,
                "name": "Security",
                "path": "model/03_security/",
                "schema": ".dr/schemas/03-security-layer.schema.json",
                "enabled": True,
                "elements": {},
            },
            "application": {
                "order": 4,
                "name": "Application",
                "path": "model/04_application/",
                "schema": ".dr/schemas/04-application-layer.schema.json",
                "enabled": True,
                "elements": {},
            },
            "technology": {
                "order": 5,
                "name": "Technology",
                "path": "model/05_technology/",
                "schema": ".dr/schemas/05-technology-layer.schema.json",
                "enabled": True,
                "elements": {},
            },
            "api": {
                "order": 6,
                "name": "API",
                "path": "model/06_api/",
                "schema": ".dr/schemas/06-api-layer.schema.json",
                "enabled": True,
                "elements": {},
            },
            "data_model": {
                "order": 7,
                "name": "Data Model",
                "path": "model/07_data_model/",
                "schema": ".dr/schemas/07-data-model-layer.schema.json",
                "enabled": True,
                "elements": {},
            },
            "datastore": {
                "order": 8,
                "name": "Data Store",
                "path": "model/08_datastore/",
                "schema": ".dr/schemas/08-datastore-layer.schema.json",
                "enabled": True,
                "elements": {},
            },
            "ux": {
                "order": 9,
                "name": "UX",
                "path": "model/09_ux/",
                "schema": ".dr/schemas/09-ux-layer.schema.json",
                "enabled": True,
                "elements": {},
            },
            "navigation": {
                "order": 10,
                "name": "Navigation",
                "path": "model/10_navigation/",
                "schema": ".dr/schemas/10-navigation-layer.schema.json",
                "enabled": True,
                "elements": {},
            },
            "apm": {
                "order": 11,
                "name": "APM/Observability",
                "path": "model/11_apm/",
                "schema": ".dr/schemas/11-apm-observability-layer.schema.json",
                "enabled": True,
                "elements": {},
            },
        }

    def increment_element_count(self, layer: str, element_type: str) -> None:
        """Increment element count for a layer and type."""
        if layer not in self.layers:
            return

        if "elements" not in self.layers[layer]:
            self.layers[layer]["elements"] = {}

        current = self.layers[layer]["elements"].get(element_type, 0)
        self.layers[layer]["elements"][element_type] = current + 1

        # Update total
        self.statistics["total_elements"] = self.statistics.get("total_elements", 0) + 1
        self._update_timestamp()

    def decrement_element_count(self, layer: str, element_type: str) -> None:
        """Decrement element count for a layer and type."""
        if layer not in self.layers:
            return

        if "elements" in self.layers[layer]:
            current = self.layers[layer]["elements"].get(element_type, 0)
            if current > 0:
                self.layers[layer]["elements"][element_type] = current - 1
                self.statistics["total_elements"] = max(
                    0,
                    self.statistics.get("total_elements", 0) - 1
                )

        self._update_timestamp()

    def update_validation_status(self, status: str, timestamp: Optional[str] = None) -> None:
        """Update validation status and timestamp."""
        self.statistics["validation_status"] = status
        self.statistics["last_validation"] = timestamp or datetime.utcnow().isoformat() + "Z"
        self._update_timestamp()

    def _update_timestamp(self) -> None:
        """Update the 'updated' timestamp."""
        self.data["updated"] = datetime.utcnow().isoformat() + "Z"

    def save(self) -> None:
        """Save manifest to file."""
        # Update data dictionary
        self.data["layers"] = self.layers
        self.data["statistics"] = self.statistics

        # Ensure parent directory exists
        self.path.parent.mkdir(parents=True, exist_ok=True)

        with open(self.path, "w") as f:
            yaml.dump(self.data, f, default_flow_style=False, sort_keys=False)
