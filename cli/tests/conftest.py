"""Pytest configuration and fixtures."""

import shutil
import tempfile
from pathlib import Path

import pytest
from documentation_robotics.core.element import Element
from documentation_robotics.core.model import Model


@pytest.fixture
def temp_dir():
    """Create a temporary directory for tests."""
    temp_path = Path(tempfile.mkdtemp())
    yield temp_path
    shutil.rmtree(temp_path)


@pytest.fixture
def sample_element():
    """Create a sample element for testing."""
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

    initializer = ModelInitializer(
        root_path=temp_dir,
        project_name="test-project",
        template="basic",
        minimal=False,
        with_examples=False,
    )
    initializer.create()

    return Model(temp_dir)
