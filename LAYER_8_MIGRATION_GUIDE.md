# Layer 8 Migration Guide: datastore → data-store

**Applies to:** Specification v0.7.2+, CLI v0.1.1+
**Breaking Change:** Yes - requires action for existing projects using Layer 8

---

## Overview

Specification v0.7.2 updates Layer 8 (Data Store layer) to use the canonical hyphenated naming convention `data-store` instead of `datastore`. This brings Layer 8 into alignment with other compound layer names like `data-model` (Layer 7).

**Why This Change?**
- Consistency with architectural naming conventions
- Aligns with Element ID formatting standards
- Improves clarity and reduces confusion with single-word layer names

**Who Is Affected?**
- Any project with elements in Layer 8 (Data Store)
- Projects with cross-layer references to Layer 8
- CI/CD pipelines or scripts that reference Layer 8

**Migration Effort:**
- Quick for small projects (< 50 elements)
- Moderate for medium projects (50-500 elements)
- Plan accordingly for large projects (> 500 elements)

---

## Pre-Migration Checklist

Before you start, verify your setup:

```bash
# 1. Check your current DR version
dr --version
# Expected: Shows CLI version and spec version (should be 0.7.2 or later)

# 2. Verify Layer 8 exists in your model
ls -la documentation-robotics/model/
# Look for: 08_datastore/ directory

# 3. Check element IDs in Layer 8
grep -r "datastore\." documentation-robotics/model/08_datastore/ 2>/dev/null || echo "No datastore elements found"

# 4. Check for cross-layer references to Layer 8
grep -r "datastore\." documentation-robotics/model/ --exclude-dir=08_datastore 2>/dev/null || echo "No cross-layer references found"
```

---

## Quick Migration (5-10 minutes)

Follow these steps in order. Each step is reversible if you make a mistake.

### Step 1: Backup Your Model

Always backup before making structural changes:

```bash
cd documentation-robotics
cp -r model model.backup
echo "Backup created at: model.backup"
```

If anything goes wrong, restore with:
```bash
rm -rf model
mv model.backup model
```

### Step 2: Rename Layer Directory

```bash
cd documentation-robotics/model
mv 08_datastore 08_data-store
echo "✓ Layer 8 directory renamed: 08_datastore → 08_data-store"
```

**What changed:**
- Directory structure reorganization only
- Files inside remain unchanged (will update next)

### Step 3: Update manifest.yaml

Edit `documentation-robotics/model/manifest.yaml`:

**Find this section:**
```yaml
layers:
  motivation: 01_motivation/
  business: 02_business/
  security: 03_security/
  application: 04_application/
  technology: 05_technology/
  api: 06_api/
  data-model: 07_data-model/
  datastore: 08_datastore/        # ← UPDATE THIS
  ux: 09_ux/
  navigation: 10_navigation/
  apm: 11_apm/
  testing: 12_testing/
```

**Change to:**
```yaml
layers:
  motivation: 01_motivation/
  business: 02_business/
  security: 03_security/
  application: 04_application/
  technology: 05_technology/
  api: 06_api/
  data-model: 07_data-model/
  data-store: 08_data-store/      # ← UPDATED
  ux: 09_ux/
  navigation: 10_navigation/
  apm: 11_apm/
  testing: 12_testing/
```

**Verification:**
```bash
grep "data-store:" documentation-robotics/model/manifest.yaml
# Should output: data-store: 08_data-store/
```

### Step 4: Update Element IDs in Layer 8 Files

All YAML files in `08_data-store/` directory need element ID updates.

**Example: databases.yaml**

Before:
```yaml
databases:
  production_db:
    id: datastore.database.production-db
    type: "PostgreSQL"
    tables:
      - datastore.table.users
      - datastore.table.orders
```

After:
```yaml
databases:
  production_db:
    id: data-store.database.production-db
    type: "PostgreSQL"
    tables:
      - data-store.table.users
      - data-store.table.orders
```

**Quick Find-and-Replace (Careful!):**

If you're comfortable with sed/find-replace, use this approach:

```bash
cd documentation-robotics/model/08_data-store/

# Dry-run: see what would change
find . -name "*.yaml" -exec grep -l "datastore\." {} \;

# Actually replace (sed or your editor's find-replace)
find . -name "*.yaml" -exec sed -i 's/datastore\./data-store./g' {} \;

# Verify the changes
find . -name "*.yaml" -exec grep -l "data-store\." {} \;
```

**Manual Approach (Safer):**
1. Open each YAML file in `08_data-store/` directory
2. Find: `datastore.`
3. Replace: `data-store.`
4. Repeat for all files

### Step 5: Update Cross-Layer References

Check if higher layers (1-7) reference Layer 8 elements:

```bash
# Find all references to datastore elements
grep -r "datastore\." documentation-robotics/model \
  --exclude-dir=08_data-store \
  --include="*.yaml" \
  --include="*.json"
```

Update any found references. For example:

**In 07_data-model/entities.yaml:**

Before:
```yaml
relationships:
  - type: "references"
    target: datastore.table.users
```

After:
```yaml
relationships:
  - type: "references"
    target: data-store.table.users
```

### Step 6: Validate Your Migration

Test that everything is correct:

```bash
# Run validation with strict mode
dr validate --strict

# Should output something like:
# ✓ Model validation passed
# ✓ All layers valid
# ✓ All references valid
# ✓ No inconsistencies found
```

If you see errors, review the error messages. They'll tell you exactly what needs to be fixed.

### Step 7: Verify Model Loads

Load your model and check statistics:

```bash
# Get model info
dr model info

# Should show all layers including: data-store
# Should report element counts for all layers

# List Layer 8 elements
dr list --layer data-store

# Should show all your data-store elements with correct IDs
```

---

## Common Migration Scenarios

### Scenario 1: Simple Project (Single YAML File)

**Time:** 2-3 minutes

```bash
# Step 1: Backup
cp -r documentation-robotics/model documentation-robotics/model.backup

# Step 2: Rename directory
mv documentation-robotics/model/08_datastore documentation-robotics/model/08_data-store

# Step 3: Update manifest
sed -i 's/datastore:/data-store:/g' documentation-robotics/model/manifest.yaml

# Step 4: Update IDs in Layer 8 file
sed -i 's/datastore\./data-store./g' documentation-robotics/model/08_data-store/*.yaml

# Step 5: Update cross-references (if any)
sed -i 's/datastore\./data-store./g' documentation-robotics/model/*/!08_data-store/*.yaml

# Step 6: Validate
dr validate --strict
```

### Scenario 2: Complex Project (Multiple Files & Cross-References)

**Time:** 10-20 minutes

```bash
# Step 1: Backup
cp -r documentation-robotics/model documentation-robotics/model.backup

# Step 2: Identify all files to update
echo "=== Files containing datastore references ==="
grep -r "datastore" documentation-robotics/model --include="*.yaml" | cut -d: -f1 | sort -u

# Step 3: Create migration script
cat > migrate-layer8.sh << 'EOF'
#!/bin/bash
set -e

echo "Migrating Layer 8 from datastore to data-store..."

# 1. Rename directory
if [ -d "documentation-robotics/model/08_datastore" ]; then
  mv documentation-robotics/model/08_datastore documentation-robotics/model/08_data-store
  echo "✓ Directory renamed"
fi

# 2. Update manifest
if grep -q "datastore:" documentation-robotics/model/manifest.yaml; then
  sed -i 's/datastore:/data-store:/g' documentation-robotics/model/manifest.yaml
  sed -i 's/08_datastore/08_data-store/g' documentation-robotics/model/manifest.yaml
  echo "✓ Manifest updated"
fi

# 3. Update all YAML files
for file in $(find documentation-robotics/model -name "*.yaml"); do
  if grep -q "datastore\." "$file"; then
    sed -i 's/datastore\./data-store./g' "$file"
    echo "  Updated: $file"
  fi
done
echo "✓ All YAML files updated"

# 4. Update JSON files (if used)
for file in $(find documentation-robotics/model -name "*.json"); do
  if grep -q "datastore" "$file"; then
    sed -i 's/datastore\./data-store./g' "$file"
    echo "  Updated: $file"
  fi
done
echo "✓ All JSON files updated"

echo ""
echo "Migration complete! Run: dr validate --strict"
EOF

chmod +x migrate-layer8.sh
./migrate-layer8.sh

# Step 4: Validate
dr validate --strict

# Step 5: Spot-check a few files
echo ""
echo "=== Verification ==="
echo "Layer 8 elements:"
dr list --layer data-store | head -10
```

### Scenario 3: Automated Migration with Git History

**Time:** Variable (including testing)

```bash
# Create feature branch for migration
git checkout -b "chore/migrate-layer-8-datastore-to-data-store"

# Run backup and migration
cp -r documentation-robotics/model documentation-robotics/model.backup
# ... run migration steps ...

# Validate
dr validate --strict

# Commit changes
git add documentation-robotics/model/
git commit -m "chore: migrate Layer 8 naming from datastore to data-store (spec v0.7.2)"

# Create pull request for code review
git push origin chore/migrate-layer-8-datastore-to-data-store
gh pr create --title "Migrate Layer 8 to data-store naming (spec v0.7.2)" \
             --body "Updates Layer 8 naming from 'datastore' to 'data-store' for consistency with spec v0.7.2"
```

---

## Troubleshooting

### Problem: Validation Error - "Invalid layer name: datastore"

**Cause:** You missed updating either the manifest or some element IDs.

**Solution:**
```bash
# Find remaining datastore references
grep -r "datastore" documentation-robotics/model --include="*.yaml"

# Update them manually or with find-replace
sed -i 's/datastore/data-store/g' <filename>

# Re-validate
dr validate --strict
```

### Problem: "Layer 8 directory not found"

**Cause:** Migration script renamed directory but some files still reference old path.

**Solution:**
```bash
# Verify directory exists
ls -la documentation-robotics/model/ | grep "08_"
# Should show: 08_data-store/

# Check manifest path matches
grep "data-store:" documentation-robotics/model/manifest.yaml

# Recreate if needed
if [ ! -d "documentation-robotics/model/08_data-store" ]; then
  if [ -d "documentation-robotics/model/08_datastore" ]; then
    mv documentation-robotics/model/08_datastore documentation-robotics/model/08_data-store
  fi
fi
```

### Problem: Cross-Reference Validation Fails

**Cause:** Updated Layer 8 IDs but didn't update references in other layers.

**Solution:**
```bash
# Find cross-layer references still using old format
grep -r "datastore\." documentation-robotics/model --exclude-dir=08_data-store

# Update each file found
sed -i 's/datastore\./data-store./g' <filename>

# Re-validate
dr validate --strict
```

### Problem: Rollback Needed

If something goes wrong and you want to revert:

```bash
# Restore from backup
rm -rf documentation-robotics/model
mv documentation-robotics/model.backup documentation-robotics/model

# Verify restoration
dr model info
```

---

## CLI Command Changes

No command changes are needed after migration. These commands work the same:

```bash
# List Layer 8 elements (same as before)
dr list --layer data-store

# Show Layer 8 element
dr show data-store.table.users

# Validate Layer 8
dr validate --layer data-store

# Add new Layer 8 element
dr add data-store table customers --properties '{...}'
```

---

## CI/CD Pipeline Updates

If you have CI/CD scripts referencing Layer 8, update them:

**Before:**
```bash
#!/bin/bash
# Check Layer 8 elements
dr validate --layer datastore
```

**After:**
```bash
#!/bin/bash
# Check Layer 8 elements
dr validate --layer data-store
```

**GitHub Actions Example:**

Before:
```yaml
- name: Validate Data Store Layer
  run: dr validate --layer datastore
```

After:
```yaml
- name: Validate Data Store Layer
  run: dr validate --layer data-store
```

---

## Testing Your Migration

Create a test script to verify everything works:

```bash
#!/bin/bash
set -e

echo "Testing Layer 8 migration..."

# 1. Validate model
echo "✓ Validating model..."
dr validate --strict

# 2. List Layer 8 elements
echo "✓ Listing Layer 8 elements..."
ELEMENT_COUNT=$(dr list --layer data-store | wc -l)
echo "  Found $ELEMENT_COUNT elements"

# 3. Check for any remaining old references
echo "✓ Checking for remaining 'datastore' references..."
if grep -r "datastore" documentation-robotics/model --include="*.yaml" --include="*.json" 2>/dev/null; then
  echo "  ERROR: Found old 'datastore' references!"
  exit 1
else
  echo "  No old references found"
fi

# 4. Verify manifest
echo "✓ Checking manifest..."
if grep -q "data-store:" documentation-robotics/model/manifest.yaml; then
  echo "  Manifest correctly references 'data-store'"
else
  echo "  ERROR: Manifest doesn't reference 'data-store'!"
  exit 1
fi

echo ""
echo "✅ All migration tests passed!"
```

---

## FAQ

**Q: Do I need to upgrade my CLI?**
A: Not immediately, but the next CLI release (v0.1.1+) will require spec v0.7.2. Current CLI (v0.1.0) may show warnings.

**Q: Can I migrate gradually?**
A: No. Layer 8 must be fully migrated because validation requires consistency. Partial migrations will fail validation.

**Q: What if I have a very large project?**
A: Use the migration script approach. The find-and-replace operations are fast even for 1000s of files.

**Q: Can I automate this migration?**
A: Yes! Use the scripts provided or create your own. The changes are straightforward find-and-replace operations.

**Q: What about exported artifacts?**
A: Re-export any generated artifacts (ArchiMate, PlantUML, etc.) after migration to reflect the updated naming.

**Q: Is this the only breaking change in v0.7.2?**
A: Yes. Layer 8 naming is the only breaking change. The changeset storage migration is backward compatible.

---

## Support & Questions

If you encounter issues:

1. **Check this guide:** Search for your error message in Troubleshooting
2. **Run validation:** `dr validate --strict` gives detailed error messages
3. **Review your manifest:** Ensure layer keys match directory names
4. **Check element IDs:** All must follow `layer.type.kebab-case` format

---

## Migration Timeline

| Step | Time | Description |
|------|------|-------------|
| Backup | 1 min | Create model.backup |
| Rename Directory | 1 min | Rename 08_datastore → 08_data-store |
| Update Manifest | 2 min | Change layer key from datastore to data-store |
| Update Element IDs | 3-10 min | Replace datastore. with data-store. in all files |
| Update Cross-Refs | 1-5 min | Update references in higher layers |
| Validation | 1 min | Run dr validate --strict |
| Verification | 2 min | Test with dr list and dr model info |
| **Total** | **10-20 min** | **For most projects** |

---

## Document Information

- **Created:** 2026-02-06
- **Applies To:** Spec v0.7.2+, CLI v0.1.1+
- **Breaking Change:** Yes
- **Estimated Effort:** 10-20 minutes for most projects
- **Rollback:** Simple (restore from backup)
