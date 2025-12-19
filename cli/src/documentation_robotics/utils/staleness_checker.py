"""Utilities for checking staleness of source references."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from .source_ref_utils import get_repository_info, get_source_locations, get_source_reference


@dataclass
class StaleSourceRef:
    """Represents a stale source reference."""

    element_id: str
    element_name: str
    source_file: Optional[str]
    source_symbol: Optional[str]
    commit_sha: Optional[str]
    commit_date: Optional[datetime]
    days_old: int
    repository_url: Optional[str]


def parse_threshold(threshold_str: str) -> timedelta:
    """
    Parse a threshold string into a timedelta.

    Args:
        threshold_str: Threshold string like "90days", "6months", "1year"

    Returns:
        timedelta object

    Raises:
        ValueError: If format is invalid
    """
    import re

    match = re.match(r"^(\d+)(days?|weeks?|months?|years?)$", threshold_str.lower())
    if not match:
        raise ValueError(
            f"Invalid threshold format: {threshold_str}. "
            "Use format like '90days', '6months', '1year'"
        )

    amount = int(match.group(1))
    unit = match.group(2).lower()

    if unit in ("day", "days"):
        return timedelta(days=amount)
    elif unit in ("week", "weeks"):
        return timedelta(weeks=amount)
    elif unit in ("month", "months"):
        return timedelta(days=amount * 30)
    elif unit in ("year", "years"):
        return timedelta(days=amount * 365)
    else:
        raise ValueError(f"Unknown time unit: {unit}")


def get_commit_date(element_data: Dict[str, Any]) -> Optional[datetime]:
    """
    Extract commit date from element's repository info.

    Note: This looks for a commit timestamp in the data.
    In a real implementation, this would query the git repository.

    Args:
        element_data: Element data dictionary

    Returns:
        datetime object if commit date found, None otherwise
    """
    repo_info = get_repository_info(element_data)
    if not repo_info:
        return None

    # Check for stored timestamp
    if "timestamp" in repo_info:
        timestamp = repo_info.get("timestamp")
        try:
            if isinstance(timestamp, str):
                return datetime.fromisoformat(timestamp)
            elif isinstance(timestamp, (int, float)):
                return datetime.fromtimestamp(timestamp)
        except (ValueError, OSError):
            pass

    # Check for commit date field
    if "date" in repo_info:
        date_str = repo_info.get("date")
        try:
            if isinstance(date_str, str):
                return datetime.fromisoformat(date_str)
        except ValueError:
            pass

    return None


def check_staleness(
    elements: List[Any],
    threshold: str = "90days",
    reference_date: Optional[datetime] = None,
) -> List[StaleSourceRef]:
    """
    Check for stale source references in elements.

    Args:
        elements: List of Element objects
        threshold: Staleness threshold (e.g., "90days", "6months")
        reference_date: Date to measure staleness from (defaults to now)

    Returns:
        List of StaleSourceRef objects for stale elements

    Raises:
        ValueError: If threshold format is invalid
    """
    if reference_date is None:
        reference_date = datetime.now()

    threshold_delta = parse_threshold(threshold)
    stale_threshold_date = reference_date - threshold_delta
    stale_refs: List[StaleSourceRef] = []

    for element in elements:
        # Get element data - handle both Element objects and dicts
        if hasattr(element, "data"):
            element_data = element.data
            element_id = getattr(element, "id", "unknown")
        elif isinstance(element, dict):
            element_data = element
            element_id = element.get("id", "unknown")
        else:
            continue

        # Get source reference
        source_ref = get_source_reference(element_data)
        if not source_ref:
            continue

        # Get repository info with commit
        repo_info = get_repository_info(element_data)
        if not repo_info or "commit" not in repo_info:
            continue

        # Try to get commit date
        commit_date = get_commit_date(element_data)
        if not commit_date:
            # If no stored timestamp, we would need to query git
            # For now, skip this element
            continue

        # Check if stale
        if commit_date < stale_threshold_date:
            # Get source location info
            locations = get_source_locations(element_data)
            source_file = None
            source_symbol = None
            if locations:
                source_file = locations[0].get("file")
                source_symbol = locations[0].get("symbol")

            element_name = element_data.get("name", "unknown")
            days_old = (reference_date - commit_date).days

            stale_refs.append(
                StaleSourceRef(
                    element_id=element_id,
                    element_name=element_name,
                    source_file=source_file,
                    source_symbol=source_symbol,
                    commit_sha=repo_info.get("commit", "unknown")[:8],
                    commit_date=commit_date,
                    days_old=days_old,
                    repository_url=repo_info.get("url"),
                )
            )

    return stale_refs


def format_stale_report(
    stale_refs: List[StaleSourceRef],
    total_elements_with_sources: int,
) -> str:
    """
    Format stale source references for display.

    Args:
        stale_refs: List of StaleSourceRef objects
        total_elements_with_sources: Total number of elements with source refs

    Returns:
        Formatted report string
    """
    if not stale_refs:
        return "✓ No stale source links found"

    lines = ["⚠ Stale source links:\n"]

    for ref in stale_refs:
        lines.append(f"  {ref.element_id}")
        if ref.element_name:
            lines.append(f"    Name: {ref.element_name}")
        if ref.source_file:
            location = ref.source_file
            if ref.source_symbol:
                location += f" ({ref.source_symbol})"
            lines.append(f"    Source: {location}")
        if ref.commit_sha:
            commit_str = f"{ref.commit_sha}"
            if ref.commit_date:
                commit_str += f" ({ref.commit_date.date()} - {ref.days_old} days old)"
            lines.append(f"    Commit: {commit_str}")
        lines.append(f"    Recommendation: Re-ingest or verify manually")
        lines.append("")

    lines.append(
        f"Summary: {len(stale_refs)}/{total_elements_with_sources} source links are stale"
    )

    return "\n".join(lines)
