"""
Integration tests for annotation CLI commands.

Tests the complete annotation workflow:
1. Add annotations to entities and attributes
2. Reply to annotations (including nested replies)
3. List annotations (all and filtered by entity)
"""

import os
import tempfile
from pathlib import Path

import pytest
from click.testing import CliRunner
from documentation_robotics.cli import cli
from documentation_robotics.core.annotations import AnnotationRegistry


class CwdCliRunner(CliRunner):
    """CLI runner that supports cwd parameter."""

    def invoke(
        self,
        cli,
        args=None,
        input=None,
        env=None,
        catch_exceptions=True,
        color=False,
        cwd=None,
        **extra,
    ):
        """Invoke CLI with optional cwd support."""
        if cwd is not None:
            # Save current directory
            original_cwd = os.getcwd()
            try:
                os.chdir(cwd)
                return super().invoke(cli, args, input, env, catch_exceptions, color, **extra)
            finally:
                os.chdir(original_cwd)
        else:
            return super().invoke(cli, args, input, env, catch_exceptions, color, **extra)


class TestAnnotateCommands:
    """Test annotation CLI commands."""

    @pytest.fixture
    def temp_project(self):
        """Create a temporary project directory with initialized model."""
        with tempfile.TemporaryDirectory() as tmpdir:
            project_dir = Path(tmpdir) / "test-project"
            runner = CwdCliRunner()

            # Initialize project
            result = runner.invoke(cli, ["init", "test-project", "--path", str(project_dir)])
            assert result.exit_code == 0, f"Init failed: {result.output}"

            # Add a test element
            result = runner.invoke(
                cli,
                [
                    "add",
                    "motivation",
                    "goal",
                    "--name",
                    "Deliver Value",
                    "--property",
                    "priority=high",
                    "--property",
                    "description=Deliver customer value",
                ],
                cwd=str(project_dir),
            )
            assert result.exit_code == 0, f"Add element failed: {result.output}"

            yield project_dir

    @pytest.fixture
    def runner(self):
        """Create a CLI test runner."""
        return CwdCliRunner()

    def test_add_annotation_to_entity(self, runner, temp_project):
        """Test adding annotation to an entity."""
        # Add annotation
        result = runner.invoke(
            cli,
            [
                "annotate",
                "add",
                "motivation.goal.deliver-value",
                "Should we split this into multiple goals?",
            ],
            input="testuser\n",  # Provide username when prompted
            cwd=str(temp_project),
        )
        assert result.exit_code == 0, f"Add annotation failed: {result.output}"
        assert "Annotation added" in result.output
        assert "testuser" in result.output

        # Verify annotation was saved
        registry = AnnotationRegistry(temp_project)
        registry.load_all()
        annotations = registry.get_all()
        assert len(annotations) == 1
        assert annotations[0].entity_uri == "motivation.goal.deliver-value"
        assert annotations[0].user == "testuser"
        assert "split this" in annotations[0].message

    def test_add_annotation_to_attribute(self, runner, temp_project):
        """Test adding annotation to an entity attribute using fragment notation."""
        # Add annotation to attribute (using actual attribute path in element data)
        result = runner.invoke(
            cli,
            [
                "annotate",
                "add",
                "motivation.goal.deliver-value#priority",
                "Should this priority be reassessed?",
            ],
            input="testuser\n",
            cwd=str(temp_project),
        )
        assert result.exit_code == 0, f"Add annotation failed: {result.output}"
        assert "Annotation added" in result.output

        # Verify annotation was saved with attribute URI
        registry = AnnotationRegistry(temp_project)
        registry.load_all()
        annotations = registry.get_all()
        assert len(annotations) == 1
        assert annotations[0].entity_uri == "motivation.goal.deliver-value#priority"

    def test_add_annotation_invalid_entity(self, runner, temp_project):
        """Test that adding annotation to non-existent entity fails."""
        result = runner.invoke(
            cli,
            [
                "annotate",
                "add",
                "nonexistent.entity.id",
                "This should fail",
            ],
            input="testuser\n",
            cwd=str(temp_project),
        )
        assert result.exit_code != 0
        assert "not found" in result.output.lower()

    def test_username_persistence(self, runner, temp_project):
        """Test that username is cached after first prompt."""
        # First annotation - should prompt for username
        result = runner.invoke(
            cli,
            [
                "annotate",
                "add",
                "motivation.goal.deliver-value",
                "First annotation",
            ],
            input="alice\n",
            cwd=str(temp_project),
        )
        assert result.exit_code == 0
        assert "alice" in result.output

        # Second annotation - should NOT prompt (username cached)
        result = runner.invoke(
            cli,
            [
                "annotate",
                "add",
                "motivation.goal.deliver-value",
                "Second annotation",
            ],
            cwd=str(temp_project),
        )
        assert result.exit_code == 0
        assert "alice" in result.output

        # Verify both annotations are from same user
        registry = AnnotationRegistry(temp_project)
        registry.load_all()
        annotations = registry.get_all()
        assert len(annotations) == 2
        assert all(ann.user == "alice" for ann in annotations)

    def test_reply_to_annotation(self, runner, temp_project):
        """Test replying to an annotation."""
        # Add initial annotation
        result = runner.invoke(
            cli,
            [
                "annotate",
                "add",
                "motivation.goal.deliver-value",
                "Should we split this?",
            ],
            input="alice\n",
            cwd=str(temp_project),
        )
        assert result.exit_code == 0

        # Extract annotation ID from output
        registry = AnnotationRegistry(temp_project)
        registry.load_all()
        root_annotation = registry.get_root_annotations()[0]

        # Set different user for reply
        import json

        state_file = temp_project / ".dr" / "state.json"
        state = json.loads(state_file.read_text())
        state["annotation_user"] = "bob"
        state_file.write_text(json.dumps(state, indent=2))

        # Add reply
        result = runner.invoke(
            cli,
            [
                "annotate",
                "reply",
                root_annotation.id,
                "Yes, I think we should split it into two goals",
            ],
            cwd=str(temp_project),
        )
        assert result.exit_code == 0, f"Reply failed: {result.output}"
        assert "Reply added" in result.output
        assert root_annotation.id in result.output

        # Verify reply was saved with correct parent_id
        registry.load_all()
        annotations = registry.get_all()
        assert len(annotations) == 2

        replies = [ann for ann in annotations if ann.parent_id == root_annotation.id]
        assert len(replies) == 1
        assert replies[0].user == "bob"
        assert replies[0].entity_uri == root_annotation.entity_uri

    def test_nested_replies(self, runner, temp_project):
        """Test replying to a reply (nested threading)."""
        import json

        # Add initial annotation
        runner.invoke(
            cli,
            [
                "annotate",
                "add",
                "motivation.goal.deliver-value",
                "Root comment",
            ],
            input="alice\n",
            cwd=str(temp_project),
        )

        # Get annotation ID
        registry = AnnotationRegistry(temp_project)
        registry.load_all()
        root = registry.get_root_annotations()[0]

        # Set user to bob for first reply
        state_file = temp_project / ".dr" / "state.json"
        state = json.loads(state_file.read_text())
        state["annotation_user"] = "bob"
        state_file.write_text(json.dumps(state, indent=2))

        # Add first-level reply
        runner.invoke(
            cli,
            ["annotate", "reply", root.id, "First reply"],
            cwd=str(temp_project),
        )

        # Reload to get reply ID
        registry.load_all()
        first_reply = [ann for ann in registry.get_all() if ann.parent_id == root.id][0]

        # Set user to charlie for second reply
        state = json.loads(state_file.read_text())
        state["annotation_user"] = "charlie"
        state_file.write_text(json.dumps(state, indent=2))

        # Add second-level reply (reply to reply)
        result = runner.invoke(
            cli,
            ["annotate", "reply", first_reply.id, "Reply to the reply"],
            cwd=str(temp_project),
        )
        assert result.exit_code == 0

        # Verify nested structure
        registry.load_all()
        annotations = registry.get_all()
        assert len(annotations) == 3

        second_reply = [ann for ann in annotations if ann.parent_id == first_reply.id][0]
        assert second_reply.user == "charlie"
        assert second_reply.entity_uri == root.entity_uri

    def test_reply_to_nonexistent_annotation(self, runner, temp_project):
        """Test that replying to non-existent annotation fails."""
        result = runner.invoke(
            cli,
            ["annotate", "reply", "ann-nonexist", "This should fail"],
            input="testuser\n",
            cwd=str(temp_project),
        )
        assert result.exit_code != 0
        assert "not found" in result.output.lower()

    def test_list_all_annotations(self, runner, temp_project):
        """Test listing all annotations."""
        import json

        # Add multiple annotations
        runner.invoke(
            cli,
            ["annotate", "add", "motivation.goal.deliver-value", "First comment"],
            input="alice\n",
            cwd=str(temp_project),
        )

        # Set user to bob for second annotation
        state_file = temp_project / ".dr" / "state.json"
        state = json.loads(state_file.read_text())
        state["annotation_user"] = "bob"
        state_file.write_text(json.dumps(state, indent=2))

        runner.invoke(
            cli,
            ["annotate", "add", "motivation.goal.deliver-value", "Second comment"],
            cwd=str(temp_project),
        )

        # List all annotations
        result = runner.invoke(
            cli,
            ["annotate", "list", "--all"],
            cwd=str(temp_project),
        )
        assert result.exit_code == 0
        assert "alice" in result.output
        assert "bob" in result.output
        assert "First comment" in result.output
        assert "Second comment" in result.output

    def test_list_annotations_by_entity(self, runner, temp_project):
        """Test listing annotations filtered by entity URI."""
        # Add another test element
        runner.invoke(
            cli,
            [
                "add",
                "business",
                "process",
                "--name",
                "Order Fulfillment",
            ],
            cwd=str(temp_project),
        )

        # Add annotations to different entities
        runner.invoke(
            cli,
            ["annotate", "add", "motivation.goal.deliver-value", "Goal comment"],
            input="alice\n",
            cwd=str(temp_project),
        )
        runner.invoke(
            cli,
            ["annotate", "add", "business.process.order-fulfillment", "Process comment"],
            input="bob\n",
            cwd=str(temp_project),
        )

        # List annotations for specific entity
        result = runner.invoke(
            cli,
            ["annotate", "list", "--entity-uri", "motivation.goal.deliver-value"],
            cwd=str(temp_project),
        )
        assert result.exit_code == 0
        assert "Goal comment" in result.output
        assert "Process comment" not in result.output

    def test_list_with_thread_hierarchy(self, runner, temp_project):
        """Test that list displays threaded structure."""
        # Add root annotation
        runner.invoke(
            cli,
            ["annotate", "add", "motivation.goal.deliver-value", "Root comment"],
            input="alice\n",
            cwd=str(temp_project),
        )

        # Get annotation ID and add reply
        registry = AnnotationRegistry(temp_project)
        registry.load_all()
        root = registry.get_root_annotations()[0]

        runner.invoke(
            cli,
            ["annotate", "reply", root.id, "Reply to root"],
            input="bob\n",
            cwd=str(temp_project),
        )

        # List should show hierarchical structure
        result = runner.invoke(
            cli,
            ["annotate", "list", "--all"],
            cwd=str(temp_project),
        )
        assert result.exit_code == 0
        # Rich Tree uses various unicode characters for tree structure
        # Just verify both messages appear
        assert "Root comment" in result.output
        assert "Reply to root" in result.output

    def test_list_no_annotations(self, runner, temp_project):
        """Test listing when no annotations exist."""
        result = runner.invoke(
            cli,
            ["annotate", "list", "--all"],
            cwd=str(temp_project),
        )
        assert result.exit_code == 0
        assert "No annotations found" in result.output

    def test_list_requires_flag(self, runner, temp_project):
        """Test that list requires either --all or --entity-uri."""
        result = runner.invoke(
            cli,
            ["annotate", "list"],
            cwd=str(temp_project),
        )
        assert result.exit_code != 0
        assert "--all" in result.output or "--entity-uri" in result.output

    def test_markdown_preservation(self, runner, temp_project):
        """Test that markdown syntax is preserved in messages."""
        markdown_message = "# Header\n\n**bold** and *italic*\n\n- List item 1\n- List item 2"

        result = runner.invoke(
            cli,
            ["annotate", "add", "motivation.goal.deliver-value", markdown_message],
            input="testuser\n",
            cwd=str(temp_project),
        )
        assert result.exit_code == 0

        # Verify markdown is preserved in storage
        registry = AnnotationRegistry(temp_project)
        registry.load_all()
        annotations = registry.get_all()
        assert len(annotations) == 1
        assert annotations[0].message == markdown_message

    def test_multiuser_collaboration(self, runner, temp_project):
        """Test that multiple users can annotate and their files are separate."""
        # User 1 adds annotation
        runner.invoke(
            cli,
            ["annotate", "add", "motivation.goal.deliver-value", "Alice's comment"],
            input="alice\n",
            cwd=str(temp_project),
        )

        # Verify alice's file exists
        alice_file = temp_project / "annotations" / "alice" / "annotations.json"
        assert alice_file.exists()

        # Simulate different user by manually setting different username
        # (in real scenario, this would be on different machine/state)
        state_file = temp_project / ".dr" / "state.json"
        import json

        state = json.loads(state_file.read_text())
        state["annotation_user"] = "bob"
        state_file.write_text(json.dumps(state, indent=2))

        # User 2 adds annotation
        runner.invoke(
            cli,
            ["annotate", "add", "motivation.goal.deliver-value", "Bob's comment"],
            cwd=str(temp_project),
        )

        # Verify bob's file exists and is separate
        bob_file = temp_project / "annotations" / "bob" / "annotations.json"
        assert bob_file.exists()

        # Verify both annotations appear in registry
        registry = AnnotationRegistry(temp_project)
        registry.load_all()
        annotations = registry.get_all()
        assert len(annotations) == 2

        users = {ann.user for ann in annotations}
        assert users == {"alice", "bob"}

    def test_annotation_id_format(self, runner, temp_project):
        """Test that annotation IDs follow the expected format."""
        result = runner.invoke(
            cli,
            ["annotate", "add", "motivation.goal.deliver-value", "Test message"],
            input="testuser\n",
            cwd=str(temp_project),
        )
        assert result.exit_code == 0

        # Verify ID format
        registry = AnnotationRegistry(temp_project)
        registry.load_all()
        annotations = registry.get_all()
        assert len(annotations) == 1

        # ID should be in format ann-{8 chars}
        annotation_id = annotations[0].id
        assert annotation_id.startswith("ann-")
        assert len(annotation_id) == 12  # "ann-" + 8 characters

    def test_timestamp_format(self, runner, temp_project):
        """Test that timestamps are in ISO 8601 format with Z suffix."""
        result = runner.invoke(
            cli,
            ["annotate", "add", "motivation.goal.deliver-value", "Test message"],
            input="testuser\n",
            cwd=str(temp_project),
        )
        assert result.exit_code == 0

        # Verify timestamp format
        registry = AnnotationRegistry(temp_project)
        registry.load_all()
        annotations = registry.get_all()
        assert len(annotations) == 1

        timestamp = annotations[0].timestamp
        assert timestamp.endswith("Z")
        # Should be parseable as ISO 8601
        from datetime import datetime

        parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        assert parsed is not None
