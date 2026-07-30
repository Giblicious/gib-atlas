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

## Land-partition proof of concept

The map now establishes ownership topology before adding visual structures:

- A fixed world polygon is completely divided into regions, outlier lots, and countryland
- Every region is completely divided into non-overlapping neighborhoods
- Every neighborhood is completely divided into one weighted lot per file
- Every outlier also receives a lot in countryland
- File size and semantic isolation influence requested lot area
- A capacity-controlled power diagram prevents gaps and overlaps

The toolbar switches between this land partition and the underlying semantic point plane.

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
