"""
Caching system for improved performance.

Provides LRU caching for frequently accessed elements, layers, and query results.
"""

import hashlib
import json
import time
from functools import wraps
from typing import Any, Callable, Dict, Optional, TypeVar

T = TypeVar("T")


class ModelCache:
    """
    Centralized cache for model data.

    Provides multiple caching strategies:
    - Element cache: Frequently accessed elements
    - Query cache: Search and find results
    - Reference cache: Reference lookups
    - Statistics cache: Computed statistics
    """

    def __init__(self, max_size: int = 1000, ttl: int = 3600):
        """
        Initialize cache.

        Args:
            max_size: Maximum number of cached items
            ttl: Time-to-live in seconds (default: 1 hour)
        """
        self.max_size = max_size
        self.ttl = ttl

        # Cache stores
        self._element_cache: Dict[str, tuple[Any, float]] = {}
        self._query_cache: Dict[str, tuple[Any, float]] = {}
        self._reference_cache: Dict[str, tuple[Any, float]] = {}
        self._stats_cache: Dict[str, tuple[Any, float]] = {}

        # Cache statistics
        self.hits = 0
        self.misses = 0

    def get_element(self, element_id: str) -> Optional[Any]:
        """Get element from cache."""
        return self._get_from_cache(self._element_cache, element_id)

    def set_element(self, element_id: str, element: Any) -> None:
        """Store element in cache."""
        self._set_in_cache(self._element_cache, element_id, element)

    def get_query(self, query_key: str) -> Optional[Any]:
        """Get query result from cache."""
        return self._get_from_cache(self._query_cache, query_key)

    def set_query(self, query_key: str, result: Any) -> None:
        """Store query result in cache."""
        self._set_in_cache(self._query_cache, query_key, result)

    def get_references(self, element_id: str) -> Optional[Any]:
        """Get references from cache."""
        return self._get_from_cache(self._reference_cache, element_id)

    def set_references(self, element_id: str, references: Any) -> None:
        """Store references in cache."""
        self._set_in_cache(self._reference_cache, element_id, references)

    def get_stats(self, stats_key: str) -> Optional[Any]:
        """Get statistics from cache."""
        return self._get_from_cache(self._stats_cache, stats_key)

    def set_stats(self, stats_key: str, stats: Any) -> None:
        """Store statistics in cache."""
        self._set_in_cache(self._stats_cache, stats_key, stats)

    def _get_from_cache(self, cache: Dict, key: str) -> Optional[Any]:
        """Get value from specific cache with TTL check."""
        if key in cache:
            value, timestamp = cache[key]
            # Check if expired
            if time.time() - timestamp < self.ttl:
                self.hits += 1
                return value
            else:
                # Expired, remove from cache
                del cache[key]

        self.misses += 1
        return None

    def _set_in_cache(self, cache: Dict, key: str, value: Any) -> None:
        """Store value in specific cache with LRU eviction."""
        # Evict oldest if at max size
        if len(cache) >= self.max_size:
            # Remove oldest entry (simple FIFO for now)
            oldest_key = next(iter(cache))
            del cache[oldest_key]

        cache[key] = (value, time.time())

    def invalidate_element(self, element_id: str) -> None:
        """Invalidate cached element."""
        if element_id in self._element_cache:
            del self._element_cache[element_id]

    def invalidate_layer(self, layer_name: str) -> None:
        """Invalidate all elements in a layer."""
        keys_to_remove = [k for k in self._element_cache.keys() if k.startswith(f"{layer_name}.")]
        for key in keys_to_remove:
            del self._element_cache[key]

    def invalidate_queries(self) -> None:
        """Invalidate all cached queries."""
        self._query_cache.clear()

    def clear(self) -> None:
        """Clear all caches."""
        self._element_cache.clear()
        self._query_cache.clear()
        self._reference_cache.clear()
        self._stats_cache.clear()
        self.hits = 0
        self.misses = 0

    def get_hit_rate(self) -> float:
        """Calculate cache hit rate."""
        total = self.hits + self.misses
        if total == 0:
            return 0.0
        return self.hits / total

    def get_stats_summary(self) -> Dict[str, Any]:
        """Get cache statistics."""
        return {
            "hits": self.hits,
            "misses": self.misses,
            "hit_rate": self.get_hit_rate(),
            "element_cache_size": len(self._element_cache),
            "query_cache_size": len(self._query_cache),
            "reference_cache_size": len(self._reference_cache),
            "stats_cache_size": len(self._stats_cache),
            "total_cache_size": (
                len(self._element_cache)
                + len(self._query_cache)
                + len(self._reference_cache)
                + len(self._stats_cache)
            ),
        }


def make_query_key(**kwargs) -> str:
    """
    Create a cache key from query parameters.

    Args:
        **kwargs: Query parameters

    Returns:
        Hash string suitable for cache key
    """
    # Sort parameters for consistent hashing
    sorted_params = sorted(kwargs.items())
    # Convert to JSON string and hash
    params_str = json.dumps(sorted_params, sort_keys=True, default=str)
    return hashlib.md5(params_str.encode()).hexdigest()


def cached_method(cache_attr: str, key_func: Optional[Callable] = None):
    """
    Decorator for caching method results.

    Args:
        cache_attr: Name of cache attribute on the object (e.g., '_cache')
        key_func: Optional function to generate cache key from args

    Example:
        @cached_method('_cache', lambda self, id: f'element:{id}')
        def get_element(self, element_id: str):
            ...
    """

    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(self, *args, **kwargs):
            # Get cache instance
            cache = getattr(self, cache_attr, None)
            if cache is None:
                # No cache available, call function directly
                return func(self, *args, **kwargs)

            # Generate cache key
            if key_func:
                cache_key = key_func(self, *args, **kwargs)
            else:
                # Default: use function name and first arg
                if args:
                    cache_key = f"{func.__name__}:{args[0]}"
                else:
                    cache_key = func.__name__

            # Try to get from cache
            result = cache.get_query(cache_key)
            if result is not None:
                return result

            # Not in cache, call function
            result = func(self, *args, **kwargs)

            # Store in cache
            cache.set_query(cache_key, result)

            return result

        return wrapper

    return decorator


class LazyLoader:
    """
    Lazy loading helper for expensive operations.

    Wraps a loading function and only calls it when value is accessed.
    """

    def __init__(self, load_func: Callable[[], T]):
        """
        Initialize lazy loader.

        Args:
            load_func: Function to call when value is needed
        """
        self._load_func = load_func
        self._value: Optional[T] = None
        self._loaded = False

    @property
    def value(self) -> T:
        """Get the value, loading if necessary."""
        if not self._loaded:
            self._value = self._load_func()
            self._loaded = True
        return self._value

    def is_loaded(self) -> bool:
        """Check if value has been loaded."""
        return self._loaded

    def invalidate(self) -> None:
        """Invalidate cached value, forcing reload on next access."""
        self._loaded = False
        self._value = None


class LazyDict(dict):
    """
    Dictionary that supports lazy loading of values.

    Values are loaded only when accessed, and can be cached.
    """

    def __init__(self, load_func: Callable[[str], Any], cache: Optional[ModelCache] = None):
        """
        Initialize lazy dictionary.

        Args:
            load_func: Function that takes a key and returns the value
            cache: Optional cache for loaded values
        """
        super().__init__()
        self._load_func = load_func
        self._cache = cache
        self._loaded_keys = set()

    def __getitem__(self, key: str) -> Any:
        """Get item, loading if necessary."""
        # Check cache first
        if self._cache:
            cached = self._cache.get_element(key)
            if cached is not None:
                return cached

        # Check if already loaded in dict
        if key in self._loaded_keys:
            return super().__getitem__(key)

        # Load the value
        value = self._load_func(key)
        if value is not None:
            self[key] = value
            self._loaded_keys.add(key)

            # Store in cache
            if self._cache:
                self._cache.set_element(key, value)

        return value

    def get(self, key: str, default=None) -> Any:
        """Get item with default."""
        try:
            return self[key]
        except KeyError:
            return default

    def load_all(self) -> None:
        """Force loading of all values."""
        # This depends on having a way to get all keys
        # Subclasses should override if they can enumerate keys
        pass


# Global cache instance (can be configured)
_global_cache: Optional[ModelCache] = None


def get_global_cache() -> ModelCache:
    """Get or create global cache instance."""
    global _global_cache
    if _global_cache is None:
        _global_cache = ModelCache()
    return _global_cache


def clear_global_cache() -> None:
    """Clear the global cache."""
    global _global_cache
    if _global_cache:
        _global_cache.clear()


def configure_cache(max_size: int = 1000, ttl: int = 3600) -> ModelCache:
    """
    Configure the global cache.

    Args:
        max_size: Maximum number of cached items
        ttl: Time-to-live in seconds

    Returns:
        Configured cache instance
    """
    global _global_cache
    _global_cache = ModelCache(max_size=max_size, ttl=ttl)
    return _global_cache
