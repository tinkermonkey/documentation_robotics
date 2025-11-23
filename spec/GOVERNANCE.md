# Specification Governance

This document describes the governance model for the Federated Architecture Metadata Model specification.

## Purpose

This governance model ensures that:

- Changes to the specification are carefully considered
- Stakeholder input is incorporated
- Backward compatibility is maintained when possible
- Breaking changes are clearly documented and communicated
- The specification remains coherent and high-quality

## Roles

### Specification Maintainers

**Responsibilities:**

- Review and approve specification change proposals
- Ensure specification quality and coherence
- Manage releases and versioning
- Maintain governance processes
- Resolve disputes

**Current Maintainers:**

- tinkermonkey

### Contributors

**Responsibilities:**

- Propose changes via pull requests
- Participate in discussions
- Review proposed changes
- Implement approved changes

**How to Become a Contributor:**

- Submit quality pull requests
- Participate constructively in discussions
- Follow the contribution guidelines

### Implementers

**Responsibilities:**

- Implement the specification in tools
- Report issues and ambiguities
- Provide feedback on proposed changes
- Contribute conformance test cases

## Change Process

### 1. Proposal

Anyone can propose a change by:

1. Opening an issue describing the problem and proposed solution
2. Labeling it with `spec-proposal`
3. Waiting for initial feedback from maintainers

### 2. Discussion

The proposal is discussed:

- On GitHub issues for small changes
- In specification meetings for significant changes
- Via RFC (Request for Comments) for major changes

### 3. Decision

Decisions are made by:

- **Maintainers** for minor/patch changes
- **Consensus** for minor version changes
- **Formal vote** for major version changes

### 4. Implementation

Once approved:

1. Create a pull request implementing the change
2. Update relevant documentation
3. Add tests if applicable
4. Update CHANGELOG.md
5. Get maintainer review and approval

### 5. Release

Changes are released according to semantic versioning:

- **Patch releases** (1.0.x) - Every 1-2 months
- **Minor releases** (1.x.0) - Every 3-6 months
- **Major releases** (x.0.0) - As needed (typically 1-2 years)

## Change Categories

### Normative Changes

Changes to requirements (MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT):

**Examples:**

- Add new required attribute to entity
- Change entity relationship cardinality
- Add new validation rule
- Modify reference type definition

**Process:**

- Requires proposal and discussion
- Must update conformance tests
- Major version bump if breaking
- Minor version bump if backward-compatible

### Informative Changes

Changes to guidance (SHOULD, RECOMMENDED, MAY, OPTIONAL):

**Examples:**

- Add implementation guide
- Add example model
- Clarify best practice
- Add diagram or illustration

**Process:**

- Can be submitted directly as PR
- Maintainer review required
- Patch version bump

### Editorial Changes

Changes to documentation quality:

**Examples:**

- Fix typos
- Improve wording
- Reformat for clarity
- Fix broken links

**Process:**

- Submit as PR
- Quick maintainer review
- Patch version bump

## Breaking Changes

### What Constitutes a Breaking Change?

A change is **breaking** if it:

- Removes or renames an entity type
- Removes or renames a required attribute
- Changes the type of an attribute
- Removes an enum value
- Changes validation rules to be more restrictive
- Changes reference type semantics

### Breaking Change Process

1. **Proposal** - Must include:
   - Rationale for breaking change
   - Migration guide for existing implementations
   - Deprecation period (if applicable)

2. **Discussion** - Minimum 30-day comment period

3. **Approval** - Requires:
   - Majority vote of maintainers
   - Input from known implementers
   - Updated conformance tests

4. **Release** - Breaking changes:
   - Trigger major version bump
   - Are documented in CHANGELOG.md
   - Are announced via release notes
   - May have deprecation period before removal

### Deprecation Policy

When deprecating a feature:

1. Mark as deprecated in specification
2. Update CHANGELOG.md with deprecation notice
3. Maintain for at least one minor version
4. Remove in next major version
5. Provide migration guide

Example:

```
v1.5.0 - Feature X deprecated (still supported)
v1.6.0 - Feature X still deprecated (still supported)
v2.0.0 - Feature X removed (migration guide provided)
```

## Compatibility

### Backward Compatibility

**Policy:** Minor versions MUST be backward compatible.

**Meaning:**

- Models valid under 0.1.0 MUST be valid under 1.1.0
- Implementations conforming to 0.1.0 SHOULD work with 1.1.0
- New features are additive, not replacing

### Forward Compatibility

**Policy:** Implementations SHOULD gracefully handle unknown elements.

**Meaning:**

- Unknown attributes should be ignored, not cause errors
- Unknown entity types should be skipped, not cause failures
- Validators should warn, not fail, on unknown extensions

## Versioning Strategy

### Specification Version

Tracked in `spec/VERSION` and follows semver:

- `MAJOR.MINOR.PATCH`
- Example: `1.2.3`

### Implementation Version

Implementations declare which spec version they implement:

```yaml
# Implementation metadata
specVersion: "1.2.0"
conformanceLevel: "full" # basic, standard, full
```

### Compatibility Matrix

Implementations should declare compatibility:

| Spec Version | Implementation Version | Compatible? | Notes                    |
| ------------ | ---------------------- | ----------- | ------------------------ |
| 0.1.0        | 1.0.x                  | Yes         | Full compatibility       |
| 0.1.0        | 1.1.x                  | Yes         | Backward compatible      |
| 1.1.0        | 1.0.x                  | Partial     | New features unavailable |
| 2.0.0        | 1.x.x                  | No          | Breaking changes         |

## Meetings

### Specification Working Group

**Frequency:** Monthly

**Purpose:**

- Review open proposals
- Discuss significant changes
- Plan releases
- Coordinate with implementers

**Participation:**

- Open to all contributors and implementers
- Announced via GitHub discussions
- Meeting notes published

### Implementer Sync

**Frequency:** Quarterly

**Purpose:**

- Gather feedback from implementers
- Discuss conformance issues
- Plan future directions
- Share implementation experiences

## Dispute Resolution

### Process

1. **Discussion** - Try to reach consensus via discussion
2. **Mediation** - Maintainers mediate if consensus not reached
3. **Vote** - Maintainers vote if mediation fails
4. **Appeal** - Can appeal to broader community

### Voting

When a vote is required:

- **Quorum:** At least 50% of maintainers
- **Approval:** Simple majority (>50%)
- **Breaking Changes:** 2/3 majority (>66%)

## Code of Conduct

All participants must follow the project's Code of Conduct:

- Be respectful and inclusive
- Focus on technical merit
- Assume good intent
- Welcome newcomers
- Give constructive feedback

## Amendment

This governance document can be amended by:

1. Proposal via GitHub issue
2. Discussion period (minimum 30 days)
3. Approval by 2/3 of maintainers
4. Update to this document

## Contact

- **GitHub Issues:** For proposals and discussions
- **GitHub Discussions:** For general questions
- **Email:** [maintainer-email]

---

**Version:** 0.1.0
**Last Updated:** 2025-11-23
**Next Review:** 2026-05-23
