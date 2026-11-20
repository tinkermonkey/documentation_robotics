/**
 * Every DR-named file and folder a released dr has installed into an integration's folders.
 *
 * `dr upgrade` offers to remove leftovers from older integration layouts: skill folders from an
 * earlier layer numbering, commands and agents dr no longer ships. The version file can't name
 * them, because they predate it or were never recorded in it. A name pattern can't either:
 * `dr-who.md` and `dr_house_style/` in a project's `.github/` or `.claude/` are the project's own,
 * and offering them for removal put a user's files one flag away from deletion (PR 1266 review).
 * So an entry is a leftover only when its exact name is in this table: a name dr itself once
 * installed in that folder.
 *
 * The table is by integration source folder (`integrations/<name>/`), then by the component's
 * target folder in the project. It was taken from this repository's whole git history: every path
 * that ever existed under `claude_code/` or `claude_integration/` (Claude Code), `github_copilot/`
 * or `copilot_integration/` (GitHub Copilot), in `agents/`, `commands/`, `skills/`, and
 * `reference_sheets/` or `knowledge/` (both installed to `knowledge/`), whose name starts with
 * `dr-` or `dr_`. Names the current integration still ships are in it too; the manager leaves
 * those out when it looks for leftovers.
 *
 * When a release drops or renames an integration file, add the old name here. (A file installed
 * by a dr with a version file is also removed by the upgrade itself, as obsolete.)
 */
export const SHIPPED_ENTRIES: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  claude_code: {
    agents: [
      "dr-advisor.md", "dr-architect.md", "dr-documenter.md", "dr-extractor.md", "dr-helper.md",
      "dr-ideator.md", "dr-link-validator.md", "dr-release-preflight.md", "dr-schema-migrator.md",
      "dr-security-reviewer.md", "dr-validator.md",
    ],
    commands: [
      "dr-analyzer.md", "dr-changeset.md", "dr-design.md", "dr-info.md", "dr-ingest.md",
      "dr-init.md", "dr-links.md", "dr-map.md", "dr-model.md", "dr-plan.md", "dr-project.md",
      "dr-relate.md", "dr-scan-session.md", "dr-source-tracking.md", "dr-sync.md",
      "dr-validate.md", "dr-verify.md",
    ],
    knowledge: [
      "dr-layer-reference.md",
    ],
    skills: [
      "dr_01_motivation_layer", "dr_02_business_layer", "dr_03_product_layer",
      "dr_03_security_layer", "dr_04_application_layer", "dr_04_security_layer",
      "dr_05_application_layer", "dr_05_technology_layer", "dr_06_api_layer",
      "dr_06_technology_layer", "dr_07_api_layer", "dr_07_data_model_layer",
      "dr_08_data_model_layer", "dr_08_dataset_layer", "dr_09_dataset_layer", "dr_09_ux_layer",
      "dr_10_navigation_layer", "dr_10_ux_layer", "dr_11_apm_layer", "dr_11_navigation_layer",
      "dr_12_apm_layer", "dr_12_testing_layer", "dr_13_testing_layer", "dr_change_planning",
      "dr_changeset_reviewer", "dr_codebase_memory", "dr_engineering_guide", "dr_layer_01_motiv",
      "dr_layer_02_business", "dr_layer_03_security", "dr_layer_04_app", "dr_layer_05_tech",
      "dr_layer_06_api",
    ],
  },
  github_copilot: {
    agents: [
      "dr-advisor.md", "dr-architect.md",
    ],
    skills: [
      "dr_01_motivation_layer", "dr_02_business_layer", "dr_03_product_layer",
      "dr_03_security_layer", "dr_04_application_layer", "dr_04_security_layer",
      "dr_05_application_layer", "dr_05_technology_layer", "dr_06_api_layer",
      "dr_06_technology_layer", "dr_07_api_layer", "dr_07_data_model_layer",
      "dr_08_data_model_layer", "dr_08_dataset_layer", "dr_09_dataset_layer", "dr_09_ux_layer",
      "dr_10_navigation_layer", "dr_10_ux_layer", "dr_11_apm_layer", "dr_11_navigation_layer",
      "dr_12_apm_layer", "dr_12_testing_layer", "dr_13_testing_layer", "dr_change_planning",
      "dr_changeset_reviewer", "dr_layer_02_business", "dr_layer_04_app",
    ],
  },
};

/** The names dr has ever installed in one of an integration's target folders */
export function shippedEntries(integrationSourceDir: string, targetFolder: string): readonly string[] {
  return SHIPPED_ENTRIES[integrationSourceDir]?.[targetFolder] ?? [];
}
