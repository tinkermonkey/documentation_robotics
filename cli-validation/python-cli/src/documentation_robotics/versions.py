"""
Single source of truth for all version information.

This module is the ONLY place where version numbers should be defined.
All other modules must import from here.

Version Management Rules:
1. CLI version increments with each CLI release
2. Spec version tracks which spec release this CLI implements
3. Viewer version tracks the bundled visualization server version
4. When releasing, update versions here ONLY

Release Coordination:
- Spec releases happen first (create spec-vX.Y.Z tag)
- CLI releases reference existing spec releases (update SPEC_VERSION)
- prepare_build.py fetches schemas matching SPEC_VERSION
"""

# CLI Version - Increment with each CLI release
# Format: MAJOR.MINOR.PATCH following semver.org
# ⚠️ v0.8.0 IS THE FINAL RELEASE - Python CLI is deprecated
CLI_VERSION = "0.8.0"

# Specification Version - Which spec version this CLI implements
# Must match an existing spec release tag (spec-vX.Y.Z)
# Update this when adopting a new spec version
SPEC_VERSION = "0.6.0"

# Viewer Version - Version of bundled visualization server
# Increment when viewer functionality changes
VIEWER_VERSION = "0.1.0"

# Conformance Level - How completely this CLI implements the spec
# Options: "basic", "standard", "full"
CONFORMANCE_LEVEL = "full"

# GitHub repository configuration for fetching schemas
GITHUB_CONFIG = {
    "owner": "tinkermonkey",
    "repo": "documentation_robotics",
    "release_tag_prefix": "spec-v",  # Tags are formatted as spec-v{version}
}

# Backward compatibility aliases
__version__ = CLI_VERSION  # Used by click.version_option and package metadata
__spec_version__ = SPEC_VERSION  # Used by manifest creation
__viewer_version__ = VIEWER_VERSION  # Used by viewer module
