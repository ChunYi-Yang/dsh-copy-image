// dsh-copy-image — host half.
//
// The whole feature lives in the browser half (lib/client.js): it reads the
// image the user clicked, draws it onto a canvas and writes a PNG into the
// system clipboard. A host half is still required, because a DSH bundle entry
// must export an `apply` for the loader to mount it.
//
// Keeping this file empty is deliberate: no routes, no privileged APIs, no
// network. The plugin cannot read files or credentials, which is what lets the
// README promise "nothing leaves the renderer".

/** No-op host half; the Client module owns the rendering. */
export function apply() {}