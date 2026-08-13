# Gib Atlas

Gib Atlas is a fully local semantic search and writing-map plugin for Obsidian. It combines a responsive query-centered map with optional local analysis of meaning, emotion, purpose, form, and position.

## Features

- Semantic search powered by BGE Small English v1.5
- A query-centered map where distance represents ranked relevance
- Semantic angle and note-to-note relationships for natural clustering
- Optional Meaning, Emotion, Purpose, Form, and Position dimensions
- Radial analytical perspectives with a dynamic pure-color endpoint key
- Similarity, Topics, and Links grouping modes
- A dedicated vault map, an optional search-popup map, and note neighborhoods
- Semantic result highlighting and folder-aware ranking
- Local indexes and cached analysis on desktop and mobile
- Cooperative background indexing that yields while Obsidian is active

Meaning preserves the standard semantic map. The other dimensions change how notes relate around the query while relevance continues to control their distance from the center. Position compares notes with a reference claim supplied in plugin settings.

Indexing processes one note and one passage at a time, checkpoints safely, and uses background-worker inference on mobile when available. Relationship and writing analysis are prepared only when an Atlas view needs them.

## Privacy

Note text, embeddings, search queries, and writing profiles remain on the device. Models are downloaded when first needed and then cached locally.

## Install with BRAT

Add `Giblicious/gib-atlas` as a beta plugin repository.

## Development

```sh
npm install
npm run build
npm run check
```
