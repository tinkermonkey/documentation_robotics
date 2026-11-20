/**
 * Experiment 3: seeded gaps. Cut a known hole in a model, run every free finder on what is left,
 * and count how much of the hole each finder points back at.
 *
 *   bun seeded.ts --models viewer=~/workspace/documentation_robotics_viewer,... [--backgrounds 0,0.5]
 *                 [--seeds 2] [--max-types 60] [--elements 60] [--no-code]
 *
 * A trial removes one stratum's relationships (or one element with its relationships). Only
 * findings the hole caused are scored: a finding the finder already made on the uncut model is
 * left out. `--backgrounds 0.5` first removes a random half of all relationships, so the hole is
 * cut in a thinner model where peers are scarcer; the baseline is then the thinned model.
 *
 * Recovery levels, each including the finer ones:
 *   exact  the relationship itself (source, predicate, target)
 *   link   the two elements, with the removed type among the candidates
 *   shape  one end, the predicate and the other end's type
 *   type   the relationship type
 *   pair   the two layers
 *
 * Writes data/seeded-report.md and data/seeded-results.json.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { layerOf, pairKey, type Catalog } from "./catalog.js";
import { claimNodes } from "./code-graph.js";
import type { Finding } from "./finders.js";
import {
  ablate,
  indexModel,
  relKey,
  shapeKey,
  unorderedKey,
  type Model,
  type Rel
} from "./model.js";
import {
  dataDir,
  FINDER_NAMES,
  num,
  parseFlags,
  pct,
  QUESTION_FINDERS,
  runFinders,
  setup,
  type Loaded
} from "./run.js";

const flags = parseFlags(process.argv.slice(2));
const backgrounds = String(flags.backgrounds ?? "0,0.5")
  .split(",")
  .map(Number);
const seeds = Number(flags.seeds ?? 2);
const maxTypes = Number(flags["max-types"] ?? 60);
const maxElements = Number(flags.elements ?? 60);
const PARTIAL_FRACTIONS = [0.1, 0.5];
const MIN_FOR_EMPTY = 3;
const MIN_FOR_PARTIAL = 10;
const RANK_CUTS = [20, 50, 100];
const LEVELS = ["exact", "link", "shape", "type", "pair"] as const;
type LevelName = (typeof LEVELS)[number];
const UNION = "any answer finder";

function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rnd: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Trial {
  stratum: string;
  removeRels: Rel[];
  removeEls: string[];
}

function makeTrials(model: Model, rnd: () => number): Trial[] {
  const idx = indexModel(model);
  const trials: Trial[] = [];
  const typeOf = (id: string) => model.elements.get(id)!.type;

  const byPair = new Map<string, Rel[]>();
  for (const r of model.rels) {
    const [a, b] = [layerOf(typeOf(r.source)), layerOf(typeOf(r.target))];
    if (a !== b)
      byPair.set(pairKey(a, b), [...(byPair.get(pairKey(a, b)) ?? []), r]);
  }
  for (const rels of byPair.values())
    if (rels.length >= MIN_FOR_EMPTY)
      trials.push({
        stratum: "layer pair emptied",
        removeRels: rels,
        removeEls: []
      });

  for (const scope of ["between layers", "within a layer"]) {
    const used = [...idx.usedTriples.entries()].filter(([, rels]) => {
      const r = rels[0];
      return (
        (layerOf(typeOf(r.source)) !== layerOf(typeOf(r.target))) ===
        (scope === "between layers")
      );
    });
    for (const [, rels] of shuffle(
      used.filter(([, rels]) => rels.length >= MIN_FOR_EMPTY),
      rnd
    ).slice(0, maxTypes)) {
      trials.push({
        stratum: `type emptied, ${scope}`,
        removeRels: rels,
        removeEls: []
      });
    }
    const big = shuffle(
      used.filter(([, rels]) => rels.length >= MIN_FOR_PARTIAL),
      rnd
    ).slice(0, Math.ceil(maxTypes / 2));
    for (const fraction of PARTIAL_FRACTIONS) {
      for (const [, rels] of big) {
        for (let s = 0; s < seeds; s++) {
          trials.push({
            stratum: `${fraction * 100}% of a type, ${scope}`,
            removeRels: shuffle(rels, rnd).slice(
              0,
              Math.max(1, Math.round(rels.length * fraction))
            ),
            removeEls: []
          });
        }
      }
    }
  }

  // Elements, round-robin over layers so the large layers don't take every slot.
  const byLayer = new Map<string, string[]>();
  for (const el of model.elements.values()) {
    if ((idx.degree.get(el.id) ?? 0) >= 2)
      byLayer.set(el.layer, [...(byLayer.get(el.layer) ?? []), el.id]);
  }
  const queues = [...byLayer.values()].map((ids) => shuffle(ids, rnd));
  const picked: string[] = [];
  while (picked.length < maxElements && queues.some((q) => q.length)) {
    for (const q of queues) {
      const id = q.pop();
      if (id && picked.length < maxElements) picked.push(id);
    }
  }
  for (const id of picked)
    trials.push({
      stratum: "element removed",
      removeRels: [],
      removeEls: [id]
    });
  return trials;
}

/** What a set of findings points at, at each level (each level includes the finer ones). */
function reached(
  findings: Finding[],
  model: Model,
  catalog: Catalog
): Record<LevelName, Set<string>> {
  const sets: Record<LevelName, Set<string>> = {
    exact: new Set(),
    link: new Set(),
    shape: new Set(),
    type: new Set(),
    pair: new Set()
  };
  const typeOf = (id: string) => model.elements.get(id)?.type;
  const addRel = (
    source: string,
    predicate: string,
    target: string,
    exact: boolean
  ) => {
    const st = typeOf(source);
    const tt = typeOf(target);
    if (!st || !tt) return;
    const tid = `${st}.${predicate}.${tt}`;
    if (exact) sets.exact.add(relKey({ source, predicate, target }));
    sets.link.add(`${unorderedKey(source, target)}|${tid}`);
    sets.shape.add(shapeKey(source, "out", predicate, tt));
    sets.shape.add(shapeKey(target, "in", predicate, st));
    sets.type.add(tid);
    sets.pair.add(pairKey(layerOf(st), layerOf(tt)));
  };
  for (const f of findings) {
    if (f.level === "relationship")
      addRel(f.source!, f.predicate!, f.target!, true);
    else if (f.level === "link") {
      const [a, b] = f.ends!;
      for (const tid of f.candidates!) {
        const t = catalog.byId.get(tid);
        if (!t) continue;
        const exact = f.candidates!.length === 1;
        if (typeOf(a) === t.source && typeOf(b) === t.destination)
          addRel(a, t.predicate, b, exact);
        if (typeOf(b) === t.source && typeOf(a) === t.destination)
          addRel(b, t.predicate, a, exact && typeOf(a) !== typeOf(b));
      }
    } else if (f.level === "shape") {
      const own = typeOf(f.element!);
      if (!own) continue;
      sets.shape.add(f.key);
      const tid =
        f.direction === "out"
          ? `${own}.${f.predicate}.${f.otherType}`
          : `${f.otherType}.${f.predicate}.${own}`;
      sets.type.add(tid);
      sets.pair.add(pairKey(layerOf(own), layerOf(f.otherType!)));
    } else if (f.level === "type") {
      const t = catalog.byId.get(f.triple!);
      if (!t) continue;
      sets.type.add(t.id);
      sets.pair.add(pairKey(layerOf(t.source), layerOf(t.destination)));
    } else if (f.level === "pair") sets.pair.add(f.pair!);
  }
  return sets;
}

interface RecallCell {
  removed: number;
  got: Record<LevelName, number>;
  /** Trials that removed at least one such relationship, and the sum of their per-trial recall. */
  trials: number;
  perTrial: Record<LevelName, number>;
}
interface VolumeCell {
  trials: number;
  fresh: number;
  hits: number;
}
interface ElementCell {
  trials: number;
  tied: number;
  at: Record<number, number>;
  neighbourShape: number;
}

const recall = new Map<string, RecallCell>();
const volume = new Map<string, VolumeCell>();
const elements = new Map<string, ElementCell>();
const trialCounts = new Map<string, number>();
const cellOf = <T>(map: Map<string, T>, key: string, make: () => T): T => {
  let c = map.get(key);
  if (!c) map.set(key, (c = make()));
  return c;
};
const K = (...parts: Array<string | number>) => parts.join("\t");

const { catalog, models } = await setup(flags);
const started = Date.now();

function runModel(loaded: Loaded, background: number): void {
  const fleet = models.filter((m) => m !== loaded);
  const rnd = seededRandom(20261120 + Math.round(background * 100));
  const base =
    background > 0
      ? ablate(
          loaded.model,
          new Set(
            shuffle(loaded.model.rels, rnd)
              .slice(0, Math.round(loaded.model.rels.length * background))
              .map(relKey)
          )
        )
      : loaded.model;
  const baseRun = runFinders(base, catalog, fleet, loaded.graph);
  const baseKeys = new Map(
    [...baseRun.findings].map(([name, fs]) => [
      name,
      new Set(fs.map((f) => f.key))
    ])
  );
  const baseClaims = loaded.graph ? claimNodes(base, loaded.graph) : null;
  const typeOf = (id: string) => base.elements.get(id)!.type;
  const trials = makeTrials(base, rnd);
  const finderNames = FINDER_NAMES.filter((f) => baseRun.findings.has(f));

  for (const trial of trials) {
    const removeEls = new Set(trial.removeEls);
    const removed = removeEls.size
      ? base.rels.filter(
          (r) => removeEls.has(r.source) || removeEls.has(r.target)
        )
      : trial.removeRels;
    const cut = ablate(base, new Set(trial.removeRels.map(relKey)), removeEls);
    const run = runFinders(cut, catalog, fleet, loaded.graph);
    trialCounts.set(
      K(loaded.model.name, background, trial.stratum),
      (trialCounts.get(K(loaded.model.name, background, trial.stratum)) ?? 0) +
        1
    );

    // The removed relationships, keyed at each level, as seen from the cut model.
    const targets = removed.map((r) => {
      const st = typeOf(r.source);
      const tt = typeOf(r.target);
      const tid = `${st}.${r.predicate}.${tt}`;
      return {
        reach: catalog.reachable.has(tid) ? "edge route" : "no edge route",
        keys: {
          exact: [relKey(r)],
          link: [`${unorderedKey(r.source, r.target)}|${tid}`],
          shape: [
            shapeKey(r.source, "out", r.predicate, tt),
            shapeKey(r.target, "in", r.predicate, st)
          ],
          type: [tid],
          pair: [pairKey(layerOf(st), layerOf(tt))]
        } as Record<LevelName, string[]>
      };
    });
    const targetKeys: Record<LevelName, Set<string>> = {
      exact: new Set(),
      link: new Set(),
      shape: new Set(),
      type: new Set(),
      pair: new Set()
    };
    for (const t of targets)
      for (const level of LEVELS)
        for (const k of t.keys[level]) targetKeys[level].add(k);
    const removedNodes = new Set(
      trial.removeEls.flatMap((id) => baseClaims?.byElement.get(id) ?? [])
    );

    const fresh = new Map<string, Finding[]>();
    for (const name of finderNames)
      fresh.set(
        name,
        (run.findings.get(name) ?? []).filter(
          (f) => !baseKeys.get(name)!.has(f.key)
        )
      );
    const perFinder = new Map<string, Record<LevelName, Set<string>>>();
    for (const [name, fs] of fresh)
      perFinder.set(name, reached(fs, cut, catalog));
    const union = reached(
      [...fresh]
        .filter(([name]) => !QUESTION_FINDERS.has(name))
        .flatMap(([, fs]) => fs),
      cut,
      catalog
    );
    perFinder.set(UNION, union);

    for (const [name, sets] of perFinder) {
      const inTrial = new Map<
        string,
        { removed: number; got: Record<LevelName, number> }
      >();
      for (const t of targets) {
        const local = cellOf(inTrial, t.reach, () => ({
          removed: 0,
          got: { exact: 0, link: 0, shape: 0, type: 0, pair: 0 }
        }));
        local.removed++;
        for (const level of LEVELS)
          if (t.keys[level].some((k) => sets[level].has(k))) local.got[level]++;
      }
      for (const [reach, local] of inTrial) {
        const zero = () => ({ exact: 0, link: 0, shape: 0, type: 0, pair: 0 });
        const cell = cellOf(
          recall,
          K(loaded.model.name, background, trial.stratum, reach, name),
          () => ({ removed: 0, got: zero(), trials: 0, perTrial: zero() })
        );
        cell.removed += local.removed;
        cell.trials++;
        for (const level of LEVELS) {
          cell.got[level] += local.got[level];
          cell.perTrial[level] += local.got[level] / local.removed;
        }
      }
    }
    for (const [name, fs] of fresh) {
      const cell = cellOf(
        volume,
        K(loaded.model.name, background, trial.stratum, name),
        () => ({ trials: 0, fresh: 0, hits: 0 })
      );
      cell.trials++;
      cell.fresh += fs.length;
      for (const f of fs) {
        if (f.level === "element") {
          if (f.nodes!.some((n) => removedNodes.has(n))) cell.hits++;
          continue;
        }
        const own = reached([f], cut, catalog);
        const level: LevelName = f.level === "relationship" ? "exact" : f.level;
        if ([...own[level]].some((k) => targetKeys[level].has(k))) cell.hits++;
      }
    }
    if (removeEls.size) {
      for (const name of ["frontier-probe", "residual"]) {
        if (!fresh.has(name)) continue;
        const cell = cellOf(
          elements,
          K(loaded.model.name, background, name),
          () => ({
            trials: 0,
            tied: 0,
            at: Object.fromEntries(RANK_CUTS.map((c) => [c, 0])),
            neighbourShape: 0
          })
        );
        cell.trials++;
        if (!removedNodes.size) continue;
        cell.tied++;
        // Rank in the cut model's whole list, since a removed element's code may already rank.
        const best = Math.min(
          ...(run.findings.get(name) ?? [])
            .filter((f) => f.nodes!.some((n) => removedNodes.has(n)))
            .map((f) => f.rank ?? Infinity),
          Infinity
        );
        for (const c of RANK_CUTS) if (best <= c) cell.at[c]++;
      }
      const cell = cellOf(
        elements,
        K(loaded.model.name, background, UNION),
        () => ({ trials: 0, tied: 0, at: {}, neighbourShape: 0 })
      );
      cell.trials++;
      if (targets.some((t) => t.keys.shape.some((k) => union.shape.has(k))))
        cell.neighbourShape++;
    }
  }
  process.stderr.write(
    `${loaded.model.name} background ${background}: ${trials.length} trials, ${Math.round((Date.now() - started) / 1000)} s\n`
  );
}

for (const loaded of models)
  for (const background of backgrounds) runModel(loaded, background);

// Report
const out: string[] = [];
const say = (s = "") => out.push(s);
const parts = (key: string) => key.split("\t");
say("# Seeded gaps: what the free finders recover");
say();
say(
  `Spec ${catalog.specVersion}. Generated by \`seeded.ts\` (backgrounds ${backgrounds.join(", ")}; ${seeds} draws per partial removal; at most ${maxTypes} types and ${maxElements} elements per model). No model calls.`
);
say();
say(
  "A trial cuts one hole. Only findings the hole caused are counted. Levels: **exact** names the relationship; **link** names the two elements; **shape** names one end, the predicate and the other end's type; **type** names the relationship type. Each level includes the finer ones. Percentages are the mean over trials of the share of that trial's removed relationships recovered, so one large hole counts once. \"Edge route\" says whether a mapped CBM edge can produce the removed relationship's type."
);
say();
say("| Model | Commit | Code index |");
say("| --- | --- | --- |");
for (const m of models)
  say(
    `| ${m.model.name} | ${m.model.commit} | ${m.graph ? `${num(m.graph.nodes.size)} nodes` : "none: code finders not run"} |`
  );

const answerFinders = FINDER_NAMES.filter(
  (f) => !QUESTION_FINDERS.has(f) && f !== "frontier-probe" && f !== "residual"
);
for (const m of models) {
  for (const background of backgrounds) {
    const strata = [...trialCounts.keys()]
      .filter(
        (k) =>
          parts(k)[0] === m.model.name && Number(parts(k)[1]) === background
      )
      .map((k) => parts(k)[2]);
    if (!strata.length) continue;
    const present = [
      ...answerFinders.filter((f) =>
        [...volume.keys()].some(
          (k) => parts(k)[0] === m.model.name && parts(k)[3] === f
        )
      ),
      UNION
    ];
    say();
    say(
      `## ${m.model.name}${background ? `, after removing a random ${background * 100}% of relationships` : ""}`
    );
    for (const level of ["shape", "link", "exact"] as const) {
      say();
      say(`### Removed relationships recovered at ${level} level`);
      say();
      say(`| Hole | Edge route | Trials | Removed | ${present.join(" | ")} |`);
      say(
        `| --- | --- | --- | --- | ${present.map(() => "---").join(" | ")} |`
      );
      for (const stratum of strata) {
        for (const reach of ["edge route", "no edge route"]) {
          const first = recall.get(
            K(m.model.name, background, stratum, reach, UNION)
          );
          if (!first) continue;
          const cells = present.map((f) => {
            const c = recall.get(
              K(m.model.name, background, stratum, reach, f)
            );
            return c ? pct(c.perTrial[level], c.trials) : "-";
          });
          say(
            `| ${stratum} | ${reach} | ${first.trials} | ${num(first.removed)} | ${cells.join(" | ")} |`
          );
        }
      }
    }
    say();
    say("### Relationship types and layer pairs flagged");
    say();
    say(
      "Mean share of a trial's removed relationships whose type (or, for the last column, layer pair) a new finding names."
    );
    say();
    const typeFinders = ["ledger-open-type", "fleet-prior", UNION];
    say(
      `| Hole | Edge route | Removed | ${typeFinders.join(" | ")} | ledger-empty-pair (pair) |`
    );
    say(
      `| --- | --- | --- | ${typeFinders.map(() => "---").join(" | ")} | --- |`
    );
    for (const stratum of strata) {
      for (const reach of ["edge route", "no edge route"]) {
        const first = recall.get(
          K(m.model.name, background, stratum, reach, UNION)
        );
        if (!first) continue;
        const cells = typeFinders.map((f) => {
          const c = recall.get(K(m.model.name, background, stratum, reach, f));
          return c ? pct(c.perTrial.type, c.trials) : "-";
        });
        const pair = recall.get(
          K(m.model.name, background, stratum, reach, "ledger-empty-pair")
        );
        say(
          `| ${stratum} | ${reach} | ${num(first.removed)} | ${cells.join(" | ")} | ${pair ? pct(pair.perTrial.pair, pair.trials) : "-"} |`
        );
      }
    }
    say();
    say("### New findings per trial, and the share that point at the hole");
    say();
    const volFinders = FINDER_NAMES.filter((f) =>
      [...volume.keys()].some(
        (k) => parts(k)[0] === m.model.name && parts(k)[3] === f
      )
    );
    say(`| Hole | ${volFinders.join(" | ")} |`);
    say(`| --- | ${volFinders.map(() => "---").join(" | ")} |`);
    for (const stratum of strata) {
      const cells = volFinders.map((f) => {
        const c = volume.get(K(m.model.name, background, stratum, f));
        return c && c.fresh
          ? `${(c.fresh / c.trials).toFixed(1)} (${pct(c.hits, c.fresh)})`
          : "0";
      });
      say(`| ${stratum} | ${cells.join(" | ")} |`);
    }
    const el = [...elements.entries()].filter(
      ([k]) =>
        parts(k)[0] === m.model.name && Number(parts(k)[1]) === background
    );
    if (el.length) {
      say();
      say("### Removed elements");
      say();
      say(
        "| Finder | Trials | Element tied to index nodes | Its code in the top 20 | Top 50 | Top 100 |"
      );
      say("| --- | --- | --- | --- | --- | --- |");
      for (const [k, c] of el) {
        if (parts(k)[2] === UNION) continue;
        say(
          `| ${parts(k)[2]} | ${c.trials} | ${c.tied} | ${pct(c.at[20], c.tied)} | ${pct(c.at[50], c.tied)} | ${pct(c.at[100], c.tied)} |`
        );
      }
      const u = elements.get(K(m.model.name, background, UNION));
      if (u) {
        say();
        say(
          `A neighbour of the removed element was flagged as lacking the kind of link it lost in ${u.neighbourShape} of ${u.trials} trials (${pct(u.neighbourShape, u.trials)}).`
        );
      }
    }
  }
}

const dir = dataDir();
writeFileSync(path.join(dir, "seeded-report.md"), `${out.join("\n")}\n`);
writeFileSync(
  path.join(dir, "seeded-results.json"),
  `${JSON.stringify(
    {
      specVersion: catalog.specVersion,
      models: models.map((m) => ({
        name: m.model.name,
        commit: m.model.commit,
        codeIndex: !!m.graph
      })),
      options: { backgrounds, seeds, maxTypes, maxElements },
      recall: [...recall].map(([k, c]) => ({
        model: parts(k)[0],
        background: Number(parts(k)[1]),
        hole: parts(k)[2],
        edgeRoute: parts(k)[3] === "edge route",
        finder: parts(k)[4],
        ...c
      })),
      volume: [...volume].map(([k, c]) => ({
        model: parts(k)[0],
        background: Number(parts(k)[1]),
        hole: parts(k)[2],
        finder: parts(k)[3],
        ...c
      })),
      elements: [...elements].map(([k, c]) => ({
        model: parts(k)[0],
        background: Number(parts(k)[1]),
        finder: parts(k)[2],
        ...c
      }))
    },
    null,
    1
  )}\n`
);
console.log(`Wrote ${path.join(dir, "seeded-report.md")}`);
