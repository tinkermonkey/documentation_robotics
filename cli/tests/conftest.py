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


@pytest.fixture(scope="function")
async def cleanup_async_resources():
    """
    Cleanup async resources after async tests to prevent resource warnings.

    Use this fixture explicitly in async tests that spawn subprocesses or async generators.
    This ensures proper cleanup of:
    - Async generators that may have spawned subprocesses
    - Event loop transport cleanup callbacks

    Usage:
        async def test_my_async_test(cleanup_async_resources):
            # test code
    """
    import asyncio
    import gc

    yield

    # Force garbage collection to clean up any remaining resources
    # This includes async generators that might be holding subprocess references
    gc.collect()

    # Give event loop time to process pending transport cleanup callbacks
    # After async tests close generators/subprocesses, asyncio schedules callbacks
    # to close transports. Without this sleep, pytest may close the event loop before
    # these callbacks run, causing ResourceWarning about unclosed transports.
    await asyncio.sleep(0.01)  # Reduced from 0.2s to 10ms


@pytest.fixture(autouse=True, scope="function")
def cleanup_threads():
    """
    Cleanup threads after each test to prevent resource warnings.

    This fixture runs after every test to ensure proper cleanup of:
    - Thread timers (from debouncing)
    - File observers (from watchdog)
    - Subprocess transports (from watchdog PollingObserver)
    """
    import asyncio
    import gc
    import threading
    import time
    import warnings

    yield

    # Force cleanup of any lingering timers
    for thread in threading.enumerate():
        if isinstance(thread, threading.Timer):
            if thread.is_alive():
                thread.cancel()

    # Force garbage collection to clean up references
    gc.collect()

    # Give subprocess cleanup callbacks a chance to run
    # This is especially important for watchdog PollingObserver which uses Popen
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # If loop is running, we can't use run_until_complete
            # Just wait a bit for callbacks to process
            time.sleep(0.05)
        else:
            # If loop exists but isn't running, try to process pending callbacks
            # Use warnings context to suppress expected BaseSubprocessTransport errors
            with warnings.catch_warnings():
                # Suppress expected warnings from subprocess cleanup
                warnings.filterwarnings("ignore", category=ResourceWarning)
                warnings.filterwarnings(
                    "ignore",
                    message="Exception ignored in.*BaseSubprocessTransport",
                    category=Warning,
                )
                try:
                    loop.run_until_complete(asyncio.sleep(0.05))
                except RuntimeError:
                    # Event loop may be closed - just wait instead
                    time.sleep(0.05)
    except (RuntimeError, AttributeError):
        # No event loop or other asyncio issues - just wait
        time.sleep(0.05)

    # Final garbage collection pass
    gc.collect()


class MockElement:
    """Mock Element for testing source reference utilities."""

    def __init__(self, element_id_or_data, data=None):
        """
        Initialize mock element.

        Supports two signatures:
        - MockElement(data_dict) - for tests that only need data
        - MockElement(element_id, data_dict) - for tests that need both
        """
        if data is None:
            # Single argument: treat as data
            self.data = element_id_or_data
            self.id = "mock-element"
        else:
            # Two arguments: element_id and data
            self.id = element_id_or_data
            self.data = data
