"""Pytest configuration and fixtures."""

import shutil
import tempfile
import warnings
from pathlib import Path

import pytest


@pytest.fixture(scope="session", autouse=True)
def configure_rich_for_tests():
    """Configure rich library for test environment to prevent resource warnings."""
    import os

    # Disable rich's terminal detection which can create subprocess transports
    # Set these BEFORE any rich imports to prevent file descriptor creation
    os.environ["TERM"] = "dumb"
    os.environ["NO_COLOR"] = "1"
    # Disable rich's auto-detection features
    os.environ["COLUMNS"] = "80"
    os.environ["LINES"] = "24"

    yield

    # Cleanup - close any rich console instances that may have been created
    import gc

    # Force garbage collection to clean up Console instances
    gc.collect()

    # Clean up environment variables
    os.environ.pop("TERM", None)
    os.environ.pop("NO_COLOR", None)
    os.environ.pop("COLUMNS", None)
    os.environ.pop("LINES", None)


@pytest.fixture
def temp_dir():
    """Create a temporary directory for tests."""
    temp_path = Path(tempfile.mkdtemp())
    yield temp_path
    shutil.rmtree(temp_path)


@pytest.fixture
def sample_element():
    """Create a sample element for testing."""
    from documentation_robotics.core.element import Element

    return Element(
        id="business.service.test-service",
        element_type="service",
        layer="business",
        data={
            "id": "business.service.test-service",
            "name": "Test Service",
            "description": "A test service",
            "documentation": "Test documentation",
        },
    )


@pytest.fixture
def sample_element_with_refs():
    """Create a sample element with references."""
    from documentation_robotics.core.element import Element

    return Element(
        id="application.service.test-app-service",
        element_type="service",
        layer="application",
        data={
            "id": "application.service.test-app-service",
            "name": "Test App Service",
            "realizes": "business.service.test-service",
            "uses": ["data_model.entity.customer", "data_model.entity.order"],
        },
    )


@pytest.fixture
def initialized_model(temp_dir):
    """Create an initialized model for testing."""
    from documentation_robotics.commands.init import ModelInitializer
    from documentation_robotics.core.model import Model

    # Suppress ResourceWarning during initialization
    # rich.Console can create subprocess transports for terminal detection
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=ResourceWarning)

        initializer = ModelInitializer(
            root_path=temp_dir,
            project_name="test-project",
            template="basic",
            minimal=False,
            with_examples=False,
        )
        initializer.create()

    model = Model(temp_dir)
    yield model

    # Ensure cleanup - close any open file handles
    # This helps prevent ResourceWarning about unclosed resources
    if hasattr(model, "__dict__"):
        for attr_name in list(model.__dict__.keys()):
            attr = getattr(model, attr_name, None)
            if hasattr(attr, "close"):
                try:
                    attr.close()
                except Exception:
                    pass


@pytest.fixture(autouse=True, scope="function")
def cleanup_threads_and_processes():
    """
    Cleanup threads and processes after each test to prevent resource warnings.

    This fixture runs after every test to ensure proper cleanup of:
    - Thread timers (from debouncing)
    - File observers (from watchdog)
    - Any other background threads/processes
    """
    import gc
    import threading

    yield

    # Force cleanup of any lingering timers
    for thread in threading.enumerate():
        if isinstance(thread, threading.Timer):
            if thread.is_alive():
                thread.cancel()

    # Force garbage collection to clean up any remaining resources
    gc.collect()
