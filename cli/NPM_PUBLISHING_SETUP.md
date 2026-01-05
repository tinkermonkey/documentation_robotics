# npm Publishing Setup with GitHub Trusted Publishers

This guide walks through setting up your npm package with **Trusted Publishers** - npm's secure, token-free publishing method using GitHub OIDC.

## ⚠️ Important Limitation

**npm requires packages to exist before configuring Trusted Publishers.** Unlike PyPI, you cannot configure OIDC for the initial publish.

**Solution**: Publish the first version with a temporary token, then configure Trusted Publishing for all subsequent releases.

## Two-Phase Setup

### Phase 1: First Publish (Uses Token)

### Phase 2: All Subsequent Publishes (Uses Trusted Publisher / OIDC)

---

## Phase 1: First Publish Setup

### Step 1: Create Temporary npm Token

1. Go to https://www.npmjs.com/settings/[YOUR_USERNAME]/tokens
2. Click **"Generate New Token"** → **"Granular Access Token"**
3. Configure the token:
   - **Token name**: `documentation-robotics-cli-initial-publish`
   - **Expiration**: 7 days (just enough for first publish)
   - **Packages and scopes**:
     - If package doesn't exist yet: Select "All packages"
     - If package exists: Select `@documentation-robotics/cli`
   - **Permissions**: Read and write
4. Click **"Generate token"**
5. **Copy the token** (you won't see it again!)

### Step 2: Add Token to GitHub Secrets

1. Go to https://github.com/tinkermonkey/documentation_robotics/settings/secrets/actions
2. Click **"New repository secret"**
3. Configure:
   - **Name**: `NPM_TOKEN`
   - **Secret**: [paste your token]
4. Click **"Add secret"**

### Step 3: Publish First Release

```bash
# Create and push the first release tag
git tag cli-v0.1.0
git push origin cli-v0.1.0
```

The GitHub Actions workflow will:

- ✅ Build the package
- ✅ Run tests
- ✅ Publish to npm using the token
- ✅ Include provenance attestation

### Step 4: Verify First Publish

1. Go to https://www.npmjs.com/package/@documentation-robotics/cli
2. Verify the package exists
3. Check for the **Provenance** badge

---

## Phase 2: Configure Trusted Publisher (After First Publish)

### Step 1: Navigate to Package Settings

1. Go to https://www.npmjs.com/package/@documentation-robotics/cli/access
2. Click on the **"Trusted publishers"** tab
3. Click **"Add trusted publisher"**

### Step 2: Configure GitHub Actions

Fill in these fields (**case-sensitive, must match exactly**):

| Field                    | Value                    | Notes                          |
| ------------------------ | ------------------------ | ------------------------------ |
| **Provider**             | `GitHub Actions`         | Select from dropdown           |
| **Organization or user** | `tinkermonkey`           | Your GitHub username/org       |
| **Repository**           | `documentation_robotics` | Repository name only           |
| **Workflow filename**    | `release.yml`            | Must include `.yml` extension  |
| **Environment name**     | _(leave empty)_          | Optional deployment protection |

**Visual Guide:**

```
┌─────────────────────────────────────────┐
│ Add trusted publisher                   │
├─────────────────────────────────────────┤
│ Provider: [GitHub Actions ▼]            │
│                                         │
│ Organization or user: tinkermonkey      │
│                                         │
│ Repository: documentation_robotics      │
│                                         │
│ Workflow filename: release.yml          │
│                                         │
│ Environment name: [optional]            │
│                                         │
│        [Cancel]  [Add trusted publisher]│
└─────────────────────────────────────────┘
```

### Step 3: Save Configuration

Click **"Add trusted publisher"**

You should see confirmation:

```
✓ Trusted publisher added successfully
  GitHub Actions: tinkermonkey/documentation_robotics (release.yml)
```

### Step 4: Delete the npm Token (IMPORTANT!)

Now that Trusted Publisher is configured:

1. **Delete from npm**:
   - Go to https://www.npmjs.com/settings/[YOUR_USERNAME]/tokens
   - Find `documentation-robotics-cli-initial-publish`
   - Click **"Delete"**

2. **Delete from GitHub** (optional but recommended):
   - Go to https://github.com/tinkermonkey/documentation_robotics/settings/secrets/actions
   - Find `NPM_TOKEN`
   - Click **"Remove"**
   - Note: The workflow will still work without the secret - it will use OIDC instead!

---

## Publishing Future Releases

All subsequent releases now use Trusted Publishing (no token needed):

```bash
git tag cli-v0.2.0
git push origin cli-v0.2.0
```

The workflow will:

- ✅ Authenticate via GitHub OIDC (no token!)
- ✅ Build and test
- ✅ Publish with provenance
- ✅ Create GitHub release

## How It Works

### First Publish (Phase 1)

```
Push tag → GitHub Actions → Uses NPM_TOKEN → Publishes to npm
```

### Subsequent Publishes (Phase 2)

```
Push tag → GitHub Actions → Requests OIDC token from GitHub
                          ↓
                    npm verifies against
                   Trusted Publisher config
                          ↓
                  Publishes (no token!)
```

## Verification

### Check Provenance

After each publish:

1. Go to https://www.npmjs.com/package/@documentation-robotics/cli
2. Click the **Provenance** badge
3. View:
   - ✅ Build transparency log (Sigstore)
   - ✅ GitHub workflow that published
   - ✅ Commit SHA
   - ✅ Cryptographic attestation

### Check Trusted Publisher Status

1. Go to https://www.npmjs.com/package/@documentation-robotics/cli/access
2. Click **"Trusted publishers"** tab
3. Should show:

   ```
   GitHub Actions
   tinkermonkey/documentation_robotics
   Workflow: release.yml
   ```

## Security Benefits

### After Trusted Publisher Configuration

1. **Zero long-lived secrets**: No npm tokens to manage or rotate
2. **Verifiable builds**: Cryptographic proof of package origin
3. **Tamper detection**: Changes after build are cryptographically detectable
4. **Audit trail**: Complete transparency from commit to published package
5. **Automatic rotation**: GitHub manages OIDC tokens (15-minute lifetime)

## Troubleshooting

### First Publish Issues

**"403 Forbidden"**

- Verify NPM_TOKEN is added to GitHub Secrets
- Check token hasn't expired
- Ensure token has write access to the package/organization

**"Package name too similar to existing package"**

- npm may block similar names - verify `@documentation-robotics/cli` is available

**"You must be logged in to publish"**

- Verify NPM_TOKEN secret exists and is correctly named
- Check workflow has `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`

### Trusted Publisher Issues (After First Publish)

**"403 Forbidden" on second publish**

- Verify Trusted Publisher is configured at npmjs.com
- Check all fields match exactly (case-sensitive!)
- Ensure workflow file is actually named `release.yml`

**"id-token permission denied"**

- Already configured correctly in your workflow ✓

**Trusted Publisher not appearing in UI**

- Ensure package was successfully published first
- Try refreshing the page or logging out/in to npm

### Still Using Token After Trusted Publisher Setup?

This is fine! The workflow supports both methods:

- If `NPM_TOKEN` secret exists → uses token
- If `NPM_TOKEN` doesn't exist + Trusted Publisher configured → uses OIDC
- Both can coexist (token takes precedence as backup)

## Configuration Checklist

### Initial Setup

- [x] `package.json` has `publishConfig.provenance: true`
- [x] GitHub workflow has `id-token: write` permission
- [x] GitHub workflow has `--provenance` flag in publish command
- [ ] npm token created with 7-day expiration
- [ ] `NPM_TOKEN` added to GitHub Secrets
- [ ] First release tag created and pushed

### After First Publish

- [ ] Package exists on npmjs.com with provenance
- [ ] Trusted Publisher configured on npmjs.com:
  - [ ] Organization: `tinkermonkey`
  - [ ] Repository: `documentation_robotics`
  - [ ] Workflow: `release.yml`
- [ ] npm token deleted (security!)
- [ ] `NPM_TOKEN` removed from GitHub Secrets (optional)

## Alternative: Manual First Publish

If you prefer not to use GitHub Actions for the first publish:

```bash
cd cli
npm run build

# Login to npm
npm login

# Publish with provenance
npm publish --provenance --access public

# Logout
npm logout
```

Then configure Trusted Publisher on npmjs.com and all future releases use GitHub Actions.

## Testing

### Dry Run (Before Publishing)

```bash
cd cli
npm run build
npm publish --dry-run --provenance
```

Shows what would be published without actually publishing.

### Verify Workflow (After Setup)

Monitor workflow runs:
https://github.com/tinkermonkey/documentation_robotics/actions/workflows/release.yml

## Resources

- [npm Trusted Publishers Documentation](https://docs.npmjs.com/trusted-publishers)
- [npm Provenance Documentation](https://docs.npmjs.com/generating-provenance-statements)
- [GitHub OIDC Documentation](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
- [GitHub Issue: Allow OIDC for Initial Publish](https://github.com/npm/cli/issues/8544)
- [Sigstore Transparency Log](https://search.sigstore.dev/)

## Summary

1. **First Publish**: Create temporary token → Publish v0.1.0 → Delete token
2. **Configure**: Set up Trusted Publisher on npmjs.com
3. **Future Releases**: Just push tags - GitHub OIDC handles everything!

After initial setup, you'll have **zero npm tokens** to manage while maintaining cryptographic proof of every release. 🎉
