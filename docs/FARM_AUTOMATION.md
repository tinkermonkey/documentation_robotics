# Farm Automation Guide

## Overview

Phase 5 adds automation support to the `dr farm` command group, enabling unattended operation from cron jobs and CI pipelines. Key features include:

- **Structured JSON output** (`--format json`) for all farm subcommands
- **Automatic changeset commitment** (`--auto-commit`) for fully-automated pipelines
- **Concurrent processing** (`--concurrency <n>`) for multi-project performance
- **Lightweight status checks** using commit comparison instead of full diffs
- **Standardized exit codes** (0 = success, 1 = issues found, 2 = error)

## Exit Codes

All farm commands follow the standard exit code convention:

- **0** — Success: operation completed successfully
- **1** — Issues found: validation/sync had warnings but continued
- **2** — Error: fatal error that prevented operation

JSON output includes a `code` field that mirrors the exit code.

## Flags Summary

### All Subcommands

- `--format json` — Output structured JSON instead of human-readable text

### `dr farm status`

```bash
dr farm status [--format json]
```

Shows registered projects and pending changes status.

- `--format json` — Includes `hasPendingChanges`, `lastSyncCommit`, `currentCommit` for each project

### `dr farm validate`

```bash
dr farm validate [options]
```

Options:
- `--format json` — Structured validation results
- `--project <name>` — Validate single project
- `--quiet` — Suppress non-error output
- `--output <path>` — Write report to file (JSON or Markdown)

### `dr farm pull`

```bash
dr farm pull [options]
```

Options:
- `--format json` — Structured pull results
- `--project <name>` — Pull single project
- `--verbose` — Show per-project details

### `dr farm sync`

```bash
dr farm sync [options]
```

Options:
- `--format json` — Structured sync results
- `--project <name>` — Sync single project
- `--verbose` — Show per-project details
- `--dry-run` — Preview changes without creating changesets
- `--force` — Proceed despite ambiguous file-to-element mappings
- `--output <path>` — Write JSON report to file
- `--auto-commit` — **Automatically commit changes** (bypasses staged review step)
- `--concurrency <n>` — Process up to N projects in parallel (default: 1)

## Cron Job Examples

### Daily Farm Validation

```bash
#!/bin/bash
# /usr/local/bin/farm-daily-validate.sh

set -e

FARM_ROOT="/opt/architecture-farm"
REPORT_DIR="/var/log/farm-reports"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

cd "$FARM_ROOT"

# Run validation and save report
dr farm validate \
  --format json \
  --output "$REPORT_DIR/validation_${TIMESTAMP}.json"

echo "Farm validation completed: $REPORT_DIR/validation_${TIMESTAMP}.json"
```

### Hourly Farm Sync with Auto-Commit

```bash
#!/bin/bash
# /usr/local/bin/farm-hourly-sync.sh

set -e

FARM_ROOT="/opt/architecture-farm"
LOG_FILE="/var/log/farm-sync.log"

cd "$FARM_ROOT"

# Sync all projects with auto-commit and concurrency
# Retry on failure (common in CI environments)
dr farm sync \
  --format json \
  --auto-commit \
  --concurrency 4 \
  2>&1 | tee -a "$LOG_FILE"

exit_code=${PIPESTATUS[0]}

if [ $exit_code -eq 0 ]; then
  echo "[$(date)] Farm sync successful" >> "$LOG_FILE"
elif [ $exit_code -eq 1 ]; then
  echo "[$(date)] Farm sync completed with warnings" >> "$LOG_FILE"
else
  echo "[$(date)] Farm sync failed (exit code: $exit_code)" >> "$LOG_FILE"
  exit $exit_code
fi
```

### Crontab Configuration

```crontab
# Daily farm validation at 2 AM
0 2 * * * /usr/local/bin/farm-daily-validate.sh

# Hourly farm sync (during business hours: 9 AM - 6 PM)
0 9-17 * * 1-5 /usr/local/bin/farm-hourly-sync.sh

# Weekly status check on Monday morning
0 6 * * 1 cd /opt/architecture-farm && dr farm status --format json > /var/log/farm-status.json
```

## CI/CD Pipeline Examples

### GitHub Actions Workflow

```yaml
name: Farm Sync and Validate

on:
  schedule:
    # Run every 4 hours
    - cron: '0 */4 * * *'
  workflow_dispatch:

jobs:
  farm-sync:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout farm repository
        uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install CLI
        run: |
          npm install -g @architecture-robotics/cli
      
      - name: Run Farm Sync
        run: |
          dr farm sync \
            --format json \
            --auto-commit \
            --concurrency 4 \
            --output sync-report.json
        continue-on-error: true
      
      - name: Upload Sync Report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: sync-report
          path: sync-report.json
      
      - name: Validate Farm
        run: |
          dr farm validate \
            --format json \
            --output validation-report.json
        continue-on-error: true
      
      - name: Upload Validation Report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: validation-report
          path: validation-report.json
      
      - name: Comment on PR (if applicable)
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const syncReport = JSON.parse(fs.readFileSync('sync-report.json', 'utf8'));
            const validationReport = JSON.parse(fs.readFileSync('validation-report.json', 'utf8'));
            
            const message = `## Farm Status Update
            
            **Sync Results**: ${syncReport.synced}/${syncReport.projects.length} projects synced
            **Validation**: ${validationReport.all_valid ? '✅ All valid' : '❌ Validation issues found'}
            
            [View detailed reports in artifacts](https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }})
            `;
            
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: message
            });

  farm-status:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout farm repository
        uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install CLI
        run: npm install -g @architecture-robotics/cli
      
      - name: Check Farm Status
        run: |
          STATUS=$(dr farm status --format json)
          echo "$STATUS" | jq .
```

### GitLab CI Pipeline

```yaml
farm-automation:
  stage: sync
  image: node:20-alpine
  
  script:
    # Install CLI
    - npm install -g @architecture-robotics/cli
    
    # Sync with auto-commit
    - dr farm sync
        --format json
        --auto-commit
        --concurrency 4
        --output sync-report.json
    
    # Validate
    - dr farm validate
        --format json
        --output validation-report.json
    
    # Check exit codes
    - |
      SYNC_STATUS=$?
      if [ $SYNC_STATUS -ne 0 ] && [ $SYNC_STATUS -ne 1 ]; then
        echo "Farm sync failed with exit code $SYNC_STATUS"
        exit $SYNC_STATUS
      fi
  
  artifacts:
    paths:
      - sync-report.json
      - validation-report.json
    reports:
      dotenv: farm-status.env
  
  only:
    - schedules
    - web

farm-status-webhook:
  stage: notify
  image: alpine:latest
  
  script:
    - |
      # Send status to monitoring system
      curl -X POST https://monitoring.example.com/farm-status \
        -H "Content-Type: application/json" \
        -d @sync-report.json
  
  dependencies:
    - farm-automation
```

## JSON Output Formats

### `dr farm status --format json`

```json
{
  "status": "ok",
  "farm": {
    "name": "Main Architecture Farm",
    "path": "/opt/architecture-farm",
    "created": "2024-01-15T10:30:00Z",
    "modified": "2024-09-02T15:45:30Z"
  },
  "projects": [
    {
      "name": "auth-service",
      "codebase_path": "services/auth-service",
      "model_folder": "auth-service-model",
      "remote_url": "https://github.com/org/auth-service.git",
      "lastSyncCommit": "a1b2c3d4e5f6g7h8",
      "currentCommit": "x9y8z7w6v5u4t3s2",
      "hasPendingChanges": true
    }
  ],
  "project_count": 1
}
```

### `dr farm validate --format json`

```json
{
  "status": "ok",
  "projects": [
    {
      "name": "auth-service",
      "valid": true,
      "errors": 0,
      "warnings": 2
    }
  ],
  "all_valid": true,
  "output": "/opt/architecture-farm/validation-report.json"
}
```

### `dr farm sync --format json`

```json
{
  "status": "ok",
  "code": 0,
  "projects": [
    {
      "project": "auth-service",
      "status": "success",
      "changeCount": 5,
      "changesetId": "farm-sync-auth-service-1693651430000",
      "filesChanged": {
        "added": ["src/new-endpoint.ts"],
        "modified": ["src/auth-handler.ts"],
        "deleted": []
      },
      "ambiguities": 0,
      "commitsBefore": "a1b2c3d",
      "commitsAfter": "x9y8z7w",
      "autoCommitted": true,
      "committedChanges": 5
    }
  ],
  "synced": 1,
  "failed": 0,
  "autoCommitted": true
}
```

## Monitoring and Alerting

### Parse Exit Codes in Scripts

```bash
#!/bin/bash

dr farm sync --format json --auto-commit

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo "✅ Farm sync successful"
elif [ $EXIT_CODE -eq 1 ]; then
  echo "⚠️ Farm sync completed with warnings"
  exit 1  # Treat as warning, not failure
elif [ $EXIT_CODE -eq 2 ]; then
  echo "❌ Farm sync failed"
  # Send alert to monitoring system
  curl -X POST https://alerting.example.com/incident \
    -H "Content-Type: application/json" \
    -d '{"severity":"critical","service":"farm-sync"}'
  exit 2
fi
```

### Monitor Changeset Backlog

```bash
#!/bin/bash

REPORT=$(dr farm status --format json)

PENDING=$(echo "$REPORT" | jq '[.projects[] | select(.hasPendingChanges == true)] | length')

if [ "$PENDING" -gt 0 ]; then
  echo "⚠️ $PENDING projects have pending changes"
  # Send warning to monitoring
fi
```

## Best Practices

1. **Use `--auto-commit` only for fully automated pipelines** where you trust the sync mapping
2. **Start with `--concurrency 1`** and gradually increase based on your farm size
3. **Monitor exit codes** in CI pipelines — use them to trigger downstream actions
4. **Save JSON reports** to version control or logging systems for audit trails
5. **Run validation separately** from sync to catch issues before auto-commit
6. **Test with `--dry-run`** before enabling `--auto-commit` on production farms
7. **Use `--verbose` in CI** for detailed logs if something fails
8. **Set reasonable timeouts** for cron jobs to prevent overlapping runs

## Troubleshooting

### Exit Code 1 (Issues Found)

- Check `code` field in JSON output
- Review validation or sync details in the projects array
- Use `--verbose` to see per-project details

### Exit Code 2 (Error)

- Check error message in JSON output
- Verify farm directory is accessible
- Ensure all referenced models exist
- Check git permissions for pull/sync operations

### Concurrency Issues

If using high concurrency (`--concurrency > 4`):
- Ensure your system has sufficient file descriptors: `ulimit -n`
- Monitor disk I/O during peak operations
- Consider staggering multiple farm operations

### Memory Usage

For very large farms (50+ projects):
- Process projects in batches using `--project` flag
- Use `--concurrency 2-4` instead of higher numbers
- Monitor memory usage during sync operations
