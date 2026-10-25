# Documentation Robotics Design Charter

**Status:** Adopted 2026-10-25. Informative, not normative. States what the specification is
for, what a node and a relationship are meant to model, and how a proposed change to the
specification should be judged. Tooling that reasons about the specification (enrichment,
triage, classification) is given this text as its foundation.

## In one paragraph

Documentation Robotics models a software system as a federated set of elements across 13
layers, from motivation through testing, so that people and AI agents share one frame of
reference for what the system is and what it should become. An element is a named architectural
fact a maintainer would point to (a goal, a service, a component, an endpoint, a schema, a table,
a view, a route, a metric, a test), typed by exactly one element type in exactly one layer, with
attributes for its intrinsic properties; implementation details are not elements. A relationship
is a directed edge whose direction and meaning come from its predicate (realizes, serves,
composes, accesses, triggers, uses), never from layer order; only the source-type, predicate,
destination-type triples in the catalog are valid. Each layer adapts an established standard
(ArchiMate, OpenAPI, JSON Schema, OpenTelemetry) into this uniform form, and deliberate
adaptations of a standard are design, not defects.

## What the specification is

The specification defines a federated architecture data model of a software system across
13 layers, from motivation through testing. It captures the _why_ (motivation, business),
the _what_ (product, application services, APIs, data), and the _how_ (components,
infrastructure, user interface, navigation, observability, tests) in one coherent structure,
so that people and AI agents share a frame of reference for reasoning about a system at any
level of abstraction.

It exists to support spec-driven development: a change is modelled as a changeset across
layers before code is written, an agent builds against that changeset, the model is used to
verify the build, and the model is maintained by extracting structure from code and surfacing
drift. A model therefore has two views, the current model and proposed changesets, and the
specification must serve both.

Each layer follows an established standard where one exists: ArchiMate 3.2 for motivation,
business, application and technology; OpenAPI 3.0 for api; JSON Schema for data-model; SQL
with paradigm extensions for data-store; HTML for ux; OpenTelemetry for apm; IEEE 829 for
testing; NIST SP 800-53 with XACML and STS-ml concepts for security. The specification adapts
each standard's concepts into one uniform node-and-relationship form. Deviations from a
standard are deliberate and should be stated; the standard's term and shape are preferred
unless the uniform form requires otherwise.

## What a node models

A node (an element) is a named, identifiable architectural fact about the system that someone
would want to find, reference, trace or verify: a goal, a business service, a component, an
endpoint, a schema, a table, a view, a route, a metric, a test case.

- A node has exactly one element type from exactly one layer. Its identity is
  `{layer}.{type}.{kebab-case-name}`, unique across the model.
- The element type's schema constrains its attributes. Attributes capture properties intrinsic
  to the element (its status, protocol, cardinality, severity); links to other elements are
  relationships, not attributes.
- Granularity: a node sits at the level a maintainer would name when explaining the system.
  Private helpers, accessors, formatting utilities and generated boilerplate are not nodes.
  Not every code symbol is an element, and a definition should let a reader decide membership.
- Enumerations should be single-axis: one attribute, one dimension of variation. Required
  attributes are reserved for properties every instance must have.
- Attribute names must not collide with the base-node fields (`id`, `path`, `type`, `name`,
  `description`, `source_reference`, `metadata`) or with a differently-typed attribute of the
  same name on sibling types; such collisions have caused silent data loss before.
- An optional `source_reference` ties an element to code locations for traceability.

## What a relationship models

A relationship is a directed, typed edge between two elements carrying a predicate from the
predicate catalog (each predicate has a category, an inverse and, where applicable, an
ArchiMate alignment). Only the source-type, predicate, destination-type triples declared in the
relationship catalog are valid; the CLI enforces this and suggests valid alternatives.

- Direction is defined by the predicate, never by the layers. `composes` and `aggregates`
  run whole -> part; `realizes` runs from the realizing element to what it realizes; `serves`
  runs provider -> consumer; `triggers` runs cause -> effect; `accesses` runs behaviour ->
  data; `maps-to` runs logical -> physical; `monitors` and `tests` run observer -> observed;
  `uses`, `depends-on` and `consumes` run dependent -> dependency. The same predicate has the
  same direction whether or not the two elements share a layer.
- Layer numbers are presentation order, not a dependency order, and carry no rule about which
  layer may reference which. The relationship catalog is the authority on which source-type,
  predicate, destination-type triples are valid; most cross-layer relationships happen to run
  from implementation layers toward intent layers because `realizes`, `satisfies` and
  `supports` point that way, and the ones that run the other way (a schema `maps-to` a
  table, a process is `constrained-by` a policy) are correct.
- Traceability is a coverage property, not a direction rule: an implementation element should
  reach a motivation element through `realizes`, `satisfies` or `supports` chains, and audits
  should report where it does not.
- One meaning, one predicate: two predicates between the same pair that express the same
  meaning is a defect. Two predicates with different meanings between the same pair are
  acceptable when the definitions say which to use.
- Elements never carry qualified identities; references to other models use qualified paths
  (`@model/layer.type.name`) in a references field, never relationships.
- Prefer expressing structure as a relationship when both ends are elements; prefer an
  attribute when the value is not itself an element.

## How to judge a proposed change

- **A defect** is a schema that contradicts itself or its standard, loses information
  modellers need, makes the CLI reject or mis-suggest valid models, or declares one concept in
  two places.
- **Working as designed** is a documented, deliberate adaptation (the layer direction rule, the
  spec's own predicate vocabulary, the uniform node form) or optionality that reflects real
  variation among instances (a view may be routable or not; a service may be synchronous or
  not).
- **A judgment call** is a modelling choice with reasonable alternatives: a granularity
  cut-off, which of two near-synonym predicates to keep, whether a fact belongs in an attribute
  or a relationship, whether to add an attribute for something rarely recorded.
- **Scope of change**, per the governance model: renames, retypes, removals and changes to
  required-ness break existing models and need a migration; adding optional attributes, enum
  values or relationships is additive; changing descriptions is editorial. A fix should be the
  smallest scope that resolves the problem.
