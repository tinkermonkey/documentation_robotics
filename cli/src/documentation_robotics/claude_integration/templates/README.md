# Customization Templates

This directory contains templates and examples for customizing your DR + Claude Code integration.

## Available Templates

### Custom Agents

- **`custom-agent-template.md`** - Template for creating new DR-specific agents
  - Use when you need specialized assistance for domain-specific tasks
  - Agents run in separate contexts with focused expertise

### Custom Commands

- **`custom-command-template.md`** - Template for creating new slash commands
  - Use for frequently-used operations you want quick access to
  - Commands are user-invoked (you type `/command-name`)

### Example Files

#### Hooks

- **`example-validation-hook.sh`** - Pre-tool-use validation hook
  - Validates JSON syntax before writing files
  - Prevents invalid DR model files
  - Checks required fields for DR elements
  - **NEW in v0.5.0**

#### Settings

- **`example-settings.json`** - Comprehensive settings for DR projects
  - Permission management (allow/ask/deny)
  - Hook configuration (SessionStart, PreToolUse, UserPromptSubmit)
  - Customization examples for different modes (strict, exploration, team)
  - **ENHANCED in v0.5.0**

#### Workflows

- **`workflow-examples.md`** - Collection of complete workflow examples
  - New project setup, code extraction, feature addition
  - Microservices, security audit, API-first development
  - Goal-driven architecture, refactoring, compliance

---

## Quick Start

### Creating a Custom Agent

1. **Copy the template:**

   ```bash
   cp .claude/templates/custom-agent-template.md .claude/agents/my-agent.md
   ```

2. **Edit the YAML frontmatter:**

   ```yaml
   ---
   name: my-domain-expert
   description: Expert in [your domain] architecture patterns
   tools: Read, Write, Bash, Grep, Glob
   ---
   ```

3. **Fill in the content**:
   - Overview of what the agent does
   - Capabilities and expertise
   - When to use this agent
   - Example workflows

4. **Test it:**

   ```
   User: Use my-domain-expert to analyze the architecture
   ```

### Creating a Custom Command

1. **Copy the template:**

   ```bash
   cp .claude/templates/custom-command-template.md .claude/commands/my-command.md
   ```

2. **Edit the YAML frontmatter:**

   ```yaml
   ---
   description: Brief description of what this command does
   argument-hint: "[param1] [param2]"
   ---
   ```

3. **Write the command instructions:**
   - What the command should do
   - Expected parameters
   - Output format

4. **Use it:**

   ```
   /my-command argument1 argument2
   ```

### Using Validation Hooks

1. **Copy validation hook to hooks directory:**

   ```bash
   mkdir -p .claude/hooks
   cp .claude/templates/example-validation-hook.sh .claude/hooks/validate-json.sh
   chmod +x .claude/hooks/validate-json.sh
   ```

2. **Configure in settings.json:**

   ```json
   {
     "hooks": {
       "PreToolUse": [
         {
           "matcher": "Write(.*\\.json$)",
           "hook": {
             "type": "command",
             "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/validate-json.sh"
           }
         }
       ]
     }
   }
   ```

3. **Test the hook:**
   - Try to write invalid JSON
   - Hook should block the operation with clear error message

### Customizing Settings

1. **Review the example:**

   ```bash
   cat .claude/templates/example-settings.json
   ```

2. **Copy relevant sections to your `.claude/settings.json`:**
   - Start with basic permissions
   - Add hooks as needed
   - Customize for your workflow

3. **Choose a mode:**
   - **Strict mode:** Ask before any changes (production models)
   - **Exploration mode:** Allow more operations (experimental projects)
   - **Team mode:** Enforce validation before prompts

---

## Best Practices

### For Custom Agents

- **Be specific:** Narrow focus = better expertise
- **Define clear boundaries:** When to use vs other agents
- **Document workflows:** Show example interactions
- **Test thoroughly:** Ensure agent behaves as expected
- **Share with team:** Useful agents benefit everyone

### For Custom Commands

- **Keep it simple:** Commands should do one thing well
- **Clear names:** Use descriptive, memorable names
- **Good hints:** argument-hint helps users know what to pass
- **Error handling:** Handle missing/invalid arguments gracefully
- **Documentation:** Explain what the command does and why

### For Hooks

- **Start simple:** Add hooks incrementally
- **Test in isolation:** Verify each hook works independently
- **Clear error messages:** Help users understand what went wrong
- **Performance:** Keep hooks fast (< 1 second)
- **Fail gracefully:** Don't break Claude Code if hook fails

### For Settings

- **Start permissive:** Begin with basic allows, add restrictions as needed
- **Document why:** Comment complex permission rules
- **Team alignment:** Ensure team members have compatible settings
- **Version control:** Commit `.claude/settings.json` for team projects
- **Regular review:** Update as project evolves

---

## Examples by Use Case

### Use Case 1: Strict Production Model

```json
{
  "permissions": {
    "ask": ["Write(**/*)", "Edit(**/*)", "Bash(dr *)"],
    "allow": ["Read(**/*)", "Grep(*)", "Glob(*)"]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write(*)",
        "hook": { "type": "command", "command": ".claude/hooks/validate-all.sh" }
      }
    ]
  }
}
```

### Use Case 2: Experimental/Exploration Mode

```json
{
  "permissions": {
    "allow": ["Bash(dr *)", "Write(*.dr/*)", "Edit(*.dr/*)"],
    "deny": ["Bash(rm -rf:*)", "Bash(sudo:*)"]
  }
}
```

### Use Case 3: Team Collaboration

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hook": {
          "type": "command",
          "command": "dr validate --strict && dr links validate"
        }
      }
    ]
  }
}
```

---

## Troubleshooting

### Custom Agent Not Found

**Problem:** Agent doesn't appear when invoked

**Solutions:**

- Check YAML frontmatter is valid (use online YAML validator)
- Ensure `name` field matches filename (e.g., `my-agent.md` → `name: my-agent`)
- Verify file is in `.claude/agents/` directory
- Restart Claude Code to reload agents

### Custom Command Not Working

**Problem:** `/my-command` doesn't autocomplete or run

**Solutions:**

- Check YAML frontmatter exists and is valid
- Ensure file is in `.claude/commands/` directory
- Verify description field is present
- Try restarting Claude Code

### Hook Not Executing

**Problem:** Hook doesn't run when expected

**Solutions:**

- Verify hook script is executable (`chmod +x hook.sh`)
- Check hook path in settings.json is correct
- Test hook manually: `cat input.json | ./hook.sh`
- Check matcher pattern (e.g., `Write(.*\\.json$)` for JSON files)
- Review Claude Code logs: `claude --debug`

### Permission Denied Errors

**Problem:** Operations blocked unexpectedly

**Solutions:**

- Review `deny` rules in settings.json
- Check if operation is in `ask` list (requires approval)
- Use more specific patterns (avoid overly broad denies)
- Test with minimal permissions first, then restrict

---

## Resources

- [Design Document](../../../docs/04_claude_code_integration_design.md) - Overall architecture
- [Developer Guide](../../../docs/claude-code-improvements-for-developers.md) - Improvement roadmap
- [User Guide](../USER_GUIDE.md) - Complete user guide
- [Reference Sheets](../reference_sheets/) - Quick reference
- [Existing Commands](../commands/) - Built-in command examples
- [Existing Agents](../agents/) - Built-in agent examples
- [Skills](../skills/) - Auto-activating capabilities

---

**Last Updated:** 2025-01-27
**Version:** 0.7.2+ (Spec v0.5.0)
