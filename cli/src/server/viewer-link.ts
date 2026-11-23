/**
 * Deep links into the shared viewer (issue 1279, design section 9).
 *
 * A link names a checkout and, optionally, a changeset or an element in it:
 *
 *   http://127.0.0.1:<port>/#/p/<project>/c/<checkout>/
 *   http://127.0.0.1:<port>/#/p/<project>/c/<checkout>/changesets/<id>?token=<token>
 *   http://127.0.0.1:<port>/#/p/<project>/c/<checkout>/elements/<id>?token=<token>
 *   http://127.0.0.1:<port>/#/p/<project>/c/<checkout>/changesets/<id>?element=<id>&token=<token>
 *
 * The route and the token are both in the URL fragment, never the query string: a browser never
 * sends the fragment, so the token stays out of server logs and Referer headers. Each name is
 * URL-encoded, so a worktree or changeset name can't change the route.
 *
 * A link is built from the server record alone and never starts a process
 * (`motivation.requirement.links-into-the-shared-viewer-start-no-process`).
 */

import type { CheckoutRef, ServerRecord, ViewerLink } from "../core/checkout-types.js";

/** What a link opens in the checkout, beyond the checkout itself. */
export interface ViewerLinkTarget {
  /** A changeset of the checkout, by id. */
  changeset?: string;
  /** An element of the checkout's model, by id. */
  element?: string;
}

/**
 * The deep link to `ref` (and to a changeset or element in it) on the central process `record`
 * describes. `token` is the process's token (`readServerToken`), or null when it runs without
 * auth.
 */
export function viewerUrl(
  record: Pick<ServerRecord, "port">,
  ref: CheckoutRef,
  target: ViewerLinkTarget = {},
  token: string | null = null
): ViewerLink {
  if (!Number.isInteger(record.port) || record.port <= 0 || record.port > 65535) {
    throw new Error(`Server record has no usable port: ${record.port}`);
  }
  if (!ref.project || !ref.checkout) throw new Error("A viewer link needs a project and a checkout.");
  const enc = encodeURIComponent;
  let route = `/p/${enc(ref.project)}/c/${enc(ref.checkout)}/`;
  const params = new URLSearchParams();
  if (target.changeset) {
    route += `changesets/${enc(target.changeset)}`;
    if (target.element) params.set("element", target.element);
  } else if (target.element) {
    route += `elements/${enc(target.element)}`;
  }
  if (token) params.set("token", token);
  const query = params.toString();

  const link: ViewerLink = {
    url: `http://127.0.0.1:${record.port}/#${route}${query ? `?${query}` : ""}`,
    project: ref.project,
    checkout: ref.checkout,
  };
  if (target.changeset) link.changeset = target.changeset;
  if (target.element) link.element = target.element;
  return link;
}
