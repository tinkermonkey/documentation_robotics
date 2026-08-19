/**
 * Repair command — detect and best-effort-recover model data lost to a fixed bug in
 * Model.saveLayer() that silently stripped the "source"/"x-source-reference" attributes from
 * every element on save, even when a node type's own schema declared one as a real (sometimes
 * required) domain attribute. See core/attribute-collision-repair.ts for the full mechanism.
 *
 * This is a detect-and-report tool first, repair second: elements with no recoverable value in
 * changeset history are always reported, never fabricated.
 */

import ansis from "ansis";
import { Model } from "../core/model.js";
import { StagedChangesetStorage } from "../core/staged-changeset-storage.js";
import {
  scanForAttributeCollisionDamage,
  attemptRecovery,
  applyRecovery,
  type CollisionCandidate,
} from "../core/attribute-collision-repair.js";
import { ModelNotFoundError, getErrorMessage, handleError } from "../utils/errors.js";
import { writeFile } from "../utils/file-io.js";

export interface RepairAttributeCollisionOptions {
  apply?: boolean;
  format?: "text" | "json";
  output?: string;
  verbose?: boolean;
}

function printCandidate(c: CollisionCandidate, applied: boolean): void {
  let note: string;
  if (c.recovered) {
    note = applied
      ? ansis.green(`restored from changeset "${c.recovered.changesetName}"`)
      : ansis.green(`recoverable from changeset "${c.recovered.changesetName}"`);
  } else {
    note = ansis.dim("no recoverable value found — must be re-supplied manually");
  }
  console.log(`  ${ansis.bold(c.elementRef)} ${ansis.dim(`(${c.specNodeId}.${c.attribute})`)} — ${note}`);
}

export async function repairAttributeCollisionCommand(
  options: RepairAttributeCollisionOptions = {}
): Promise<void> {
  try {
    let model: Model;
    try {
      model = await Model.load();
    } catch (error) {
      const message = getErrorMessage(error);
      if (message.includes("No DR project") || message.includes("Model not found")) {
        throw new ModelNotFoundError();
      }
      throw error;
    }

    const candidates = scanForAttributeCollisionDamage(model);
    const storage = new StagedChangesetStorage(model.rootPath);
    await attemptRecovery(candidates, storage);

    let repaired: CollisionCandidate[] = [];
    if (options.apply && candidates.some((c) => c.recovered)) {
      repaired = applyRecovery(model, candidates);
      const affectedLayers = new Set(repaired.map((c) => c.layerName));
      for (const layerName of affectedLayers) {
        await model.saveLayer(layerName);
      }
    }

    const format = options.format ?? "text";

    if (format === "json") {
      const report = {
        totalAffected: candidates.length,
        requiredMissing: candidates.filter((c) => c.required).length,
        optionalMissing: candidates.filter((c) => !c.required).length,
        recoverable: candidates.filter((c) => c.recovered).length,
        repaired: repaired.length,
        applied: !!options.apply,
        candidates,
      };
      const json = JSON.stringify(report, null, 2);
      if (options.output) {
        await writeFile(options.output, json);
        console.log(ansis.green(`✓ Report written to ${options.output}`));
      } else {
        console.log(json);
      }
      return;
    }

    if (candidates.length === 0) {
      console.log(ansis.green("\n✓ No attribute-collision damage found — model is clean.\n"));
      return;
    }

    console.log(
      ansis.bold(
        `\nFound ${candidates.length} element${candidates.length === 1 ? "" : "s"} missing a ` +
          `schema-declared attribute the fixed persistence bug could have stripped:\n`
      )
    );

    const required = candidates.filter((c) => c.required);
    const optional = candidates.filter((c) => !c.required);

    if (required.length > 0) {
      console.log(ansis.red(ansis.bold(`REQUIRED — fails validation today (${required.length}):`)));
      required.forEach((c) => printCandidate(c, !!options.apply));
      console.log();
    }

    if (optional.length > 0) {
      console.log(
        ansis.yellow(ansis.bold(`Optional — silent, unconfirmed whether ever set (${optional.length}):`))
      );
      optional.forEach((c) => printCandidate(c, !!options.apply));
      console.log();
    }

    const recoverableCount = candidates.filter((c) => c.recovered).length;
    const unrecoverableCount = candidates.length - recoverableCount;

    if (options.apply) {
      console.log(
        ansis.green(
          `✓ Restored ${repaired.length} of ${recoverableCount} recoverable value(s) from changeset history.`
        )
      );
      if (unrecoverableCount > 0) {
        console.log(
          ansis.yellow(
            `⚠ ${unrecoverableCount} element(s) have no recoverable value — re-supply manually ` +
              `with "dr update <id> --attributes '{...}'".`
          )
        );
      }
    } else {
      console.log(
        ansis.dim(
          `${recoverableCount} of ${candidates.length} have a recoverable value in changeset history. ` +
            `Run with --apply to restore them.`
        )
      );
      if (unrecoverableCount > 0) {
        console.log(
          ansis.dim(
            `${unrecoverableCount} have no recoverable value and will need to be manually re-supplied ` +
              `even after --apply.`
          )
        );
      }
    }
    console.log();
  } catch (error) {
    handleError(error);
  }
}
