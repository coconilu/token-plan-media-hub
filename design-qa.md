# 历史产物页面 Design QA

## Evidence

- Source visual truth:
  - `C:\Users\admin\AppData\Local\Temp\codex-clipboard-44529496-38c7-4e55-a665-a2bf29c7b5d8.png` (`1404 x 312`)
  - `C:\Users\admin\AppData\Local\Temp\codex-clipboard-1c1519e2-2126-4166-8876-5efd5c94ee23.png` (`1383 x 399`)
- Browser-rendered implementation:
  - `C:\Users\admin\.codex\visualizations\2026\07\27\019fa268-bc76-7f01-bdb2-4a7802c15b04\history-artifacts-implementation.png` (`1264 x 1226`)
  - `C:\Users\admin\.codex\visualizations\2026\07\27\019fa268-bc76-7f01-bdb2-4a7802c15b04\history-artifacts-focused.png` (`1016 x 430`)
- Combined comparison:
  - `C:\Users\admin\.codex\visualizations\2026\07\27\019fa268-bc76-7f01-bdb2-4a7802c15b04\history-artifacts-comparison.png`
- Desktop viewport: `1280 x 720` CSS px, device scale factor `1`.
- Responsive check: `800 x 900` CSS px; body `clientWidth` and `scrollWidth` both `785px`.
- State: “历史产物 / 全部”总览，以及“音色”空状态。
- Density normalization: source and implementation were compared at native 1x pixels. The focused implementation capture was padded, not scaled, when combined with the source crop.

## Findings

No actionable P0, P1, or P2 findings remain.

### Required fidelity surfaces

- Fonts and typography: retained the product's existing Segoe UI / Microsoft YaHei UI stack, heading weights, cyan eyebrow treatment, and small secondary-copy hierarchy.
- Spacing and layout rhythm: the history filters reuse the generation studio tab container, padding, border, radius, gaps, and active state. The voice module has a clear section break below media history.
- Colors and visual tokens: retained the existing dark background, cyan active state, muted text, warning banner, and panel border tokens.
- Image quality and asset fidelity: the target contains UI icons rather than raster imagery. Existing Lucide icons are reused consistently; no placeholder, emoji, handcrafted SVG, or generated raster substitute was introduced.
- Copy and content: the page and navigation are renamed to “历史产物”; “音色” is a peer history category and retains the authorization, encrypted-reference, model-binding, creation, and preview semantics.

## Full-view comparison

The implementation preserves the source page shell, sidebar hierarchy, heading position, dark visual language, and card grid. The former “声音” sidebar item is removed, and “历史产物” occupies the former artifact entry as requested.

## Focused-region comparison

The focused comparison confirms that the history filter bar now uses the same visual structure as the generation studio: icon plus label, shared bordered container, cyan selected state, and a single horizontal category hierarchy. “音色” is added after “音频”.

## Interaction and runtime checks

- Opened “历史产物” from the sidebar.
- Switched from “全部” to “音色”.
- Confirmed `aria-pressed` follows the selected history filter.
- Used “创建音色” and confirmed navigation to the “声音复刻” generation workflow.
- Confirmed the voice-reference JSON artifact is not duplicated as a generic media card.
- Checked the `800 x 900` responsive breakpoint with no horizontal body overflow.
- Checked browser console warning/error logs: none.
- Production dashboard build passed.
- Repository tests passed: 10 files, 27 tests.

## Comparison history

### Iteration 1

- Finding: `[P2]` the “音色” filter displayed both the generic “暂无匹配产物” state and the dedicated “还没有本地音色” state.
- Impact: duplicated empty-state messaging made the newly consolidated module look like two unrelated sections.
- Fix: limited the generic empty state to media-only filters and left “全部 / 音色” to the voice module's own empty-state handling.
- Post-fix evidence: the final “音色” DOM and screenshot contain only the dedicated voice empty state, authorization banner, and creation action.

## Follow-up polish

- No blocking polish remains. A future data-rich pass can validate multi-row alignment with several real voice aliases and mixed media artifacts.

## Workbench artifact preview consistency

### Evidence

- Problem references:
  - `C:\Users\admin\AppData\Local\Temp\codex-clipboard-eeaf0a4e-f87d-4c51-be57-781de64c3f41.png`
  - `C:\Users\admin\AppData\Local\Temp\codex-clipboard-1053b1eb-22c1-4bd2-9dbd-606b37f32fbd.png`
  - `C:\Users\admin\AppData\Local\Temp\codex-clipboard-529de705-917f-48ee-aacf-ec35473fc06b.png`
- Browser-rendered implementation:
  - `C:\Users\admin\.codex\visualizations\2026\07\27\019fa268-bc76-7f01-bdb2-4a7802c15b04\workbench-artifact-preview-button.png`
  - `C:\Users\admin\.codex\visualizations\2026\07\27\019fa268-bc76-7f01-bdb2-4a7802c15b04\workbench-artifact-modal.png`
- Combined comparison:
  - `C:\Users\admin\.codex\visualizations\2026\07\27\019fa268-bc76-7f01-bdb2-4a7802c15b04\workbench-artifact-preview-comparison.png`
- Viewport: `1280 x 720` CSS px, device scale factor `1`.

### Findings

No actionable P0, P1, or P2 findings remain.

- The misleading “下载” label and raw content URL navigation were removed.
- The workbench now uses the same “打开原始文件” control and `ArtifactPreviewModal` component as history artifacts.
- The modal keeps the user inside the app, focuses the close button, and supports close-button, backdrop, and Escape-key dismissal.
- The generation studio description now says “预览” instead of “下载”.
- Text, image, video, audio, and safe-reference artifacts share the same modal route and their existing media-specific renderer.

### Interaction checks

- Selected an existing succeeded text-generation job.
- Opened the original-file modal from the workbench preview.
- Confirmed the visible close button receives focus.
- Closed the modal through the close button and through Escape.
- Confirmed the dialog is removed after each close action.
- Checked browser console warning/error logs: none.
- The current development data contained a real text artifact. Image, video, audio, and safe-reference behavior was verified through the shared modal and media-renderer code path without calling an external model or creating private media.

## History tab alignment

### Evidence

- Workbench reference:
  - `C:\Users\admin\AppData\Local\Temp\codex-clipboard-8dafcac6-2a52-4017-9049-63315ccfa0d4.png`
- Previous history state:
  - `C:\Users\admin\AppData\Local\Temp\codex-clipboard-d8cbbd7a-af69-44ff-99e2-d0cd2b6a2e7f.png`
- Browser-rendered implementation:
  - `C:\Users\admin\.codex\visualizations\2026\07\27\019fa268-bc76-7f01-bdb2-4a7802c15b04\history-tabs-aligned.png`
- Combined comparison:
  - `C:\Users\admin\.codex\visualizations\2026\07\27\019fa268-bc76-7f01-bdb2-4a7802c15b04\history-tabs-aligned-comparison.png`

### Findings

No actionable P0, P1, or P2 findings remain.

- Removed the history-only “全部” filter.
- Reused the exact workbench capability order and labels: “文本、图片、视频、语音、复刻、音色合成”.
- Media filtering now uses the artifact capability instead of broad MIME prefixes, so “语音” and “音色合成” remain distinct.
- “复刻” opens the reusable voice module instead of mixing voice references into generic media cards.
- The tab container, icon mapping, active treatment, keyboard button semantics, and `aria-pressed` behavior remain shared with the workbench.

### Interaction checks

- Opened “历史产物” from the sidebar.
- Confirmed exactly six category buttons and no “全部” button.
- Switched to “语音” and confirmed the selected state.
- Switched to “复刻” and confirmed the Voice Vault module, authorization warning, and local empty state.
- Production dashboard build passed.
- Repository tests passed: 10 files, 27 tests.

final result: passed
