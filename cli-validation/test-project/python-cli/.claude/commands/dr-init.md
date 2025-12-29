---
description: Initialize a new Documentation Robotics architecture model in the current project
argument-hint: "[project-name]"
---

# Initialize Documentation Robotics Model

Initialize a new Documentation Robotics architecture model in the current project.

## What This Command Does

1. Checks if a DR model already exists in the current directory
2. Prompts for project information (if not provided)
3. Runs `dr init` to create the model structure
4. Creates the 12-layer directory structure
5. Initializes manifest, config, and projection rules
6. Installs Claude Code integration files (if not already present)
7. Provides next steps and guidance

## Usage

```
/dr-init [project-name]
```

## Instructions for Claude Code

When the user runs this command, follow these steps:

### Step 1: Check for Existing Model

First, check if a DR project already exists:

```bash
ls -la dr.config.yaml 2>/dev/null
```

If the file exists:

- **STOP** and inform the user that a model already exists
- Ask if they want to:
  - View the existing model status (`dr validate`)
  - Reinitialize (warning: this may overwrite existing work)
  - Cancel the operation

If no model exists, proceed to Step 2.

### Step 2: Gather Project Information

If the user provided a project name in the command (e.g., `/dr-init my-project`), use that.

Otherwise, ask the user for:

1. **Project Name** (required)
   - Example: "E-Commerce Platform"
   - Will be used in manifest and documentation

2. **Include Examples?** (optional, default: no)
   - Yes: Creates example elements in each layer
   - No: Creates empty layer directories

3. **Template** (optional, default: basic)
   - basic: Standard 12-layer structure
   - minimal: Essential layers only
   - full: Includes examples and documentation

### Step 3: Run Initialization

Execute the `dr init` command:

```bash
dr init --name "<project-name>" [--with-examples] [--template <template>]
```

Examples:

```bash
# Basic initialization
dr init --name "My Project"

# With examples
dr init --name "My Project" --with-examples

# Minimal structure
dr init --name "My Project" --template minimal
```

### Step 4: Verify Initialization

Check that the model was created successfully:

```bash
ls -la .dr/
ls -la .dr/manifest.json
cat .dr/manifest.json
```

Show the user:

- ✓ Directory structure created
- ✓ Manifest initialized
- ✓ Configuration files created

### Step 5: Install Claude Integration (if needed)

Check if Claude Code integration is already installed:

```bash
ls -la .claude/.dr-version 2>/dev/null
```

If not installed, ask the user:

> "Would you like to install Claude Code integration files (slash commands, agents, skills)?"

If yes:

```bash
dr claude install
```

If already installed:

- Inform the user that integration is already set up
- Suggest running `dr claude update` if they want the latest version

### Step 6: Provide Next Steps

Display a helpful summary:

```
✓ Documentation Robotics model initialized successfully!

Project: <project-name>
Location: ./.dr/

Next steps:
1. Add your first element:
   dr add business service --name "My Service"

2. Validate the model:
   dr validate

3. Use natural language to model:
   /dr-model Add a payment service to the business layer

4. Extract from existing code:
   /dr-ingest ./src --layers business,application,api

5. Learn more:
   - Run: dr --help
   - Use natural language commands with /dr-model, /dr-validate, etc.
   - Ask the dr-advisor agent for guidance on modeling decisions
```

## Example Interactions

### Example 1: Simple Initialization

**User:** `/dr-init E-Commerce Platform`

**You should:**

1. Check no model exists
2. Run: `dr init --name "E-Commerce Platform"`
3. Verify creation
4. Ask about Claude integration
5. Show next steps

### Example 2: With User Prompting

**User:** `/dr-init`

**You should:**

1. Check no model exists
2. Ask: "What should I call this project?"
3. User responds: "Payment Gateway"
4. Ask: "Include example elements? (yes/no)"
5. User responds: "no"
6. Run: `dr init --name "Payment Gateway"`
7. Verify creation
8. Ask about Claude integration
9. Show next steps

### Example 3: Model Already Exists

**User:** `/dr-init New Project`

**You should:**

1. Check `dr.config.yaml` exists
2. Inform user: "A DR model already exists in this directory"
3. Show current model info:

   ```bash
   cat .dr/manifest.json | grep -E "name|version"
   dr validate
   ```

4. Ask what they want to do:
   - View current model
   - Reinitialize (with warning)
   - Cancel

## Error Handling

### Error: Directory not writable

```
Error: Permission denied creating configuration

Suggested fix: Check directory permissions
chmod +w .
```

### Error: Invalid project name

```
Error: Project name cannot be empty

Please provide a valid project name.
```

### Error: Dependencies missing

```
Error: DR CLI not found

Please ensure Documentation Robotics is installed:
npm install -g @documentation-robotics/cli

Or from source:
cd cli && npm install && npm run build && npm install -g .
```

## Important Notes

- Always check for existing models before initializing
- Default to basic template unless user specifies otherwise
- Offer to install Claude integration (but don't force it)
- Provide clear next steps tailored to what the user might want to do
- Use natural, conversational language
- Show command output to build user confidence

## Related Commands

- `/dr-model` - Add elements using natural language
- `/dr-ingest` - Extract model from existing codebase
- `/dr-validate` - Validate the model
- `dr --help` - View all available commands
