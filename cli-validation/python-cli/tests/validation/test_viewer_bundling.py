"""
Validation tests for viewer bundling.

These tests ensure that the documentation-robotics-viewer package is properly
bundled in releases. The viewer must be bundled before creating a release.

To bundle the viewer:
    python scripts/bundle_viewer.py

For more information, see the build documentation.
"""

from pathlib import Path

import pytest


class TestViewerBundling:
    """Validation tests for viewer bundling."""

    @pytest.fixture
    def viewer_dist_path(self) -> Path:
        """Get the path to the viewer dist directory."""
        # Get the package root (src/documentation_robotics)
        package_root = Path(__file__).parent.parent.parent / "src" / "documentation_robotics"
        return package_root / "viewer" / "dist"

    def test_viewer_dist_directory_exists(self, viewer_dist_path: Path):
        """Viewer dist directory must exist in package.

        The viewer must be bundled before creating a release. Without the bundled
        viewer, the CLI's visualization features will not work.

        To bundle the viewer:
            python scripts/bundle_viewer.py

        This downloads the latest viewer release from:
            https://github.com/tinkermonkey/documentation_robotics_viewer
        """
        assert viewer_dist_path.exists(), (
            f"Viewer dist directory not found: {viewer_dist_path}\n\n"
            "The viewer must be bundled before creating a release.\n"
            "To bundle the viewer:\n"
            "  python scripts/bundle_viewer.py\n\n"
            "This will download the latest viewer release from:\n"
            "  https://github.com/tinkermonkey/documentation_robotics_viewer\n\n"
            "For more information, see the build documentation."
        )

        assert (
            viewer_dist_path.is_dir()
        ), f"Viewer dist path exists but is not a directory: {viewer_dist_path}"

    def test_viewer_index_html_exists(self, viewer_dist_path: Path):
        """Viewer index.html must exist.

        The index.html file is the entry point for the web-based viewer.
        Without it, the visualization server cannot serve the UI.

        To bundle the viewer:
            python scripts/bundle_viewer.py
        """
        index_html = viewer_dist_path / "index.html"

        assert index_html.exists(), (
            f"Viewer index.html not found: {index_html}\n\n"
            "The viewer must be bundled before creating a release.\n"
            "To bundle the viewer:\n"
            "  python scripts/bundle_viewer.py\n\n"
            "Expected file structure:\n"
            "  viewer/dist/\n"
            "    index.html\n"
            "    assets/\n"
            "      *.js\n"
            "      *.css\n"
        )

        assert index_html.is_file(), f"Viewer index.html exists but is not a file: {index_html}"

    def test_viewer_has_required_assets(self, viewer_dist_path: Path):
        """Viewer must include required JavaScript and CSS assets.

        The viewer is a React application that requires bundled JavaScript
        and CSS files. Without these assets, the viewer cannot render.

        To bundle the viewer:
            python scripts/bundle_viewer.py
        """
        # Check for assets directory
        assets_dir = viewer_dist_path / "assets"
        assert assets_dir.exists(), (
            f"Viewer assets directory not found: {assets_dir}\n\n"
            "The viewer must be bundled before creating a release.\n"
            "To bundle the viewer:\n"
            "  python scripts/bundle_viewer.py\n\n"
            "Expected directory structure:\n"
            "  viewer/dist/\n"
            "    assets/\n"
            "      *.js   (JavaScript bundles)\n"
            "      *.css  (CSS stylesheets)\n"
        )

        # Check for JavaScript files
        js_files = list(assets_dir.glob("*.js"))
        assert len(js_files) > 0, (
            f"No JavaScript files found in {assets_dir}\n\n"
            "The viewer requires at least one JavaScript bundle file.\n"
            "To bundle the viewer:\n"
            "  python scripts/bundle_viewer.py\n\n"
            f"Contents of {assets_dir}:\n"
            f"  {list(assets_dir.iterdir())}"
        )

        # Check for CSS files
        css_files = list(assets_dir.glob("*.css"))
        assert len(css_files) > 0, (
            f"No CSS files found in {assets_dir}\n\n"
            "The viewer requires at least one CSS stylesheet file.\n"
            "To bundle the viewer:\n"
            "  python scripts/bundle_viewer.py\n\n"
            f"Contents of {assets_dir}:\n"
            f"  {list(assets_dir.iterdir())}"
        )

    def test_viewer_index_has_react_root(self, viewer_dist_path: Path):
        """Viewer index.html must have React root element.

        The viewer is a React application that mounts to a div with id="root".
        This test verifies that the index.html has the expected structure.

        To bundle the viewer:
            python scripts/bundle_viewer.py
        """
        index_html = viewer_dist_path / "index.html"

        # Read and verify index.html content
        try:
            content = index_html.read_text()
        except FileNotFoundError:
            pytest.fail(
                f"Viewer index.html not found: {index_html}\n\n"
                "The viewer must be bundled before creating a release.\n"
                "To bundle the viewer:\n"
                "  python scripts/bundle_viewer.py"
            )

        # Check for React root div
        assert '<div id="root">' in content or '<div id="root"></div>' in content, (
            f"Viewer index.html missing React root element\n\n"
            f'Expected to find: <div id="root"></div>\n'
            f"Index.html path: {index_html}\n\n"
            f"Content:\n{content[:500]}..."
        )

        # Check for script tags (bundled JavaScript)
        assert "<script" in content, (
            f"Viewer index.html missing script tags\n\n"
            f"The index.html should reference bundled JavaScript files.\n"
            f"Index.html path: {index_html}\n\n"
            f"Content:\n{content[:500]}..."
        )

    def test_viewer_bundle_is_complete(self, viewer_dist_path: Path):
        """Verify the viewer bundle is complete with all expected files.

        This is a comprehensive check that verifies the viewer bundle
        contains all necessary files for proper operation.
        """
        # Check for index.html
        assert (
            viewer_dist_path / "index.html"
        ).exists(), "Viewer bundle incomplete: index.html missing"

        # Check for assets directory
        assets_dir = viewer_dist_path / "assets"
        assert assets_dir.exists(), "Viewer bundle incomplete: assets/ directory missing"

        # Check for JavaScript files
        js_files = list(assets_dir.glob("*.js"))
        assert len(js_files) > 0, "Viewer bundle incomplete: no JavaScript files"

        # Check for CSS files
        css_files = list(assets_dir.glob("*.css"))
        assert len(css_files) > 0, "Viewer bundle incomplete: no CSS files"

        # Optional: Check for manifest.json (common in Vite builds)
        manifest_path = viewer_dist_path / "manifest.json"
        if not manifest_path.exists():
            # This is not a hard requirement, but log a warning
            import warnings

            warnings.warn(
                f"Viewer bundle may be incomplete: manifest.json not found at {manifest_path}"
            )

    def test_viewer_assets_are_not_empty(self, viewer_dist_path: Path):
        """Verify viewer asset files are not empty.

        Empty files would indicate a bundling failure.
        """
        index_html = viewer_dist_path / "index.html"
        assert index_html.stat().st_size > 100, (
            f"Viewer index.html appears to be empty or truncated\n"
            f"File size: {index_html.stat().st_size} bytes\n"
            f"Expected: > 100 bytes"
        )

        # Check JavaScript files are not empty
        assets_dir = viewer_dist_path / "assets"
        for js_file in assets_dir.glob("*.js"):
            assert js_file.stat().st_size > 100, (
                f"JavaScript file appears to be empty or truncated: {js_file.name}\n"
                f"File size: {js_file.stat().st_size} bytes\n"
                f"Expected: > 100 bytes"
            )

        # Check CSS files are not empty
        for css_file in assets_dir.glob("*.css"):
            assert css_file.stat().st_size > 0, (
                f"CSS file is empty: {css_file.name}\n"
                f"File size: {css_file.stat().st_size} bytes"
            )

    def test_pyproject_includes_viewer_dist(self):
        """Verify pyproject.toml includes viewer/dist in package data.

        The viewer dist directory must be included in the package data
        configuration so it gets bundled when the package is built.
        """
        pyproject_path = Path(__file__).parent.parent.parent / "pyproject.toml"
        assert pyproject_path.exists(), f"pyproject.toml not found: {pyproject_path}"

        content = pyproject_path.read_text()

        # Check for viewer/dist in package data
        assert "viewer/dist" in content, (
            "pyproject.toml missing viewer/dist in package data\n\n"
            "The [tool.setuptools.package-data] section must include:\n"
            "  documentation_robotics = [\n"
            "    ...\n"
            '    "viewer/dist/**/*",\n'
            "  ]\n"
        )
