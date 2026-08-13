# Changelog

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
