# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records for the Documentation Robotics project. ADRs document significant architectural decisions, their context, consequences, and rationale.

**Note**: ADR numbering starts at 003. Earlier numbers (ADR-001, ADR-002) are reserved for future use or internal architectural decisions that were not formally documented at the time of this project's public release.

## Index

| Number | Title | Status | Date |
|--------|-------|--------|------|
| [ADR-003](./ADR-003-pattern-files-cli-asset.md) | Pattern Files as CLI-Maintained Assets | Accepted | 2026-03-28 |
| [ADR-004](./ADR-004-ast-parser-selection.md) | AST Parser Selection (CodePrism) | Accepted | 2026-03-28 |
| [ADR-005](./ADR-005-language-support-management.md) | Language Support Management via CodePrism | Accepted | 2026-03-28 |

## ADR Format

Each ADR follows a standard format:

- **Status**: One of Proposed, Accepted, Deprecated, or Superseded
- **Context**: The issue that motivates this decision
- **Decision**: What was decided
- **Rationale**: Why this decision was made
- **Consequences**: Impact of the decision (positive and negative)
- **Implementation**: How the decision is implemented
- **Related**: Links to related ADRs or documentation

## Reading ADRs

- Start with [ADR-003](./ADR-003-pattern-files-cli-asset.md) for understanding pattern file architecture
- Continue with [ADR-004](./ADR-004-ast-parser-selection.md) for AST parser selection rationale
- Review [ADR-005](./ADR-005-language-support-management.md) for language support strategy

## Contributing New ADRs

When proposing a significant architectural decision:

1. Create a new file: `ADR-NNN-short-title.md`
2. Use the standard format (see any existing ADR)
3. Start with status "Proposed"
4. Submit as part of a pull request
5. Update this README with the new ADR entry
