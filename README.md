# Gib Atlas

Gib Atlas is an experimental, fully local semantic map for Obsidian. Version 0.1 is intentionally small: it turns notes into a stable dot plane so the spatial grammar can be evaluated before lots, buildings, roads, or terrain are introduced.

## Current grammar

- One BGE Small English v1.5 embedding per note
- Deterministic UMAP projection using cosine distance
- Mutual nearest-neighbor lines
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
