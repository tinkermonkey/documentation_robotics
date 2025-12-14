#!/usr/bin/env python3
"""Fix remaining invalid $ref usages in schemas."""

import json
from pathlib import Path


def fix_api_layer_schema(schema_path: Path):
    """Fix 06-api-layer.schema.json - remove invalid $ref to required."""
    with open(schema_path, 'r', encoding='utf-8') as f:
        schema = json.load(f)

    # These properties incorrectly reference #/definitions/required
    # They should just be type declarations
    fixes = {
        'OpenAPIDocument': {
            'openapi': {'type': 'string', 'description': 'OpenAPI version'},
            'info': {'$ref': '#/definitions/Info'},
            'paths': {'type': 'object', 'description': 'API paths'},
        },
        'Info': {
            'title': {'type': 'string', 'description': 'API title'},
            'version': {'type': 'string', 'description': 'API version'},
        },
        'Server': {
            'url': {'type': 'string', 'description': 'Server URL'},
        },
        'Parameter': {
            'name': {'type': 'string', 'description': 'Parameter name'},
            'in': {'type': 'string', 'enum': ['query', 'header', 'path', 'cookie'], 'description': 'Parameter location'},
        },
        'Response': {
            'description': {'type': 'string', 'description': 'Response description'},
        },
        'Tag': {
            'name': {'type': 'string', 'description': 'Tag name'},
        },
        'ExternalDocumentation': {
            'url': {'type': 'string', 'format': 'uri', 'description': 'Documentation URL'},
        },
        'License': {
            'name': {'type': 'string', 'description': 'License name'},
        },
        'ServerVariable': {
            'default': {'type': 'string', 'description': 'Default value'},
        },
        'OAuthFlow': {
            'scopes': {'type': 'object', 'description': 'Available scopes'},
        },
        'SecurityScheme': {
            'type': {'type': 'string', 'enum': ['apiKey', 'http', 'oauth2', 'openIdConnect'], 'description': 'Security scheme type'},
        },
    }

    if 'definitions' not in schema:
        return False

    changes_made = False
    for def_name, property_fixes in fixes.items():
        if def_name in schema['definitions']:
            definition = schema['definitions'][def_name]
            if 'properties' in definition:
                for prop_name, new_def in property_fixes.items():
                    if prop_name in definition['properties']:
                        old_def = definition['properties'][prop_name]
                        # Check if it has the invalid $ref
                        if isinstance(old_def, dict) and old_def.get('$ref') == '#/definitions/required':
                            definition['properties'][prop_name] = new_def
                            changes_made = True
                            print(f"  Fixed {def_name}.{prop_name}")

    if changes_made:
        with open(schema_path, 'w', encoding='utf-8') as f:
            json.dump(schema, f, indent=2, ensure_ascii=False)
            f.write('\n')

    return changes_made


def fix_data_model_schema(schema_path: Path):
    """Fix 07-data-model-layer.schema.json - fix invalid $ref to string."""
    with open(schema_path, 'r', encoding='utf-8') as f:
        schema = json.load(f)

    if 'definitions' not in schema or 'JSONType' not in schema['definitions']:
        return False

    json_type = schema['definitions']['JSONType']
    if 'properties' not in json_type or 'value' not in json_type['properties']:
        return False

    # Check if value has invalid $ref to string
    value_def = json_type['properties']['value']
    if isinstance(value_def, dict) and value_def.get('$ref') == '#/definitions/string':
        # Replace with proper type definition
        json_type['properties']['value'] = {
            'type': 'string',
            'description': 'String value'
        }

        with open(schema_path, 'w', encoding='utf-8') as f:
            json.dump(schema, f, indent=2, ensure_ascii=False)
            f.write('\n')

        print(f"  Fixed JSONType.value")
        return True

    return False


def main():
    spec_root = Path(__file__).parent.parent / "spec"
    schemas_path = spec_root / "schemas"

    print("Fixing remaining schema $ref errors...\n")

    # Fix API layer schema
    api_schema = schemas_path / "06-api-layer.schema.json"
    print(f"Checking {api_schema.name}...")
    if fix_api_layer_schema(api_schema):
        print(f"✓ Fixed {api_schema.name}")
    else:
        print(f"  No fixes needed")

    print()

    # Fix data model schema
    data_schema = schemas_path / "07-data-model-layer.schema.json"
    print(f"Checking {data_schema.name}...")
    if fix_data_model_schema(data_schema):
        print(f"✓ Fixed {data_schema.name}")
    else:
        print(f"  No fixes needed")


if __name__ == "__main__":
    main()
