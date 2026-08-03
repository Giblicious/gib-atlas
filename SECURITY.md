# Security

Please report security issues privately through GitHub's security advisory form for this repository. Do not open a public issue for an unpatched vulnerability.

Gib Atlas reads Markdown and text files from the active vault and keeps generated indexes and writing profiles on the current device. Inference uses a bundled WebAssembly runtime; desktop runs it in an Electron Web Worker and mobile runs it within the WebView. Desktop data stays within the plugin directory; mobile data uses device-local WebView storage. Runtime dependencies are pinned by the repository lockfile.

Before reporting an unexpected network request, note that BGE Small English v1.5 is downloaded from Hugging Face on first use. MobileBERT MNLI is downloaded when relationship intelligence or a non-semantic writing dimension needs an uncached judgment. Both models run locally after download. The inference runtime is bundled and does not use npm or a runtime CDN.
