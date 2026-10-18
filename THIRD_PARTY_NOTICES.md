# Third-party notices

The plugin depends on the following open-source software. Runtime dependencies are installed by DSH's package manager next to the plugin; KaTeX is bundled into `lib/client.js`.

| Package | Use | License |
| --- | --- | --- |
| [pdfjs-dist](https://github.com/mozilla/pdf.js) | PDF text extraction (host) | Apache-2.0 |
| [mammoth](https://github.com/mwilliamson/mammoth.js) | Word (.docx) text extraction (host) | BSD-2-Clause |
| [JSZip](https://github.com/Stuk/jszip) | PowerPoint (.pptx) reading (host) | MIT (dual-licensed MIT or GPL-3.0-or-later; used under MIT) |
| [@mozilla/readability](https://github.com/mozilla/readability) | Main-text extraction from web pages (host) | Apache-2.0 |
| [linkedom](https://github.com/WebReflection/linkedom) | DOM for Readability on the host | ISC |
| [KaTeX](https://github.com/KaTeX/KaTeX) | Math rendering on the board (bundled) | MIT |

DeepSeek Harness packages (`@deepseek-ai/*`) and React are provided by the DSH runtime and are not redistributed.

Artwork in `docs/assets/` and `icon.png` was created for this project with ChatGPT image generation. Sample courses in `samples/` were written for this project.
