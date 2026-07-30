# Gib Atlas

Gib Atlas is an experimental, fully local semantic map and procedural-cartography laboratory for Obsidian.

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

## Terrain laboratory

Version 0.6 provides an isolated terrain laboratory for developing the atlas's visual language without involving vault data. Open it from the mountain ribbon icon, the command palette, or plugin settings.

- Draw sharp mountain ranges with a freehand ridge pen
- Paint rolling elevation with signed raise and lower brushes
- Adjust tool size and strength live
- Generate deterministic variations with the shuffle control
- Toggle cartographic contours
- Undo or restore the demonstration geometry

The renderer combines a high-resolution vector ridge texture with a separately painted continuous height field. Browser-native WebGL derives directional geological detail, sharp normals, curvature, cast shadows, rock exposure, analytic contours, grid ink, and restrained surface texture. Interaction renders at a reduced internal resolution and automatically refines up to 2048 pixels on desktop or 1024 pixels on mobile. No 3D mesh or external service is used.

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
