"""
OpenAPI 3.0 exporter.
"""

from pathlib import Path
from typing import Any, Dict, List

import yaml

from ..core.element import Element
from .export_manager import BaseExporter


class OpenAPIExporter(BaseExporter):
    """
    Exports API layer to OpenAPI 3.0 specification files.

    Creates one OpenAPI file per service or groups operations by tags.
    """

    def export(self) -> Path:
        """
        Export to OpenAPI 3.0.

        Returns:
            Path to output directory
        """
        # Get API layer
        api_layer = self.model.get_layer("api")
        if not api_layer:
            raise ValueError("API layer not found in model")

        # Ensure output directory exists
        self.options.output_path.mkdir(parents=True, exist_ok=True)

        # Group operations by service/tag
        grouped_operations = self._group_operations(api_layer)

        # Generate OpenAPI spec for each group
        output_files = []

        for service_name, operations in grouped_operations.items():
            spec = self._create_openapi_spec(service_name, operations)

            # Write to file
            output_file = self.options.output_path / f"{service_name}-api.yaml"
            with open(output_file, "w") as f:
                yaml.dump(spec, f, default_flow_style=False, sort_keys=False)

            output_files.append(output_file)

        return self.options.output_path

    def _group_operations(self, api_layer) -> Dict[str, List[Element]]:
        """Group operations by service."""
        groups: Dict[str, List[Element]] = {}

        for element in api_layer.elements.values():
            if element.type != "operation":
                continue

            # Determine service name from element
            service = element.get("service") or element.get("tag") or "default"

            if service not in groups:
                groups[service] = []

            groups[service].append(element)

        return groups

    def _create_openapi_spec(self, service_name: str, operations: List[Element]) -> Dict[str, Any]:
        """Create OpenAPI specification."""
        spec = {
            "openapi": "3.0.0",
            "info": {
                "title": f"{service_name} API",
                "version": "1.0.0",
                "description": f"API specification for {service_name}",
            },
            "servers": [{"url": "https://api.example.com/v1", "description": "Production server"}],
            "paths": {},
            "components": {
                "schemas": {},
                "securitySchemes": {},
            },
            "tags": [],
        }

        # Add operations
        for operation in operations:
            self._add_operation(spec, operation)

        # Add referenced schemas
        self._add_referenced_schemas(spec)

        # Add security schemes
        self._add_security_schemes(spec)

        return spec

    def _add_operation(self, spec: Dict[str, Any], operation: Element) -> None:
        """Add operation to OpenAPI spec."""
        # Get operation details
        method = operation.get("method", "get").lower()
        path = operation.get("path", f"/{operation.name.lower().replace(' ', '-')}")

        # Ensure path exists in spec
        if path not in spec["paths"]:
            spec["paths"][path] = {}

        # Create operation object
        op = {
            "operationId": operation.id,
            "summary": operation.name,
            "description": operation.description or "",
            "tags": operation.get("tags", []),
            "parameters": self._convert_parameters(operation.get("parameters", [])),
            "responses": self._convert_responses(operation.get("responses", {})),
        }

        # Add request body if present
        if "requestBody" in operation.data:
            op["requestBody"] = self._convert_request_body(operation.data["requestBody"])

        # Add security if present
        if "security" in operation.data:
            op["security"] = operation.data["security"]

        # Add to spec
        spec["paths"][path][method] = op

    def _convert_parameters(self, parameters: List[Dict]) -> List[Dict]:
        """Convert parameters to OpenAPI format."""
        openapi_params = []

        for param in parameters:
            openapi_param = {
                "name": param.get("name"),
                "in": param.get("in", "query"),
                "required": param.get("required", False),
                "description": param.get("description", ""),
                "schema": param.get("schema", {"type": "string"}),
            }
            openapi_params.append(openapi_param)

        return openapi_params

    def _convert_responses(self, responses: Dict) -> Dict:
        """Convert responses to OpenAPI format."""
        if not responses:
            # Default responses
            return {
                "200": {"description": "Successful operation"},
                "400": {"description": "Bad request"},
                "500": {"description": "Internal server error"},
            }

        openapi_responses = {}

        for status_code, response in responses.items():
            openapi_response = {
                "description": response.get("description", ""),
            }

            if "content" in response:
                openapi_response["content"] = response["content"]
            elif "schema" in response:
                openapi_response["content"] = {"application/json": {"schema": response["schema"]}}

            openapi_responses[str(status_code)] = openapi_response

        return openapi_responses

    def _convert_request_body(self, request_body: Dict) -> Dict:
        """Convert request body to OpenAPI format."""
        openapi_body = {
            "description": request_body.get("description", ""),
            "required": request_body.get("required", False),
            "content": {},
        }

        if "content" in request_body:
            openapi_body["content"] = request_body["content"]
        elif "schema" in request_body:
            openapi_body["content"] = {"application/json": {"schema": request_body["schema"]}}

        return openapi_body

    def _add_referenced_schemas(self, spec: Dict[str, Any]) -> None:
        """Add referenced JSON schemas to components."""
        # Get data model layer
        data_layer = self.model.get_layer("data_model")
        if not data_layer:
            return

        for element in data_layer.elements.values():
            if element.type == "entity":
                # Add schema reference
                schema_ref = element.get("schemaRef")
                if schema_ref:
                    spec["components"]["schemas"][element.name] = {
                        "$ref": f"../schemas/{schema_ref}"
                    }

    def _add_security_schemes(self, spec: Dict[str, Any]) -> None:
        """Add security schemes from security layer."""
        security_layer = self.model.get_layer("security")
        if not security_layer:
            return

        # Find authentication config
        for element in security_layer.elements.values():
            if element.type == "authentication":
                provider = element.get("provider")

                if provider == "oauth2":
                    spec["components"]["securitySchemes"]["oauth2"] = {
                        "type": "oauth2",
                        "flows": {
                            "authorizationCode": {
                                "authorizationUrl": element.get("oauth2", {}).get(
                                    "authorizationUrl"
                                ),
                                "tokenUrl": element.get("oauth2", {}).get("tokenUrl"),
                                "scopes": {
                                    scope: f"Access to {scope}"
                                    for scope in element.get("oauth2", {}).get("scopes", [])
                                },
                            }
                        },
                    }
                elif provider == "jwt":
                    spec["components"]["securitySchemes"]["bearerAuth"] = {
                        "type": "http",
                        "scheme": "bearer",
                        "bearerFormat": "JWT",
                    }

    def validate_output(self, output_path: Path) -> bool:
        """Validate exported OpenAPI specs."""
        # Check that directory exists and has .yaml files
        if not output_path.exists() or not output_path.is_dir():
            return False

        yaml_files = list(output_path.glob("*.yaml"))
        if not yaml_files:
            return False

        # Basic validation of each file
        for yaml_file in yaml_files:
            try:
                with open(yaml_file, "r") as f:
                    spec = yaml.safe_load(f)

                # Check required OpenAPI fields
                if "openapi" not in spec or "info" not in spec or "paths" not in spec:
                    return False

            except Exception:
                return False

        return True
