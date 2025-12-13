# Claude Agent SDK Installation & Detection

## Overview

The DrBot chat functionality requires the Claude Agent SDK. The CLI has built-in detection and helpful error messages to guide users through installation.

## How SDK Detection Works

### 1. When Starting the Server (`dr visualize`)

The visualize command checks for the SDK at startup and displays a clear message:

**✅ SDK Installed:**
```
Starting visualization server...

✓ Model loaded successfully (12 layers)
✓ Claude Agent SDK available (v0.1.0)
   Chat functionality (DrBot) is enabled

✓ Visualization server started
```

**⚠️ SDK Not Installed:**
```
Starting visualization server...

✓ Model loaded successfully (12 layers)

⚠ Warning: Claude Agent SDK not installed
   Chat functionality (DrBot) will not be available.
   To enable chat, install the SDK:
   pip install claude-agent-sdk

✓ Visualization server started
```

The server still starts successfully, but chat features are disabled.

### 2. When Using Chat (`dr chat`)

If you try to send a message when the SDK is not installed, you'll get:

```
You: List all services

✗ Error -32001: Claude Agent SDK not installed. Run: pip install claude-agent-sdk
```

The error is immediate and actionable.

### 3. Detection Logic

The SDK detector (`src/documentation_robotics/server/sdk_detector.py`) checks:

1. **Import availability** - Can we import `claude_agent_sdk`?
2. **Version detection** - What version is installed?
3. **Error reporting** - What went wrong if unavailable?

```python
from documentation_robotics.server.sdk_detector import detect_claude_agent_sdk

status = detect_claude_agent_sdk()

if status.available:
    print(f"SDK version: {status.version}")
else:
    print(f"Error: {status.error}")
```

## Installation

### Basic Installation

```bash
pip install claude-agent-sdk
```

### Development Installation

If you're developing the DR CLI:

```bash
cd cli
pip install -e ".[dev]"
```

This includes the SDK in the dev dependencies (if configured).

### Verify Installation

After installing, verify it worked:

```bash
python -c "import claude_agent_sdk; print('SDK installed successfully')"
```

Expected output:
```
SDK installed successfully
```

### Check Version

```bash
python -c "import claude_agent_sdk; print(f'Version: {claude_agent_sdk.__version__}')"
```

## Troubleshooting

### "ModuleNotFoundError: No module named 'claude_agent_sdk'"

**Problem:** SDK not installed in the current environment

**Solutions:**

1. **Check you're in the right virtual environment:**
   ```bash
   which python  # Should point to your venv
   ```

2. **Install the SDK:**
   ```bash
   pip install claude-agent-sdk
   ```

3. **Verify installation:**
   ```bash
   pip list | grep claude-agent-sdk
   ```

### SDK Installed But Still Getting Errors

**Problem:** SDK installed in different Python environment

**Solutions:**

1. **Check Python version:**
   ```bash
   python --version
   ```

2. **Reinstall in correct environment:**
   ```bash
   # Activate your virtual environment first
   source .venv/bin/activate
   pip install claude-agent-sdk
   ```

3. **Check import path:**
   ```bash
   python -c "import sys; import claude_agent_sdk; print(claude_agent_sdk.__file__)"
   ```

### "Chat functionality will not be available"

**Problem:** Warning shown when starting server

**This is not an error!** The server works fine, but chat features are disabled.

**To enable chat:**
```bash
pip install claude-agent-sdk
# Then restart the server
dr visualize
```

## Component Checklist

Here's where SDK availability is checked:

- ✅ **`sdk_detector.py`** - Core detection logic with error messages
- ✅ **`visualize.py`** - Checks at startup, shows warning if unavailable
- ✅ **`chat_handler.py`** - Returns error on chat requests if SDK missing
- ✅ **`drbot_orchestrator.py`** - Gracefully handles missing SDK
- ✅ **Test files** - Skip SDK-dependent tests if not available

## User Experience Flow

### New User (SDK not installed)

1. **Runs `dr visualize`:**
   - ⚠️ Sees warning that chat is disabled
   - ✓ Server starts successfully
   - 💡 Sees installation command

2. **Tries to chat anyway:**
   - ✗ Gets clear error: "SDK not installed"
   - 💡 Error includes installation command

3. **Installs SDK:**
   ```bash
   pip install claude-agent-sdk
   ```

4. **Restarts server:**
   - ✓ Sees "Claude Agent SDK available"
   - ✓ Chat now works

### Experienced User (SDK installed)

1. **Runs `dr visualize`:**
   - ✓ Sees "SDK available (v0.1.0)"
   - ✓ Chat enabled message

2. **Uses chat:**
   - ✓ Everything works seamlessly

## For Developers

### Adding SDK Checks to New Features

If you're adding a feature that requires the SDK:

```python
from documentation_robotics.server.sdk_detector import detect_claude_agent_sdk

def my_chat_feature():
    """New feature that needs the SDK."""
    status = detect_claude_agent_sdk()

    if not status.available:
        print(f"Error: {status.error}")
        return

    # Your SDK-dependent code here
    from claude_agent_sdk import query
    # ...
```

### Testing Without SDK

Tests automatically skip when SDK is unavailable:

```python
import pytest
from documentation_robotics.server.drbot_orchestrator import HAS_SDK

@pytest.mark.skipif(not HAS_SDK, reason="Claude Agent SDK not installed")
def test_chat_feature():
    """Test that requires SDK."""
    # This test is skipped if SDK not available
```

### Making SDK Optional

The SDK is **required** for chat features but **optional** for the CLI overall:

- ✅ `dr init`, `dr add`, `dr list`, etc. work without SDK
- ✅ `dr visualize` works without SDK (but chat disabled)
- ❌ `dr chat` requires SDK to be useful
- ❌ DrBot features require SDK

## FAQ

**Q: Do I need the SDK to use the DR CLI?**
A: No, only for chat features. All other CLI commands work without it.

**Q: Can I use `dr visualize` without the SDK?**
A: Yes! The visualization server works fine. Only the chat endpoint is disabled.

**Q: What happens if I try to chat without the SDK?**
A: You'll get a clear error message with installation instructions.

**Q: Does the SDK cost money?**
A: The SDK itself is free, but using Claude's API may incur costs based on usage.

**Q: Can I use a different LLM instead of Claude?**
A: Not currently. DrBot is specifically designed for the Claude Agent SDK.

**Q: Where is the SDK source code?**
A: The Claude Agent SDK is maintained separately. Check the [Claude documentation](https://docs.anthropic.com/) for details.

## Related Documentation

- [Chat Quick Start](./CHAT_QUICKSTART.md) - Getting started with chat
- [Chat Test Harness](./chat-test-harness.md) - Technical details
- [DrBot README](../DRBOT_README.md) - Full DrBot documentation
