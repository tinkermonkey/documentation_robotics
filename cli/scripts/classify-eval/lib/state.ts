/**
 * The state text every backend sees: the CLI's Tier-1 `renderState` (src/analyzers/classifier/state.ts),
 * so the harness measures what the CLI sends. `sourceLines` caps the code excerpt (40 for
 * classifiers, the full stored excerpt for gold labeling); `facts` is the `--facts` experiment.
 */
export { placementOf, renderState } from "../../../src/analyzers/classifier/state.js";
