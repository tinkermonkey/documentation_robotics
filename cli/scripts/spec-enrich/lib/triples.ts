/**
 * Relationship triple ids ({source layer}.{source type}.{predicate}.{destination layer}.{destination type})
 * and how two of them compare. No catalog is loaded here, so any script can import it cheaply.
 */

export const parts = (id: string) => {
  const p = id.split(".");
  return { source: `${p[0]}.${p[1]}`, predicate: p[2], destination: `${p[3]}.${p[4]}`, sourceLayer: p[0], destLayer: p[3], sourceType: p[1], destType: p[4] };
};

/**
 * How a replacement triple's pair of element types compares with the original's: the same source
 * and destination, the two swapped, or a different pair. Only a same or reversed pair can take over
 * the original's model relationships (apply-walk.ts drops them otherwise); Context Studio compares
 * a delete's structured replacement by the same rule (tinkermonkey/context-studio#1398).
 */
export function pairOf(from: string, to: string): "same" | "reversed" | "different" {
  const a = parts(from),
    b = parts(to);
  if (a.source === b.source && a.destination === b.destination) return "same";
  if (a.source === b.destination && a.destination === b.source) return "reversed";
  return "different";
}
