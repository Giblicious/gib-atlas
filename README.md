# Gib Atlas

Gib Atlas is an experimental, fully local semantic map for Obsidian. Version 0.1 is intentionally small: it turns notes into a stable dot plane so the spatial grammar can be evaluated before lots, buildings, roads, or terrain are introduced.

## Current grammar

- Several BGE Small English v1.5 topic vectors per note
- Modest removal of corpus-common semantic signal
- Adaptive mutual-neighbor graph
- Broad Louvain regions with finer nested neighborhoods
- Deterministic hierarchy-aware UMAP projection
- Mutual nearest-neighbor lines and subtle region boundaries
- Collision-only relaxation anchored to the semantic projection
- Pan, zoom, hover, and click-to-open

The model is downloaded once, then cached locally. Note text and embeddings are not sent to a service.

## Install with BRAT

Add `Giblicious/gib-atlas` as a beta plugin repository.

## Development

```sh
npm install
npm run build
npm run check
```

Gib Atlas began as an isolated visualization experiment derived from the local embedding principles used by Gib Search.
