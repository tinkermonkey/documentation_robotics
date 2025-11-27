---
description: Use natural language to create, manage, and apply isolated changes to the architecture model using changesets
argument-hint: "<natural language request>"
---

# Changeset Management

Use natural language to create, manage, and apply isolated changes to the architecture model using changesets.

## What This Command Does

Interprets natural language requests for changeset operations:

- Create new changesets for isolated work
- Check and switch active changesets
- Review changeset status and changes
- Compare changesets
- Apply or abandon changesets
- Manage multiple changesets in parallel

## Usage

```
/dr-changeset <natural language request>
```

## Instructions for Claude Code

When the user runs this command, interpret their intent and execute the appropriate changeset operations. Always:

1. **Check Context**: Determine if a changeset is currently active
2. **Parse Intent**: Understand what changeset operation they want
3. **Propose Action**: Show what you plan to do
4. **Execute**: Run the appropriate `dr changeset` commands
5. **Confirm**: Verify the operation succeeded
6. **Guide Next Steps**: Suggest appropriate follow-up actions

### Critical Decision Points

#### When to Create a Changeset

**CREATE a changeset when:**

- User explicitly asks to create one
- User wants to explore or experiment ("what if...", "let's try...", "prototype...")
- Building a new feature that spans multiple elements
- Making speculative changes they might want to undo
- Working on alternatives to compare

**DON'T create a changeset when:**

- Making simple, final changes to existing elements
- User explicitly says "make this permanent" or "update the main model"
- Fixing obvious typos or errors
- Making requested corrections to recent changes

#### When to Check for Active Changeset

**ALWAYS check at the start of any modeling session** to inform the user:

```bash
# Check if changeset is active
dr changeset list | grep "►"  # Active changeset marked with ►

# Or check active file directly
if [ -f .dr/changesets/active ]; then
  echo "Working in changeset: $(cat .dr/changesets/active)"
fi
```

**Inform the user:**

- "You're currently working in changeset: [name]"
- "All changes will be tracked in this changeset"
- "Use /dr-changeset apply to merge to main model"

#### When to Switch Changesets

**SWITCH changesets when:**

- User asks to work on a different feature
- User wants to compare with another changeset
- User explicitly requests to switch
- Returning to previously abandoned work

**DON'T automatically switch when:**

- User has uncommitted thoughts in current changeset
- Current changeset has unreviewed changes

#### When to Apply/Merge Changeset

**APPLY changeset when:**

- User explicitly says "apply", "merge", "commit", "make it permanent"
- Feature is complete and user confirms
- Changes have been reviewed and validated

**ALWAYS before applying:**

1. Show preview: `dr changeset status --verbose`
2. Run validation: `dr validate`
3. Get explicit confirmation
4. Apply with preview: `dr changeset apply --preview` (first)
5. Then apply for real: `dr changeset apply --yes`

### Supported Operations

#### 1. Create New Changeset

**User intent patterns:**

- "Start a new changeset for [feature]"
- "Create changeset called [name]"
- "I want to explore [idea]"
- "Let's prototype [feature]"

**Your process:**

```bash
# 1. Check for active changeset
ACTIVE=$(dr changeset list --status active | grep "►" | awk '{print $2}')

# 2. If active, inform user and ask
if [ -n "$ACTIVE" ]; then
  echo "Currently in changeset: $ACTIVE"
  echo "Options:"
  echo "1. Continue in current changeset"
  echo "2. Apply current and start new"
  echo "3. Switch to new without applying"
  # Get user choice
fi

# 3. Create changeset with appropriate type
dr changeset create "feature-name" --type feature
# Types: feature | bugfix | exploration
```

**Example:**

```
User: /dr-changeset Start working on a new authentication system

You should:
1. Check for active changeset
2. Inform: "I'll create a new changeset for the authentication system work"
3. Execute:
   dr changeset create "auth-system" --type feature \
     --description "New authentication and authorization system"
4. Confirm:
   "✓ Created changeset: feature-auth-system-2024-01-15-001
   All your changes will be tracked here.
   When ready to merge: /dr-changeset apply"
```

#### 2. Check Status and Active Changeset

**User intent patterns:**

- "What changeset am I in?"
- "Show me what changed"
- "Review current changes"
- "What's the status?"

**Your process:**

```bash
# 1. Check active
ACTIVE=$(cat .dr/changesets/active 2>/dev/null || echo "none")

# 2. If active, show status
if [ "$ACTIVE" != "none" ]; then
  dr changeset status --verbose
else
  echo "No active changeset - working in main model"
  echo "Create one with: dr changeset create \"name\""
fi
```

**Example:**

```
User: /dr-changeset What changes have I made?

You should:
1. Check active changeset
2. Show detailed status:
   dr changeset status --verbose
3. Display output clearly:
   "Current changeset: feature-auth-system-2024-01-15-001

   Changes:
   ✓ Added: security.role.admin (5 min ago)
   ✓ Added: security.role.user (5 min ago)
   ✓ Updated: application.service.auth (2 min ago)

   Summary:
   - 2 elements added
   - 1 element updated
   - 0 elements deleted
   - Affected layers: security, application"
```

#### 3. Compare Changesets or With Main

**User intent patterns:**

- "Compare with main model"
- "Show differences"
- "Compare [changeset-a] with [changeset-b]"
- "What's different from main?"

**Your process:**

```bash
# Compare current changeset with main
dr changeset diff

# Compare two specific changesets
dr changeset diff changeset-a-id changeset-b-id

# Get JSON for programmatic analysis
dr changeset diff --json
```

**Example:**

```
User: /dr-changeset Show me what's different from the main model

You should:
1. Run diff:
   dr changeset diff
2. Format output clearly:
   "Comparing changeset 'auth-system' with main model:

   Only in changeset (new):
   ✓ security.role.admin
   ✓ security.role.user
   ✓ security.policy.auth-required

   Modified in changeset:
   ✓ application.service.auth
     - Added property: securedBy
     - Updated property: status -> 'in-development'

   Conflicts: None ✓"
```

#### 4. Switch Between Changesets

**User intent patterns:**

- "Switch to [changeset]"
- "Work on [other-feature] instead"
- "Go back to main model"
- "List my changesets"

**Your process:**

```bash
# 1. List available changesets
dr changeset list

# 2. Switch to specific changeset
dr changeset switch changeset-id

# 3. Return to main model
dr changeset clear --yes
```

**Example:**

```
User: /dr-changeset Switch to my payment feature work

You should:
1. List changesets:
   dr changeset list
2. Find matching changeset (fuzzy match on name)
3. Switch:
   dr changeset switch feature-payment-feature-2024-01-10-002
4. Confirm:
   "✓ Switched to: feature-payment-feature

   This changeset has:
   - 5 elements added
   - 2 elements updated
   - Last modified: 3 days ago"
```

#### 5. Apply Changeset to Main Model

**User intent patterns:**

- "Apply these changes"
- "Merge to main"
- "Make it permanent"
- "Commit the changeset"

**Your process - CRITICAL SAFETY:**

```bash
# 1. Show preview FIRST
echo "Preview of changes to be applied:"
dr changeset apply --preview

# 2. Validate
echo "\nRunning validation..."
dr validate

# 3. Get explicit confirmation
echo "\nReady to apply? This will:"
echo "- Merge all changes to main model"
echo "- Mark changeset as 'applied'"
echo "- Clear active changeset"
read -p "Proceed? (yes/no): " confirm

# 4. Apply if confirmed
if [ "$confirm" = "yes" ]; then
  dr changeset apply --yes
fi
```

**Example:**

```
User: /dr-changeset Apply these changes to the main model

You should:
1. Show current status:
   dr changeset status
2. Preview:
   "Preview of changes to apply:

   Will add:
   - security.role.admin
   - security.role.user

   Will update:
   - application.service.auth

   3 total changes"

3. Validate:
   dr validate
   "✓ All changes pass validation"

4. Get confirmation:
   "Ready to apply to main model?
   Type 'yes' to confirm, anything else to cancel: "

5. Apply:
   dr changeset apply --yes

6. Confirm success:
   "✓ Applied 3 changes to main model
   ✓ Changeset marked as 'applied'
   ✓ Now working in main model

   Your changes are now permanent in the architecture."
```

#### 6. Abandon or Delete Changeset

**User intent patterns:**

- "Discard these changes"
- "Abandon this work"
- "Delete the changeset"
- "I don't want these changes"

**Your process:**

```bash
# For active changeset
dr changeset abandon $(cat .dr/changesets/active) --yes

# For specific changeset
dr changeset abandon changeset-id --yes

# Permanent deletion
dr changeset delete changeset-id --yes
```

**Example:**

```
User: /dr-changeset I don't want these changes, discard them

You should:
1. Show what will be discarded:
   "Current changeset 'auth-system' has:
   - 2 elements added
   - 1 element updated

   These changes will be DISCARDED (cannot be recovered)"

2. Confirm:
   "Are you sure? Type 'discard' to confirm: "

3. Abandon:
   dr changeset abandon feature-auth-system-001 --yes

4. Confirm:
   "✓ Changeset abandoned
   ✓ Changes discarded
   ✓ Now working in main model"
```

### Integration with Other Commands

When users are working with changesets, all modeling commands automatically work in the changeset context:

```bash
# These automatically work in active changeset:
dr add business service --name "New Service"
dr update business.service.existing --property status=updated
dr remove business.service.old

# No special syntax needed - changeset is transparent
```

**Guide users:**

- "You're in changeset [name], so all changes are tracked"
- "Use /dr-model normally - changes stay in this changeset"
- "When ready: /dr-changeset apply"

### Error Handling

**Common issues:**

1. **No active changeset when trying to apply:**

   ```
   Error: No active changeset
   → List changesets: dr changeset list
   → Create one: dr changeset create "name"
   ```

2. **Trying to apply non-existent changeset:**

   ```
   Error: Changeset not found
   → List available: dr changeset list
   → Check spelling of changeset ID
   ```

3. **Conflicts when applying:**

   ```
   Warning: Main model has changed since changeset created
   → Review conflicts: dr changeset diff
   → Resolve manually or abandon
   ```

### Best Practices

1. **Always check for active changeset** at session start
2. **Create descriptive names:** "feature-auth-system" not "test1"
3. **Review before applying:** Use `--preview` flag
4. **Validate before applying:** Run `dr validate`
5. **Keep focused:** One feature per changeset
6. **Clean up:** Delete or abandon when done
7. **Communicate status:** Tell user what changeset they're in

### Quick Reference

```bash
# Status and context
dr changeset list                    # All changesets
dr changeset status                  # Current changeset
cat .dr/changesets/active            # Active changeset ID

# Lifecycle
dr changeset create "name" --type feature
dr changeset apply --preview         # Preview first!
dr changeset apply --yes             # Apply to main
dr changeset abandon id --yes        # Discard changes

# Navigation
dr changeset switch changeset-id     # Switch to different
dr changeset clear --yes             # Return to main

# Comparison
dr changeset diff                    # Compare with main
dr changeset diff id1 id2            # Compare two

# Cleanup
dr changeset delete changeset-id --yes  # Permanent deletion
```

### Python API for Advanced Operations

```python
from documentation_robotics.core import Model
from documentation_robotics.core.changeset_manager import ChangesetManager

# Get manager
manager = ChangesetManager("./")

# Check active
active_id = manager.get_active()
if active_id:
    print(f"Active changeset: {active_id}")

# Create changeset
changeset_id = manager.create(
    name="new-feature",
    changeset_type="feature",
    description="Description here"
)

# Load model in changeset context
model = Model.load("./", changeset=changeset_id)

# All changes tracked automatically
model.add_element("business", element_dict)

# Get summary
summary = manager.get_changeset_summary(changeset_id)
print(f"Changes: {summary['total_changes']}")

# Diff
diff = manager.diff_changesets(changeset_id, None)  # None = main
print(f"Conflicts: {diff['has_conflicts']}")
```
