"""
Data quality metrics for APM/Observability layer.

This module provides support for tracking data quality metrics as specified
in the Documentation Robotics Specification. Data quality metrics
track completeness, accuracy, timeliness, and consistency of data.

Spec Requirement: Layer 11 (APM) must track data quality metrics and link
them to data model entities (Layer 07).
"""

import logging
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class DataQualityDimension(str, Enum):
    """Data quality dimensions as defined in the spec."""

    COMPLETENESS = "completeness"
    ACCURACY = "accuracy"
    TIMELINESS = "timeliness"
    CONSISTENCY = "consistency"
    VALIDITY = "validity"
    UNIQUENESS = "uniqueness"


class DataQualityMetric:
    """
    Represents a data quality metric.

    Tracks a specific quality dimension for a data entity.
    """

    def __init__(
        self,
        metric_id: str,
        name: str,
        dimension: DataQualityDimension,
        data_entity_ref: str,
        description: Optional[str] = None,
        threshold: Optional[float] = None,
        unit: str = "percentage",
    ):
        """
        Initialize a data quality metric.

        Args:
            metric_id: Unique identifier (e.g., "apm.metric.user-data-completeness")
            name: Human-readable name
            dimension: Quality dimension being measured
            data_entity_ref: Reference to data model entity (Layer 07)
            description: Optional description
            threshold: Optional acceptable threshold (e.g., 95.0 for 95%)
            unit: Unit of measurement (default: percentage)
        """
        self.metric_id = metric_id
        self.name = name
        self.dimension = dimension
        self.data_entity_ref = data_entity_ref
        self.description = (
            description or f"{dimension.value.capitalize()} metric for {data_entity_ref}"
        )
        self.threshold = threshold
        self.unit = unit
        self.measurements: List[DataQualityMeasurement] = []

    def add_measurement(
        self,
        value: float,
        timestamp: Optional[datetime] = None,
        context: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Add a measurement for this metric.

        Args:
            value: The measured value
            timestamp: When the measurement was taken (default: now)
            context: Optional context information
        """
        measurement = DataQualityMeasurement(
            value=value, timestamp=timestamp or datetime.now(), context=context or {}
        )
        self.measurements.append(measurement)

    def get_latest_value(self) -> Optional[float]:
        """Get the most recent measurement value."""
        if not self.measurements:
            return None
        return self.measurements[-1].value

    def is_below_threshold(self) -> bool:
        """Check if latest value is below threshold."""
        if self.threshold is None:
            return False
        latest = self.get_latest_value()
        if latest is None:
            return False
        return latest < self.threshold

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "id": self.metric_id,
            "type": "data-quality-metric",
            "name": self.name,
            "dimension": self.dimension.value,
            "dataEntityRef": self.data_entity_ref,
            "description": self.description,
            "threshold": self.threshold,
            "unit": self.unit,
            "latestValue": self.get_latest_value(),
            "measurementCount": len(self.measurements),
        }


class DataQualityMeasurement:
    """A single measurement of a data quality metric."""

    def __init__(self, value: float, timestamp: datetime, context: Dict[str, Any]):
        """
        Initialize a measurement.

        Args:
            value: The measured value
            timestamp: When the measurement was taken
            context: Additional context (e.g., sample size, method)
        """
        self.value = value
        self.timestamp = timestamp
        self.context = context

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "value": self.value,
            "timestamp": self.timestamp.isoformat(),
            "context": self.context,
        }


class DataQualityProfile:
    """
    A comprehensive quality profile for a data entity.

    Tracks all quality dimensions for a single data entity.
    """

    def __init__(self, data_entity_ref: str):
        """
        Initialize a quality profile.

        Args:
            data_entity_ref: Reference to the data entity
        """
        self.data_entity_ref = data_entity_ref
        self.metrics: Dict[DataQualityDimension, DataQualityMetric] = {}

    def add_metric(self, metric: DataQualityMetric) -> None:
        """Add a metric to the profile."""
        if metric.data_entity_ref != self.data_entity_ref:
            raise ValueError(
                f"Metric is for {metric.data_entity_ref}, "
                f"but profile is for {self.data_entity_ref}"
            )
        self.metrics[metric.dimension] = metric

    def get_metric(self, dimension: DataQualityDimension) -> Optional[DataQualityMetric]:
        """Get metric for a specific dimension."""
        return self.metrics.get(dimension)

    def get_overall_score(self) -> Optional[float]:
        """
        Calculate overall data quality score.

        Returns average of all dimension scores.
        """
        values = []
        for metric in self.metrics.values():
            latest = metric.get_latest_value()
            if latest is not None:
                values.append(latest)

        if not values:
            return None

        return sum(values) / len(values)

    def get_quality_issues(self) -> List[str]:
        """Get list of quality issues (dimensions below threshold)."""
        issues = []
        for dimension, metric in self.metrics.items():
            if metric.is_below_threshold():
                latest = metric.get_latest_value()
                issues.append(f"{dimension.value}: {latest:.1f}% (threshold: {metric.threshold}%)")
        return issues

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "dataEntityRef": self.data_entity_ref,
            "metrics": {dim.value: metric.to_dict() for dim, metric in self.metrics.items()},
            "overallScore": self.get_overall_score(),
            "issues": self.get_quality_issues(),
        }


def create_standard_quality_metrics(
    data_entity_ref: str,
    entity_name: str,
    thresholds: Optional[Dict[DataQualityDimension, float]] = None,
) -> List[DataQualityMetric]:
    """
    Create a standard set of quality metrics for a data entity.

    Args:
        data_entity_ref: Reference to the data entity
        entity_name: Human-readable entity name
        thresholds: Optional thresholds for each dimension

    Returns:
        List of DataQualityMetric instances
    """
    thresholds = thresholds or {
        DataQualityDimension.COMPLETENESS: 95.0,
        DataQualityDimension.ACCURACY: 98.0,
        DataQualityDimension.TIMELINESS: 90.0,
        DataQualityDimension.CONSISTENCY: 95.0,
    }

    metrics = []

    # Completeness metric
    if DataQualityDimension.COMPLETENESS in thresholds:
        metrics.append(
            DataQualityMetric(
                metric_id=f"apm.metric.{entity_name.lower().replace(' ', '-')}-completeness",
                name=f"{entity_name} Completeness",
                dimension=DataQualityDimension.COMPLETENESS,
                data_entity_ref=data_entity_ref,
                description=f"Percentage of required fields populated in {entity_name}",
                threshold=thresholds[DataQualityDimension.COMPLETENESS],
            )
        )

    # Accuracy metric
    if DataQualityDimension.ACCURACY in thresholds:
        metrics.append(
            DataQualityMetric(
                metric_id=f"apm.metric.{entity_name.lower().replace(' ', '-')}-accuracy",
                name=f"{entity_name} Accuracy",
                dimension=DataQualityDimension.ACCURACY,
                data_entity_ref=data_entity_ref,
                description=f"Percentage of accurate data values in {entity_name}",
                threshold=thresholds[DataQualityDimension.ACCURACY],
            )
        )

    # Timeliness metric
    if DataQualityDimension.TIMELINESS in thresholds:
        metrics.append(
            DataQualityMetric(
                metric_id=f"apm.metric.{entity_name.lower().replace(' ', '-')}-timeliness",
                name=f"{entity_name} Timeliness",
                dimension=DataQualityDimension.TIMELINESS,
                data_entity_ref=data_entity_ref,
                description=f"Percentage of {entity_name} records updated within SLA",
                threshold=thresholds[DataQualityDimension.TIMELINESS],
            )
        )

    # Consistency metric
    if DataQualityDimension.CONSISTENCY in thresholds:
        metrics.append(
            DataQualityMetric(
                metric_id=f"apm.metric.{entity_name.lower().replace(' ', '-')}-consistency",
                name=f"{entity_name} Consistency",
                dimension=DataQualityDimension.CONSISTENCY,
                data_entity_ref=data_entity_ref,
                description=f"Percentage of {entity_name} records consistent across systems",
                threshold=thresholds[DataQualityDimension.CONSISTENCY],
            )
        )

    return metrics


def calculate_completeness(entity_data: Dict[str, Any], required_fields: List[str]) -> float:
    """
    Calculate completeness percentage for an entity.

    Args:
        entity_data: The entity data
        required_fields: List of required field names

    Returns:
        Completeness percentage (0-100)
    """
    if not required_fields:
        return 100.0

    populated_count = 0
    for field in required_fields:
        value = entity_data.get(field)
        if value is not None and value != "":
            populated_count += 1

    return (populated_count / len(required_fields)) * 100.0


def calculate_accuracy(entity_data: Dict[str, Any], validation_rules: Dict[str, callable]) -> float:
    """
    Calculate accuracy percentage for an entity.

    Args:
        entity_data: The entity data
        validation_rules: Dict mapping field names to validation functions

    Returns:
        Accuracy percentage (0-100)
    """
    if not validation_rules:
        return 100.0

    accurate_count = 0
    for field, validator in validation_rules.items():
        value = entity_data.get(field)
        try:
            if validator(value):
                accurate_count += 1
        except Exception:
            # Validation failed
            pass

    return (accurate_count / len(validation_rules)) * 100.0


def calculate_timeliness(last_updated: datetime, max_age_hours: float = 24.0) -> float:
    """
    Calculate timeliness score based on data freshness.

    Args:
        last_updated: When the data was last updated
        max_age_hours: Maximum acceptable age in hours

    Returns:
        Timeliness percentage (0-100)
    """
    age_hours = (datetime.now() - last_updated).total_seconds() / 3600

    if age_hours <= max_age_hours:
        return 100.0
    elif age_hours <= max_age_hours * 2:
        # Degrade linearly to 0% at 2x max_age
        return max(0.0, 100.0 - ((age_hours - max_age_hours) / max_age_hours * 100.0))
    else:
        return 0.0
