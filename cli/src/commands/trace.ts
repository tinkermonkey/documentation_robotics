/**
 * Trace command - display dependency trace for an element
 */

import ansis from "ansis";
import { Model } from "../core/model.js";
import { ReferenceRegistry } from "../core/reference-registry.js";
import { DependencyTracker, TraceDirection } from "../core/dependency-tracker.js";
import { findElementLayer } from "../utils/element-utils.js";
import { isTelemetryEnabled, startSpan, endSpan } from "../telemetry/index.js";
import { CLIError } from "../utils/errors.js";
import { extractErrorMessage } from "../utils/error-utils.js";

export async function traceCommand(
  elementId: string,
  options: {
    direction?: "up" | "down" | "both";
    depth?: number;
    showMetrics?: boolean;
    model?: string;
  } = {}
): Promise<void> {
  const direction = options.direction || "both";
  const span = isTelemetryEnabled
    ? startSpan("trace.execute", {
        "trace.elementId": elementId,
        "trace.direction": direction,
        "trace.hasDepthLimit": options.depth !== undefined,
        "trace.depth": options.depth,
      })
    : null;

  try {
    // Load model
    const model = await Model.load(options.model);

    // Find element
    const layerName = await findElementLayer(model, elementId);
    if (!layerName) {
      if (isTelemetryEnabled && span) {
        (span as any).setAttribute("trace.found", false);
      }
      throw new CLIError(`Element ${elementId} not found`, 1);
    }

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("trace.found", true);
      (span as any).setAttribute("trace.layer", layerName);
    }

    // Build reference registry
    const registry = new ReferenceRegistry();
    for (const layer of model.layers.values()) {
      for (const element of layer.listElements()) {
        registry.registerElement(element);
      }
    }

    // Create dependency tracker with registry
    const tracker = new DependencyTracker(registry);

    // Display header
    console.log("");
    console.log(ansis.bold(`${ansis.blue("Dependency Trace:")} ${ansis.yellow(elementId)}`));
    console.log(ansis.dim("─".repeat(80)));

    // Display dependents (elements that depend on this element - upward)
    if (direction === "up" || direction === "both") {
      const transitiveDependents = tracker.traceDependencies(elementId, TraceDirection.DOWN, null);
      const directDependents = tracker.traceDependencies(elementId, TraceDirection.DOWN, 1);

      if (isTelemetryEnabled && span) {
        (span as any).setAttribute("trace.directDependents", directDependents.length);
        (span as any).setAttribute("trace.transitiveDependents", transitiveDependents.length);
      }

      console.log("");
      console.log(
        ansis.cyan(
          `Dependents (${directDependents.length} direct, ${transitiveDependents.length} transitive):`
        )
      );

      if (directDependents.length === 0) {
        console.log(ansis.dim("  (none)"));
      } else {
        // Show direct dependents with indentation
        console.log(ansis.gray("  Direct:"));
        for (const dep of directDependents.slice(0, 10)) {
          console.log(`    ${ansis.yellow("←")} ${ansis.green(dep)}`);
        }
        if (directDependents.length > 10) {
          console.log(ansis.dim(`    ... and ${directDependents.length - 10} more`));
        }
      }

      if (transitiveDependents.length > 0 && directDependents.length > 0) {
        console.log(ansis.gray("  Transitive:"));
        const transitiveOnly = transitiveDependents.filter(
          (d: string) => !directDependents.includes(d)
        );
        for (const dep of transitiveOnly.slice(0, 10)) {
          console.log(`    ${ansis.yellow("↖")} ${ansis.dim(dep)}`);
        }
        if (transitiveOnly.length > 10) {
          console.log(ansis.dim(`    ... and ${transitiveOnly.length - 10} more`));
        }
      }
    }

    // Display dependencies (elements this element depends on - downward)
    if (direction === "down" || direction === "both") {
      const transitiveDependencies = tracker.traceDependencies(elementId, TraceDirection.UP, null);
      const directDependencies = tracker.traceDependencies(elementId, TraceDirection.UP, 1);

      if (isTelemetryEnabled && span) {
        (span as any).setAttribute("trace.directDependencies", directDependencies.length);
        (span as any).setAttribute("trace.transitiveDependencies", transitiveDependencies.length);
      }

      console.log("");
      console.log(
        ansis.cyan(
          `Dependencies (${directDependencies.length} direct, ${transitiveDependencies.length} transitive):`
        )
      );

      if (directDependencies.length === 0) {
        console.log(ansis.dim("  (none)"));
      } else {
        // Show direct dependencies with indentation
        console.log(ansis.gray("  Direct:"));
        for (const dep of directDependencies.slice(0, 10)) {
          console.log(`    ${ansis.yellow("→")} ${ansis.green(dep)}`);
        }
        if (directDependencies.length > 10) {
          console.log(ansis.dim(`    ... and ${directDependencies.length - 10} more`));
        }
      }

      if (transitiveDependencies.length > 0 && directDependencies.length > 0) {
        console.log(ansis.gray("  Transitive:"));
        const transitiveOnly = transitiveDependencies.filter(
          (d: string) => !directDependencies.includes(d)
        );
        for (const dep of transitiveOnly.slice(0, 10)) {
          console.log(`    ${ansis.yellow("↘")} ${ansis.dim(dep)}`);
        }
        if (transitiveOnly.length > 10) {
          console.log(ansis.dim(`    ... and ${transitiveOnly.length - 10} more`));
        }
      }
    }

    console.log("");

    if (isTelemetryEnabled && span) {
      (span as any).setStatus({ code: 0 });
    }
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: extractErrorMessage(error),
      });
    }
    if (error instanceof CLIError) {
      throw error;
    }
    const message = extractErrorMessage(error);
    throw new CLIError(message, 1);
  } finally {
    endSpan(span);
  }
}
