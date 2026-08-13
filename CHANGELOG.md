# Changelog

## 0.6.14

- Replace visible-note epicenters with invisible semantic centroid anchors.
- Remove orbit paths and rotating note systems that fought collision and layout forces.
- Preserve local semantic shape inside each hub while positioning bridge notes by weighted multi-hub affinity.
- Draw only measured note-to-note relationships for bridges and focused notes.
- Replace orbital controls with concise hub separation, local cohesion, and bridge balance controls.

## 0.6.13

- Replace the leftover Semantic Colonies presentation with hotspot systems.
- Place every hotspot member in a visible orbital structure around its epicenter.
- Give bridge notes live, weighted trajectories between multiple hotspots.
- Add persistent low-speed orbital motion while preserving collision avoidance and semantic placement.
- Remove the obsolete grouping and visualization controls from the map and plugin settings.
- Replace neighborhood boundary tuning with hotspot spread, gravity, motion, and bridge controls.

## 0.6.12

- Replace fixed visual groupings with statistically differentiated semantic hotspots.
- Detect persistent local density peaks without requesting an arbitrary number of hubs.
- Classify notes as epicenters, members, satellites, bridges, or outliers using multi-hotspot affinity margins.
- Let hotspot gravity shape the vault layout while retaining the underlying semantic projection and fluid physics.
- Expose hotspot roles on hover and visually distinguish epicenters and cross-hotspot bridge notes.

## 0.6.11

- Replace the line-heavy Semantic Mycelium view with readable Semantic Colonies.
- Render related notes as softly filled organic bodies with nested boundaries and note nuclei.
- Show only a few strong bridges between colonies, revealing note-level semantic and manual links on focus.
- Throttle colony-field construction independently from the smooth display loop for better responsiveness.

## 0.6.10

- Replace Semantic Fabric's triangle mesh with a branching Semantic Mycelium visualization.
- Grow notes into local semantic root systems, then join neighborhoods through sparse shared trunks.
- Treat an active query as a temporary nutrient root and animate propagation through the actual branch network.
- Add tapered branches, fine hyphae, organic offshoots, and branch-aware hover signals without changing search ranking.
- Cache the mycelium skeleton and reduce secondary detail on mobile for responsive continuous motion.

## 0.6.9

- Replace the curved relationship overlay with a continuous deformable semantic mesh.
- Treat notes, semantic neighborhoods, and active queries as structural knots in the same fabric.
- Use semantic strength to control fiber density and weave emphasis rather than drawing independent relationship curves.
- Add localized tension pulses on hover and subtle shared material motion while respecting reduced-motion preferences.
- Render the fabric on a dedicated lightweight canvas layer for smoother animation on desktop and mobile.

## 0.6.8

- Add Semantic Fabric as an alternate live visualization for the search and dedicated Atlas maps.
- Bundle semantic relationships through shared neighborhood knots, with query-result bindings and focused strand emphasis.
- Persist the Terrain/Fabric choice and expose it as both an in-map control and a native plugin setting.
- Keep the fabric renderer mobile-aware by limiting visible relationship strands without changing graph data or search ranking.

## 0.6.7

- Separates physics updates from display rendering so expensive simulation can run at a controlled rate while motion renders every animation frame.
- Interpolates node and camera positions between simulation states to remove stepped movement and camera jolts.
- Keeps terrain and semantic analysis on their existing lower-frequency paths instead of coupling them to visual frame rate.

## 0.6.6

- Labels Meaning compass sectors from actual semantic topic communities instead of generic directions.
- Groups the Emotion compass into six readable families with click-through detail for individual emotions.
- Removes global graph rotation and replaces orbiting with subtle independent breathing motion.
- Tightens visual refresh timing so terrain, communities, nodes, and compass feedback update more cohesively.

## 0.6.5

- Gives Emotion, Purpose, Form, Position, and Meaning distinct spatial compass grammars.
- Replaces the color-wheel frame with restrained broken boundaries, analytical sectors, districts, fields, and axes.
- Adds perimeter labels, a center context marker, a compact geometry legend, and interactive arc readouts.
- Makes weak or absent qualities recede so each compass reflects the visible notes.

## 0.6.4

- Adds a faint radial compass boundary to the dedicated atlas view.
- Adds perspective-aware colored arcs aligned with each analytical direction.
- Scales arc prominence from the qualities present in the visible notes while keeping the map visually restrained.

## 0.6.3

- Organizes full-vault Emotion, Purpose, Form, and Position views radially around their pure category endpoints.
- Uses distance from the center to express dimensional strength while angle and color express the active category mixture.
- Adds a dynamic side color key whose dots identify the 100% category colors for the active perspective.

## 0.6.2

- Rebuilt Gib Atlas on the responsive query-centered semantic map foundation.
- Restored semantic search, the dedicated vault map, search-popup maps, and note neighborhoods.
- Added local Meaning, Emotion, Purpose, Form, and Position dimensions.
- Preserved query relevance as radial distance while analytical dimensions control relational placement.
- Added persistent local writing-profile caches on desktop and mobile.
- Carried forward the latest cooperative indexer, mobile background inference, cache, checkpoint, and UI-yield improvements.
- Deferred expensive relationship preparation until a map actually needs it, keeping ordinary search and startup light.
- Removed the terrain laboratory and land-partition experiments.
