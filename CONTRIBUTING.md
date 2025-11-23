# Contributing to Documentation Robotics

Thank you for your interest in contributing!

## Important: Pre-commit Hooks Required

**Before contributing, set up pre-commit hooks:**

```bash
# Install pre-commit
pip install pre-commit

# Install the git hooks
pre-commit install

# Verify installation
pre-commit run --all-files
```

See [PRE_COMMIT_SETUP.md](PRE_COMMIT_SETUP.md) for detailed setup instructions.

**Why?** Pre-commit hooks catch issues locally before commit, preventing CI failures and speeding up the review process.

## Types of Contributions

### Contributing to the Specification

For specification contributions (new layers, entities, changes):

- See [spec/CONTRIBUTING.md](spec/CONTRIBUTING.md)
- Follow the governance process in [spec/GOVERNANCE.md](spec/GOVERNANCE.md)
- Use "Specification" issue templates

### Contributing to the CLI Tool

For CLI improvements (features, bug fixes):

- See [cli/README.md#development](cli/README.md#development)
- Run tests: `cd cli && pytest`
- Use "CLI" issue templates

## Quick Start

### 1. Fork and Clone

```bash
git clone https://github.com/yourname/documentation_robotics.git
cd documentation_robotics
```

### 2. Set Up Development Environment

```bash
# Install pre-commit (REQUIRED)
pip install pre-commit
pre-commit install

# For CLI development
cd cli
pip install -e ".[dev]"
cd ..

# For spec work (optional)
npm install -g markdownlint-cli ajv-cli
```

### 3. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

### 4. Make Changes

Edit files, following the appropriate style guides.

### 5. Validate Locally

```bash
# Pre-commit hooks run automatically on commit
git add .
git commit -m "your message"

# Or run manually
pre-commit run --all-files

# For CLI changes, also run tests
cd cli
pytest
```

### 6. Push and Create PR

```bash
git push origin feature/your-feature-name
# Then create PR on GitHub
```

## Development Workflow

### Specification Changes

```bash
# 1. Make changes to spec files
vim spec/layers/01-motivation-layer.md

# 2. Update schemas if needed
vim spec/schemas/01-motivation-layer.schema.json

# 3. Validate
pre-commit run --all-files

# 4. Update CHANGELOG
vim spec/CHANGELOG.md

# 5. Commit
git add spec/
git commit -m "spec: add new entity to motivation layer"
```

### CLI Changes

```bash
# 1. Make changes
vim cli/src/documentation_robotics/commands/new_command.py

# 2. Add tests
vim cli/tests/unit/test_new_command.py

# 3. Run tests
cd cli
pytest
black src/
ruff check src/

# 4. Commit (pre-commit will auto-format)
git add .
git commit -m "feat(cli): add new command"
```

## Code Style

### Python (CLI)

- **Formatter:** Black (line-length=100)
- **Linter:** Ruff
- **Type Checking:** mypy
- **Imports:** Sorted automatically

Pre-commit hooks enforce these automatically.

### Markdown (Documentation)

- Follow [markdownlint](https://github.com/DavidAnson/markdownlint) rules
- See `.markdownlint.yaml` for configuration
- Auto-fix: `markdownlint --fix '**/*.md'`

### YAML (Model Files)

- 2-space indentation
- No tabs
- Valid YAML syntax

### JSON (Schemas)

- Valid JSON syntax
- JSON Schemas must conform to Draft 7
- Use `ajv` for validation

## Testing

### Specification

- All schemas must be valid JSON Schema Draft 7
- Example models must validate against schemas
- All markdown links must be valid
- Spell check passes (coming soon)

### CLI

```bash
cd cli

# Run all tests
pytest

# Run with coverage
pytest --cov=documentation_robotics --cov-report=html

# Run specific tests
pytest tests/unit/
pytest tests/conformance/

# Type checking
mypy src/

# Linting
black --check src/
ruff check src/
```

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): short description

Longer description if needed

Fixes #123
```

**Types:**

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `spec`: Specification changes
- `test`: Add/update tests
- `chore`: Maintenance tasks
- `refactor`: Code refactoring

**Scopes:**

- `spec`: Specification changes
- `cli`: CLI tool changes
- `core`: Core specification documents
- `layer`: Layer-specific changes (e.g., `layer/motivation`)
- `conformance`: Conformance-related changes

**Examples:**

```
spec: add new entity type to motivation layer
fix(cli): correct validation error message
docs: update getting started guide
feat(cli): add export to JSON format
```

## Pull Request Process

### 1. Create Quality PR

- [ ] Descriptive title following commit message format
- [ ] Clear description of changes
- [ ] Link to related issues
- [ ] All pre-commit hooks pass
- [ ] All tests pass (for CLI changes)
- [ ] Documentation updated
- [ ] CHANGELOG updated (for significant changes)

### 2. PR Template

Use the appropriate template:

- **Specification changes:** Include impact assessment
- **CLI changes:** Include testing evidence
- **Breaking changes:** Include migration guide

### 3. Review Process

- Maintainers will review your PR
- Address feedback promptly
- Keep PR focused and small
- One feature/fix per PR

### 4. Merge Requirements

- [ ] At least one maintainer approval
- [ ] All conversations resolved
- [ ] Pre-commit hooks pass
- [ ] Tests pass (for CLI)
- [ ] Documentation complete

## Issue Reporting

### Before Creating an Issue

1. Search existing issues
2. Check if it's already documented
3. Verify you're using the latest version

### Creating an Issue

Use the appropriate template:

- **Specification issues:** Use "Specification Bug Report" or "Specification Feature Request"
- **CLI issues:** Use "CLI Bug Report" or "CLI Feature Request"

Include:

- Clear description
- Steps to reproduce (for bugs)
- Expected vs. actual behavior
- Environment details
- Example code/models

## Getting Help

- **Questions:** [GitHub Discussions](https://github.com/yourorg/documentation_robotics/discussions)
- **Issues:** [GitHub Issues](https://github.com/yourorg/documentation_robotics/issues)
- **Pre-commit help:** See [PRE_COMMIT_SETUP.md](PRE_COMMIT_SETUP.md)
- **Specification questions:** See [spec/CONTRIBUTING.md](spec/CONTRIBUTING.md)

## Code of Conduct

Be respectful and constructive. We're all here to improve architecture modeling!

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Ready to contribute?**

1. Install pre-commit: `pip install pre-commit && pre-commit install`
2. Read [PRE_COMMIT_SETUP.md](PRE_COMMIT_SETUP.md)
3. Pick an issue or propose a new feature
4. Start coding!

Thank you for contributing! 🎉
