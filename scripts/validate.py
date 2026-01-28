#!/usr/bin/env python3
"""Unified validation script for Documentation Robotics.

This script consolidates all validation capabilities:
- Markdown structure and entity definitions
- JSON schema validation
- Relationship validation (cross-layer and intra-layer)
- Documentation structure compliance

Usage:
    # Run all validations
    python scripts/validate.py --all

    # Specific validation types
    python scripts/validate.py --markdown [--layer 02-business]
    python scripts/validate.py --schemas
    python scripts/validate.py --relationships [--layer 02-business]
    python scripts/validate.py --structure [--layer 02-business]

    # Output control
    python scripts/validate.py --all --strict    # Warnings as errors
    python scripts/validate.py --all --format json
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Any, Optional

# Add scripts directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from validation.markdown_validator import MarkdownValidator  # noqa: E402
from validation.schema_validator import SchemaValidator  # noqa: E402
from validation.relationship_validator import RelationshipValidator  # noqa: E402
from validation.structure_validator import LayerStructureValidator  # noqa: E402


class UnifiedValidator:
    """Orchestrates all validation types."""

    def __init__(self, root_dir: Optional[Path] = None):
        """Initialize unified validator.

        Args:
            root_dir: Project root directory (defaults to auto-detect)
        """
        if root_dir is None:
            # Auto-detect: script is in scripts/, root is 1 level up
            root_dir = Path(__file__).parent.parent

        self.root_dir = root_dir
        self.spec_root = root_dir / "spec"

        # Initialize validators
        self.markdown_validator = MarkdownValidator(root_dir)
        self.schema_validator = SchemaValidator(self.spec_root)
        self.relationship_validator = RelationshipValidator(self.spec_root)
        self.structure_validator = LayerStructureValidator(self.spec_root)

    def validate_all(self, layer_id: Optional[str] = None, strict: bool = False) -> Dict[str, Any]:
        """Run all validation types.

        Args:
            layer_id: Optional layer to validate (None = all layers)
            strict: Treat warnings as errors

        Returns:
            Dictionary with validation results
        """
        print("=" * 80)
        print("DOCUMENTATION ROBOTICS - UNIFIED VALIDATION")
        print("=" * 80)
        print()

        results = {}

        # Run each validation type
        print("[1/4] Markdown Validation")
        print("-" * 80)
        results['markdown'] = self.validate_markdown(layer_id)
        print()

        print("[2/4] JSON Schema Validation")
        print("-" * 80)
        results['schemas'] = self.validate_schemas()
        print()

        print("[3/4] Relationship Validation")
        print("-" * 80)
        results['relationships'] = self.validate_relationships(layer_id, strict)
        print()

        print("[4/4] Structure Validation")
        print("-" * 80)
        results['structure'] = self.validate_structure(layer_id, strict)
        print()

        # Aggregate results
        total_errors = sum(
            len(r.get('errors', [])) if isinstance(r, dict) else 0
            for r in results.values()
        )
        total_warnings = sum(
            len(r.get('warnings', [])) if isinstance(r, dict) else 0
            for r in results.values()
        )

        results['summary'] = {
            'total_errors': total_errors,
            'total_warnings': total_warnings,
            'validation_passed': total_errors == 0 and (not strict or total_warnings == 0),
            'layers_validated': layer_id if layer_id else 'all',
        }

        return results

    def validate_markdown(self, layer_id: Optional[str] = None) -> Dict[str, Any]:
        """Validate markdown layer specifications.

        Args:
            layer_id: Optional layer to validate (None = all layers)

        Returns:
            Validation results
        """
        if layer_id:
            # Validate specific layer
            layer_file = self.root_dir / "spec" / "layers" / f"{layer_id}-layer.md"
            if not layer_file.exists():
                return {
                    'status': 'error',
                    'errors': [f'Layer file not found: {layer_file}'],
                    'warnings': []
                }

            result = self.markdown_validator.validate_layer(layer_file)
            self.markdown_validator.print_results([result])
            return {
                'status': result['status'],
                'errors': result.get('errors', []),
                'warnings': result.get('warnings', []),
                'results': [result]
            }
        else:
            # Validate all layers
            results = self.markdown_validator.validate_all()
            self.markdown_validator.print_results(results)

            all_errors = []
            all_warnings = []
            for r in results:
                all_errors.extend(r.get('errors', []))
                all_warnings.extend(r.get('warnings', []))

            return {
                'status': 'success' if not all_errors else 'error',
                'errors': all_errors,
                'warnings': all_warnings,
                'results': results
            }

    def validate_schemas(self) -> Dict[str, Any]:
        """Validate JSON schemas.

        Returns:
            Validation results
        """
        self.schema_validator.validate_all_schemas()
        self.schema_validator.print_summary()

        return {
            'status': 'success' if not self.schema_validator.errors else 'error',
            'errors': [f"{name}: {msg}" for name, msg in self.schema_validator.errors],
            'warnings': [f"{name}: {msg}" for name, msg in self.schema_validator.warnings],
        }

    def validate_relationships(
        self, layer_id: Optional[str] = None, strict: bool = False
    ) -> Dict[str, Any]:
        """Validate relationships (cross-layer and intra-layer).

        Args:
            layer_id: Optional layer to validate (None = all layers)
            strict: Treat warnings as errors

        Returns:
            Validation results
        """
        # Run relationship validation
        report = self.relationship_validator.validate(layer_id=layer_id)

        # Print summary
        summary_lines = [
            "",
            "RELATIONSHIP VALIDATION SUMMARY",
            "=" * 80,
            f"Layers validated: {report.layers_validated}",
            f"Links validated: {report.links_validated}",
            f"Total issues: {report.total_issues}",
            f"  - Errors: {len(report.errors)} 🔴",
            f"  - Warnings: {len(report.warnings)} ⚠️",
            f"  - Info: {len(report.info)} ℹ️",
            "",
        ]

        if report.validation_passed:
            summary_lines.append("✅ PASSED" if not strict or not report.warnings else "❌ FAILED (strict mode)")
        else:
            summary_lines.append("❌ FAILED")

        print("\n".join(summary_lines))

        return {
            'status': 'success' if report.validation_passed else 'error',
            'errors': report.errors,
            'warnings': report.warnings,
            'info': report.info,
            'summary': {
                'layers_validated': report.layers_validated,
                'links_validated': report.links_validated,
                'total_issues': report.total_issues,
                'errors': len(report.errors),
                'warnings': len(report.warnings),
                'info': len(report.info),
                'validation_passed': report.validation_passed,
            },
        }

    def validate_structure(
        self, layer_id: Optional[str] = None, strict: bool = False
    ) -> Dict[str, Any]:
        """Validate documentation structure.

        Args:
            layer_id: Optional layer to validate (None = all layers)
            strict: Treat warnings as errors

        Returns:
            Validation results
        """
        if layer_id:
            reports = [self.structure_validator.validate_layer(layer_id)]
        else:
            reports = self.structure_validator.validate_all_layers()

        # Print summary
        total_errors = sum(len(r.errors) for r in reports)
        total_warnings = sum(len(r.warnings) for r in reports)
        total_infos = sum(len(r.infos) for r in reports)

        print(f"Validation Results:")
        print(f"  Layers validated: {len(reports)}")
        print(f"  Passed: {len([r for r in reports if r.passed])}")
        print(f"  Failed: {len([r for r in reports if not r.passed])}")
        print()
        print(f"Issues Found:")
        print(f"  🔴 Errors: {total_errors}")
        print(f"  ⚠️  Warnings: {total_warnings}")
        print(f"  ℹ️  Info: {total_infos}")

        # Collect all issues
        all_errors = []
        all_warnings = []
        all_infos = []

        for report in reports:
            for issue in report.errors:
                all_errors.append(f"{report.layer_id}: {issue.message}")
            for issue in report.warnings:
                all_warnings.append(f"{report.layer_id}: {issue.message}")
            for issue in report.infos:
                all_infos.append(f"{report.layer_id}: {issue.message}")

        passed = total_errors == 0 and (not strict or total_warnings == 0)

        return {
            'status': 'success' if passed else 'error',
            'errors': all_errors,
            'warnings': all_warnings,
            'info': all_infos,
            'reports': reports,
        }

    def generate_report(
        self, results: Dict[str, Any], format: str = 'markdown', output_path: Optional[Path] = None
    ) -> str:
        """Generate unified validation report.

        Args:
            results: Validation results
            format: Report format ('markdown' or 'json')
            output_path: Optional output file path

        Returns:
            Report content
        """
        if format == 'json':
            # Convert to JSON-serializable format
            json_results = {
                'summary': results.get('summary', {}),
                'markdown': {
                    'errors': results.get('markdown', {}).get('errors', []),
                    'warnings': results.get('markdown', {}).get('warnings', []),
                },
                'schemas': {
                    'errors': results.get('schemas', {}).get('errors', []),
                    'warnings': results.get('schemas', {}).get('warnings', []),
                },
                'relationships': {
                    'errors': results.get('relationships', {}).get('errors', []),
                    'warnings': results.get('relationships', {}).get('warnings', []),
                },
                'structure': {
                    'errors': results.get('structure', {}).get('errors', []),
                    'warnings': results.get('structure', {}).get('warnings', []),
                },
            }

            report = json.dumps(json_results, indent=2)
        else:
            # Markdown format
            lines = [
                "# Unified Validation Report",
                "",
                "## Summary",
                "",
                f"**Total Errors**: {results['summary']['total_errors']}",
                f"**Total Warnings**: {results['summary']['total_warnings']}",
                f"**Status**: {'✅ PASSED' if results['summary']['validation_passed'] else '❌ FAILED'}",
                "",
            ]

            # Add details for each validation type
            for validation_type in ['markdown', 'schemas', 'relationships', 'structure']:
                if validation_type in results:
                    data = results[validation_type]
                    lines.extend([
                        f"## {validation_type.title()} Validation",
                        "",
                        f"**Errors**: {len(data.get('errors', []))}",
                        f"**Warnings**: {len(data.get('warnings', []))}",
                        "",
                    ])

                    if data.get('errors'):
                        lines.append("### Errors")
                        for error in data['errors']:
                            lines.append(f"- {error}")
                        lines.append("")

                    if data.get('warnings'):
                        lines.append("### Warnings")
                        for warning in data['warnings']:
                            lines.append(f"- {warning}")
                        lines.append("")

            report = "\n".join(lines)

        # Write to file if output path provided
        if output_path:
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(report, encoding='utf-8')

        return report


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Unified Validation Tool for Documentation Robotics",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    # Validation type selection
    parser.add_argument('--all', action='store_true', help='Run all validations')
    parser.add_argument('--markdown', action='store_true', help='Validate markdown structure')
    parser.add_argument('--schemas', action='store_true', help='Validate JSON schemas')
    parser.add_argument('--relationships', action='store_true', help='Validate relationships')
    parser.add_argument('--structure', action='store_true', help='Validate documentation structure')

    # Filters
    parser.add_argument('--layer', help='Validate specific layer (e.g., 02-business)')

    # Output control
    parser.add_argument(
        '--output', type=Path, default=Path('reports/validation'),
        help='Output directory for reports'
    )
    parser.add_argument(
        '--format', choices=['markdown', 'json'], default='markdown',
        help='Report format'
    )
    parser.add_argument('--strict', action='store_true', help='Treat warnings as errors')
    parser.add_argument('--no-output', action='store_true', help='Skip writing report files')

    args = parser.parse_args()

    # Default to --all if no validation type specified
    if not any([args.all, args.markdown, args.schemas, args.relationships, args.structure]):
        args.all = True

    # Create validator
    validator = UnifiedValidator()

    # Run validation
    if args.all:
        results = validator.validate_all(args.layer, args.strict)
    else:
        results = {'summary': {'total_errors': 0, 'total_warnings': 0, 'validation_passed': True}}

        if args.markdown:
            results['markdown'] = validator.validate_markdown(args.layer)
            results['summary']['total_errors'] += len(results['markdown'].get('errors', []))
            results['summary']['total_warnings'] += len(results['markdown'].get('warnings', []))

        if args.schemas:
            results['schemas'] = validator.validate_schemas()
            results['summary']['total_errors'] += len(results['schemas'].get('errors', []))
            results['summary']['total_warnings'] += len(results['schemas'].get('warnings', []))

        if args.relationships:
            results['relationships'] = validator.validate_relationships(args.layer, args.strict)
            results['summary']['total_errors'] += len(results['relationships'].get('errors', []))
            results['summary']['total_warnings'] += len(results['relationships'].get('warnings', []))

        if args.structure:
            results['structure'] = validator.validate_structure(args.layer, args.strict)
            results['summary']['total_errors'] += len(results['structure'].get('errors', []))
            results['summary']['total_warnings'] += len(results['structure'].get('warnings', []))

        results['summary']['validation_passed'] = (
            results['summary']['total_errors'] == 0 and
            (not args.strict or results['summary']['total_warnings'] == 0)
        )

    # Generate and save report
    ext = 'json' if args.format == 'json' else 'md'
    output_file = args.output / f'validation-report.{ext}' if not args.no_output else None
    report = validator.generate_report(results, args.format, output_file)

    if not args.no_output:
        print()
        print("=" * 80)
        print(f"Report saved to: {output_file}")
        print("=" * 80)
        print()

    # Print final summary
    print("FINAL SUMMARY:")
    print(f"  Total Errors: {results['summary']['total_errors']}")
    print(f"  Total Warnings: {results['summary']['total_warnings']}")
    print(f"  Status: {'✅ PASSED' if results['summary']['validation_passed'] else '❌ FAILED'}")
    print()

    # Exit with appropriate code
    validation_passed = results['summary']['validation_passed']
    sys.exit(0 if validation_passed else 1)


if __name__ == '__main__':
    main()
