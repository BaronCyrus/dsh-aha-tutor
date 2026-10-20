// Styles for the whole plugin page, injected once as a <style> tag. App
// chrome follows DSH's theme variables (--dsw-alias-*); the board has its
// own paper (light) and chalkboard (dark) palettes.

import { BOARD_FONT_FILES } from '../core/board-fonts.js'

// The bundled handwriting fonts first (Caveat for Latin, LXGW WenKai GB for
// Chinese, served by the host's font route); the per-OS handwriting and Kaiti
// stack covers characters outside their subsets.
export const BOARD_FONT = "'Aha Hand Latin','Aha Hand','Segoe Print','Ink Free','Bradley Hand','Chalkboard SE','Noteworthy','Comic Sans MS','LXGW WenKai','Kaiti SC','STKaiti','KaiTi','楷体',cursive"

// Relative URLs resolve against the page, like the plugin's other routes.
// Each slice downloads only when a character in its range is drawn.
const FONT_FACES = BOARD_FONT_FILES.map(entry => `@font-face{font-family:'${entry.family}';font-style:normal;font-weight:400;font-display:swap;src:url('api/aha-tutor/font?f=${entry.file}') format('woff2');unicode-range:${entry.unicodeRange}}`).join('\n')

export const STYLE = `${FONT_FACES}
.aha{container-type:inline-size;container-name:aha;--aha-gap:12px;--aha-radius:var(--dsw-radius-md,12px);--aha-text:var(--dsw-alias-label-primary,#1f2328);--aha-muted:var(--dsw-alias-label-tertiary,#6b7280);--aha-dim:var(--dsw-alias-label-caption,#9ca3af);--aha-border:var(--dsw-alias-border-l2,#e5e7eb);--aha-bg:var(--dsw-alias-bg-base,#fafafa);--aha-surface:var(--dsw-alias-bg-layer-1,#fff);--aha-soft:var(--dsw-alias-bg-module-platform,#f4f5f7);--aha-hover:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));--aha-brand:var(--dsw-alias-state-business-primary,#3b6cf6);--aha-primary-bg:var(--dsw-alias-brand-primary,#111);--aha-primary-fg:var(--dsw-alias-label-primary-inverted,#fff);--aha-ok:var(--dsw-alias-state-success-primary,#1f9d55);--aha-bad:var(--dsw-alias-state-error-primary,#d64545);
  display:flex;flex:1 1 auto;height:100%;min-height:0;overflow:hidden;background:var(--aha-bg);color:var(--aha-text);font-size:var(--dsh-content-font-size,14px);line-height:1.6;box-sizing:border-box}
[data-platform=darwin] .aha{padding-top:var(--dsh-frame-top-clearance,0px)}
.aha *,.aha *::before,.aha *::after{box-sizing:border-box}
.aha h1,.aha h2,.aha h3,.aha h4,.aha p{margin:0}
.aha button{font:inherit}
.aha-nav{width:188px;flex:0 0 188px;display:flex;flex-direction:column;gap:2px;padding:14px 10px;border-right:1px solid var(--aha-border);overflow:auto}
.aha-brand{display:flex;align-items:center;gap:8px;padding:4px 10px 14px;font-weight:600;font-size:15px}
.aha-brand small{display:block;font-weight:400;color:var(--aha-muted);font-size:11px;line-height:14px}
.aha-navItem{display:flex;align-items:center;gap:9px;width:100%;padding:7px 10px;border:0;border-radius:8px;background:transparent;color:var(--aha-text);cursor:pointer;text-align:left}
.aha-navItem:hover{background:var(--aha-hover)}.aha-navItem[data-active=true]{background:var(--aha-soft);font-weight:600}
.aha-navItem svg{flex:0 0 auto;opacity:.8}
.aha-main{flex:1 1 auto;min-width:0;min-height:0;overflow:auto;position:relative}
.aha-page{max-width:1080px;margin:0 auto;padding:24px 28px 64px;display:flex;flex-direction:column;gap:18px}
.aha-page[data-wide=true]{max-width:none;padding:12px 16px 16px;height:100%}
.aha-title{font-size:22px;line-height:30px;font-weight:650}
.aha-subtitle{color:var(--aha-muted)}
.aha-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.aha-spread{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.aha-col{display:flex;flex-direction:column;gap:10px}
.aha-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.aha-card{border:1px solid var(--aha-border);border-radius:var(--aha-radius);background:var(--aha-surface);padding:14px 16px;display:flex;flex-direction:column;gap:8px}
.aha-card[data-click=true]{cursor:pointer;transition:border-color .15s,transform .15s}.aha-card[data-click=true]:hover{border-color:var(--aha-brand)}
.aha-cardTitle{font-weight:600;font-size:15px;line-height:22px}
.aha-hint{color:var(--aha-muted);font-size:12.5px;line-height:19px}
.aha-aboutHead{display:flex;align-items:center;gap:12px}
.aha-aboutLogo{width:48px;height:48px;flex:0 0 auto;border-radius:12px;display:flex;align-items:center;justify-content:center;background:var(--aha-soft)}
.aha-aboutIntro{margin:2px 0 4px;line-height:22px}
a.aha-btn{text-decoration:none}
.aha-sponsors{display:flex;flex-wrap:wrap;justify-content:center;gap:24px;padding:8px 0 2px}
.aha-sponsors figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:8px}
.aha-sponsors img{width:180px;height:180px;padding:8px;border-radius:14px;background:#fff;box-sizing:content-box}
.aha-sponsors figcaption{font-weight:600;font-size:13px}
.aha-error{color:var(--aha-bad);font-size:13px}
.aha-ok{color:var(--aha-ok)}
.aha-tag{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:999px;background:var(--aha-soft);color:var(--aha-muted);font-size:12px;line-height:20px;white-space:nowrap}
.aha-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:5px 14px;border-radius:9px;border:1px solid var(--aha-border);background:var(--aha-surface);color:var(--aha-text);cursor:pointer;white-space:nowrap}
.aha-btn:hover:not(:disabled){border-color:var(--aha-brand)}.aha-btn:disabled{opacity:.5;cursor:default}
.aha-btn[data-kind=primary]{background:var(--aha-primary-bg);border-color:var(--aha-primary-bg);color:var(--aha-primary-fg)}.aha-btn[data-kind=primary]:hover:not(:disabled){filter:brightness(1.07)}
.aha-btn[data-kind=ghost]{border-color:transparent;background:transparent}.aha-btn[data-kind=ghost]:hover:not(:disabled){background:var(--aha-soft)}
.aha-btn[data-kind=danger]{color:var(--aha-bad)}
.aha-btn[data-size=sm]{min-height:26px;padding:2px 10px;font-size:12.5px;border-radius:7px}
.aha-input,.aha-textarea,.aha-select{width:100%;padding:8px 11px;border:1px solid var(--aha-border);border-radius:9px;background:var(--aha-surface);color:var(--aha-text);font:inherit;outline:none}
.aha-input:focus,.aha-textarea:focus,.aha-select:focus{border-color:var(--aha-brand)}
.aha-textarea{resize:vertical;min-height:72px;line-height:21px}
.aha-label{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--aha-muted)}
.aha-progress{height:6px;border-radius:999px;background:var(--aha-soft);overflow:hidden}.aha-progress>div{height:100%;background:var(--aha-brand);border-radius:inherit;transition:width .3s}
.aha-tabs{display:flex;gap:4px;border-bottom:1px solid var(--aha-border);overflow-x:auto}
.aha-tab{padding:8px 12px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--aha-muted);cursor:pointer;white-space:nowrap}
.aha-tab[data-active=true]{color:var(--aha-text);border-bottom-color:var(--aha-brand);font-weight:600}
.aha-chip{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;border:1px solid var(--aha-border);background:var(--aha-surface);color:var(--aha-text);cursor:pointer}
.aha-chip[data-active=true]{border-color:var(--aha-brand);color:var(--aha-brand);background:color-mix(in srgb,var(--aha-brand) 8%,transparent)}
.aha-hero{display:flex;flex-direction:column;gap:14px;padding:26px 24px;border-radius:18px;border:1px solid var(--aha-border);background:linear-gradient(135deg,color-mix(in srgb,var(--aha-brand) 9%,var(--aha-surface)),var(--aha-surface))}
.aha-heroTitle{font-size:26px;line-height:34px;font-weight:700}
.aha-composer{display:flex;flex-direction:column;gap:10px;border:1px solid var(--aha-border);border-radius:14px;background:var(--aha-surface);padding:12px}
.aha-composer textarea{border:0;outline:none;resize:none;background:transparent;color:var(--aha-text);font:inherit;font-size:15px;line-height:24px;min-height:52px}
.aha-option{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border:1px solid var(--aha-border);border-radius:10px;background:var(--aha-surface);cursor:pointer;text-align:left;color:var(--aha-text)}
.aha-option[data-active=true]{border-color:var(--aha-brand);box-shadow:0 0 0 1px var(--aha-brand) inset}
.aha-option small{color:var(--aha-muted);font-size:12px;line-height:17px}
.aha-tree{display:flex;flex-direction:column;gap:10px;border:0;margin:0;padding:0;min-width:0}
.aha-tree:disabled{opacity:.6}
.aha-proposal{border-color:var(--aha-brand)}
.aha-diff{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px;font-size:13.5px}
.aha-diff li{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.aha-diffTag{flex:0 0 auto;padding:0 6px;border-radius:6px;font-size:12px;line-height:18px;background:var(--aha-soft);color:var(--aha-muted)}
.aha-diff li[data-kind=added] .aha-diffTag{background:color-mix(in srgb,var(--aha-ok) 16%,transparent);color:var(--aha-ok)}
.aha-diff li[data-kind=removed] .aha-diffTag{background:color-mix(in srgb,var(--aha-bad) 14%,transparent);color:var(--aha-bad)}
.aha-menuAnchor{position:relative;display:inline-flex}
.aha-menu{position:absolute;right:0;top:110%;z-index:20;padding:6px;gap:2px;min-width:140px}
.aha-menu .aha-btn{justify-content:flex-start}
.aha-unit{border:1px solid var(--aha-border);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;background:var(--aha-surface)}
.aha-lecture{margin-left:10px;padding-left:12px;border-left:2px solid var(--aha-border);display:flex;flex-direction:column;gap:4px}
.aha-lesson{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:8px}
.aha-lesson:hover{background:var(--aha-soft)}
.aha-lesson input{flex:1;border:1px solid transparent;background:transparent;color:inherit;font:inherit;padding:2px 6px;border-radius:6px}
.aha-lesson input:focus{border-color:var(--aha-border);outline:none;background:var(--aha-surface)}
.aha-dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto;background:var(--aha-border)}
.aha-dot[data-state=learning]{background:#e0a21e}.aha-dot[data-state=done]{background:var(--aha-ok)}
.aha-meter{display:inline-flex;gap:2px}.aha-meter i{width:6px;height:10px;border-radius:2px;background:var(--aha-border)}.aha-meter i[data-on=true]{background:var(--aha-ok)}
.aha-empty{padding:28px;text-align:center;color:var(--aha-muted);border:1px dashed var(--aha-border);border-radius:12px}
.aha-spinner{width:16px;height:16px;border-radius:50%;border:2px solid var(--aha-border);border-top-color:var(--aha-brand);animation:aha-spin .8s linear infinite;flex:0 0 auto}
@keyframes aha-spin{to{transform:rotate(360deg)}}
.aha-modalBack{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:1000;padding:20px}
.aha-modal{width:min(560px,100%);max-height:86vh;overflow:auto;border-radius:16px;background:var(--aha-surface);border:1px solid var(--aha-border);padding:18px 20px;display:flex;flex-direction:column;gap:12px;box-shadow:0 18px 50px rgba(0,0,0,.25)}
.aha-toast{position:fixed;right:20px;bottom:20px;z-index:1001;padding:10px 14px;border-radius:10px;background:var(--aha-primary-bg);color:var(--aha-primary-fg);font-size:13px;max-width:420px;box-shadow:0 8px 24px rgba(0,0,0,.2)}
.aha-markdown{font-size:14px;line-height:23px}
.aha-split{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:14px;min-height:0;height:100%}
@container aha (max-width:1060px){.aha-nav{width:56px;flex-basis:56px}.aha-navItem span,.aha-brand small,.aha-brand span{display:none}}
/* One column: a page with a side list (instant answers, shorts) scrolls as a whole, the list last. Its classroom takes its natural height, with a board of about 60% of the screen, so nothing under it can squeeze the controls. */
@container aha (max-width:1060px){.aha-split{grid-template-columns:1fr;height:auto}.aha-page[data-wide=true]:has(>.aha-split){height:auto}.aha-split .aha-class{height:auto}.aha-split .aha-classMain{min-height:0}.aha-split .aha-stage{flex:0 0 auto;min-height:0;height:clamp(300px,60vh,640px)}.aha-split .aha-transcript{max-height:260px}}

/* ── classroom ─────────────────────────────────────────────────────────── */
.aha-class{display:flex;flex-direction:column;gap:10px;height:100%;min-height:0;container-type:inline-size;container-name:classroom}
.aha-classBody{flex:1 1 auto;min-height:0;display:flex;gap:12px}
.aha-classMain{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;gap:10px}
.aha-panel{flex:0 0 clamp(220px,26cqi,300px);width:clamp(220px,26cqi,300px);min-height:0;display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid var(--aha-border);border-radius:16px;background:var(--aha-surface)}
.aha-panelHead{font-size:13px;color:var(--aha-muted)}
.aha-goals{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.aha-goals li{display:flex;gap:8px;align-items:flex-start;font-size:13px;line-height:19px;color:var(--aha-muted)}
.aha-goals li[data-state=current],.aha-goals li[data-state=done],.aha-goals li[data-state=plain]{color:var(--aha-text)}
.aha-goals li[data-state=current]{font-weight:600}
.aha-goalMark{flex:0 0 20px;height:20px;border-radius:50%;border:1.5px solid var(--aha-border);display:inline-flex;align-items:center;justify-content:center;font-size:11px;line-height:1}
.aha-goals li[data-state=current] .aha-goalMark{border-color:var(--aha-brand);color:var(--aha-brand)}
.aha-goals li[data-state=done] .aha-goalMark{background:var(--aha-ok);border-color:var(--aha-ok);color:#fff}
.aha-transcript{flex:1 1 auto;min-height:80px;overflow:auto;display:flex;flex-direction:column;gap:2px}
.aha-line{display:flex;gap:6px;align-items:flex-start;width:100%;padding:6px 8px;border:0;border-radius:8px;background:transparent;color:var(--aha-muted);font:inherit;font-size:13px;line-height:19px;text-align:left;cursor:pointer}
.aha-line:hover:not(:disabled){background:var(--aha-hover)}
.aha-line:disabled{cursor:default}
.aha-line[data-current=true]{background:var(--aha-soft);color:var(--aha-text)}
.aha-line[data-aside=true]{margin-left:10px;width:calc(100% - 10px);border-left:2px dashed var(--aha-ok);border-radius:0 8px 8px 0}
.aha-line[data-kind=question],.aha-line[data-kind=reexplain],.aha-line[data-kind=correction]{color:var(--aha-text);font-weight:600}
.aha-lineText{flex:1;min-width:0;overflow-wrap:anywhere}
.aha-panel .aha-askBox{flex-direction:column;align-items:stretch}
.aha-panel .aha-askBox .aha-btn{align-self:flex-end}
.aha-classBar{display:flex;align-items:center;gap:10px;justify-content:space-between;flex-wrap:wrap}
.aha-crumb{color:var(--aha-muted);font-size:12.5px}
.aha-stage{position:relative;flex:1 1 auto;min-height:360px;display:flex;flex-direction:column;border-radius:16px;overflow:hidden;border:1px solid var(--aha-border)}
.aha-controls{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:center}
.aha-caption{min-height:44px;padding:8px 16px;text-align:center;font-size:15px;line-height:22px;color:var(--aha-text)}
.aha-caption .katex{font-size:1em}
/* Why the lesson went silent, above the controls; the buttons wrap under the text when narrow. */
.aha-voiceNote{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;align-self:center;width:min(100%,760px);padding:8px 10px 8px 14px;border-radius:12px;background:var(--aha-soft);border:1px solid var(--aha-border);color:var(--aha-text);font-size:13px;line-height:19px}
.aha-voiceNoteText{flex:1 1 260px;min-width:0;overflow-wrap:anywhere}
.aha-voiceNoteActions{display:flex;align-items:center;gap:4px;margin-left:auto}
/* Narrow: the panel goes under the board and the classroom scrolls, with the panel's header peeking in at the bottom. */
@container classroom (max-width:900px){.aha-classBody{flex-direction:column;overflow-y:auto}.aha-classMain{flex:1 0 auto;min-height:calc(100% - 52px)}.aha-stage{min-height:300px}.aha-panel{flex:0 0 auto;width:auto}.aha-transcript{flex:0 1 auto;max-height:260px}}
.aha-checkCard{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);width:min(600px,calc(100% - 28px));border-radius:14px;background:var(--aha-surface);border:1px solid var(--aha-border);box-shadow:0 14px 40px rgba(0,0,0,.22);padding:12px 14px 0;display:flex;flex-direction:column;gap:8px;z-index:5;max-height:62%;overflow:auto}
.aha-checkCard .aha-itemActions{position:sticky;bottom:0;background:var(--aha-surface);padding:8px 0 12px;margin-top:2px}
.aha-options[data-grid=true]{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.aha-checkCard .aha-option{padding:7px 10px}
.aha-askBox{display:flex;gap:8px;align-items:flex-end}
.aha-buildLog{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px}
.aha-buildLog li{display:flex;gap:10px;align-items:center;font-size:14px;color:var(--aha-muted)}
.aha-buildLog li[data-state=done],.aha-buildLog li[data-state=current]{color:var(--aha-text)}
.aha-buildLog li[data-state=current]{font-weight:600}
.aha-buildMark{flex:0 0 22px;height:22px;border-radius:50%;border:1.5px solid var(--aha-border);display:inline-flex;align-items:center;justify-content:center;font-size:12px}
.aha-buildLog li[data-state=done] .aha-buildMark{background:var(--aha-ok);border-color:var(--aha-ok);color:#fff}
.aha-buildLog li[data-state=current] .aha-buildMark{border-color:var(--aha-brand)}
.aha-buildMark .aha-spinner{width:12px;height:12px}
.aha-outlinePreview{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;align-items:start}
.aha-outlinePreview .aha-card[data-writing=true]{border-style:dashed;border-color:var(--aha-brand)}
.aha-outlineLessons{margin:0;padding-left:18px;font-size:13px;line-height:20px}
.aha-itemFigure{align-self:flex-start;width:min(100%,420px);box-sizing:border-box;padding:8px;border-radius:10px;background:#fffdf8;border:1px solid var(--aha-border)}
.aha-itemFigure svg{display:block;width:100%;height:auto;max-height:320px}
.aha-confidence[data-nudge=true]{animation:aha-nudge .5s ease 2;border-radius:10px;outline:2px solid var(--aha-brand);outline-offset:3px}
@keyframes aha-nudge{50%{transform:translateX(3px)}}
@media (prefers-reduced-motion:reduce){.aha-confidence[data-nudge=true]{animation:none}}
.aha-streak{background:color-mix(in srgb,var(--aha-ok) 14%,transparent);color:var(--aha-ok)}
.aha-summary{gap:12px}
.aha-stars{font-size:28px;letter-spacing:4px;color:#e0a21e;line-height:1}
.aha-stars span{color:var(--aha-border)}
.aha-summaryStats{gap:24px}
.aha-summaryStats span{display:flex;flex-direction:column;font-size:12.5px;color:var(--aha-muted)}
.aha-summaryStats b{font-size:22px;color:var(--aha-text)}
.aha-conceptMove{gap:8px;font-size:13.5px;flex-wrap:wrap}
.aha-level{padding:0 8px;border-radius:999px;font-size:12px;line-height:20px;background:var(--aha-soft);color:var(--aha-muted)}
.aha-level[data-level=weak]{background:color-mix(in srgb,var(--aha-bad) 14%,transparent);color:var(--aha-bad)}
.aha-level[data-level=learning]{background:color-mix(in srgb,#e08a1e 16%,transparent);color:#b86b0c}
.aha-level[data-level=proficient]{background:color-mix(in srgb,var(--aha-brand) 14%,transparent);color:var(--aha-brand)}
.aha-level[data-level=mastered]{background:color-mix(in srgb,var(--aha-ok) 16%,transparent);color:var(--aha-ok)}
.aha-nextStep{flex-direction:row;align-items:center;gap:12px;flex-wrap:wrap;border-color:color-mix(in srgb,var(--aha-brand) 40%,var(--aha-border))}
.aha-sourceList{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px;font-size:13.5px;line-height:20px}
.aha-sourceList a{color:var(--aha-brand);text-decoration:none;overflow-wrap:anywhere}
.aha-sourceList a:hover{text-decoration:underline}
.aha-sourceList p{margin:2px 0 0;font-size:12.5px;line-height:18px}
.aha-sources summary{cursor:pointer;color:var(--aha-muted);font-size:13px}
.aha-sources[open] summary{margin-bottom:6px}
.aha-planItem{display:flex;align-items:center;gap:8px;min-height:36px;flex-wrap:wrap}
.aha-planTitle{flex:1;min-width:140px}
.aha-planItem[data-checked=true] .aha-planTitle{color:var(--aha-muted);text-decoration:line-through;text-decoration-color:color-mix(in srgb,var(--aha-muted) 60%,transparent)}
.aha-check{width:18px;height:18px;margin:0;accent-color:var(--aha-ok);cursor:pointer;flex:0 0 auto}
.aha-check:disabled{cursor:default;opacity:.85}
.aha-calendar{container-type:inline-size;container-name:calendar}
.aha-calGrid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
.aha-calHead{text-align:center;font-size:12px;color:var(--aha-muted);padding:2px 0}
.aha-calDay{display:flex;flex-direction:column;align-items:stretch;gap:2px;min-height:86px;padding:4px 5px;border:1px solid var(--aha-border);border-radius:8px;background:var(--aha-surface);color:var(--aha-text);font:inherit;text-align:left;cursor:pointer;overflow:hidden}
.aha-calDay:hover{background:var(--aha-hover)}
.aha-calDay[data-past=true]{background:color-mix(in srgb,var(--aha-soft) 55%,var(--aha-surface))}
.aha-calDay[data-today=true]{border-color:var(--aha-brand)}
.aha-calDay[data-selected=true]{outline:2px solid var(--aha-brand);outline-offset:-1px}
.aha-calNum{font-size:12.5px;font-weight:600}
.aha-calDay[data-today=true] .aha-calNum{color:var(--aha-brand)}
.aha-calItem{font-size:11.5px;line-height:16px;padding:0 4px;border-radius:4px;background:color-mix(in srgb,var(--aha-brand) 12%,transparent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.aha-calItem[data-kind=review]{background:color-mix(in srgb,var(--aha-ok) 14%,transparent)}
.aha-calItem[data-kind=exam]{background:color-mix(in srgb,var(--aha-bad) 16%,transparent)}
.aha-calItem[data-checked=true]{opacity:.55;text-decoration:line-through}
.aha-calMore{font-size:11px;color:var(--aha-muted)}
@container calendar (max-width:560px){.aha-calDay{min-height:54px}.aha-calItem{font-size:0;height:5px;padding:0}.aha-calMore{font-size:10px}}
.aha-workPreview{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border:1px dashed var(--aha-border);border-radius:10px;background:var(--aha-soft);font-size:13.5px}
.aha-wrongStep{display:flex;flex-direction:column;gap:2px;margin-top:6px;padding:6px 10px;border-left:3px solid var(--aha-bad);border-radius:0 8px 8px 0;background:color-mix(in srgb,var(--aha-bad) 6%,transparent)}
.aha-feedback{padding:8px 12px;border-radius:10px;background:var(--aha-soft);font-size:13.5px}
.aha-feedback[data-ok=true]{background:color-mix(in srgb,var(--aha-ok) 12%,var(--aha-surface))}
.aha-feedback[data-ok=false]{background:color-mix(in srgb,var(--aha-bad) 10%,var(--aha-surface))}

/* ── the board ─────────────────────────────────────────────────────────── */
.aha-board{--ink:#23262f;--ink-soft:#4a4f5c;--head:#1f4fb8;--marker:rgba(255,214,79,.62);--accent:#d64545;--accent2:#2f9e6e;--paper:#fdfcf8;--grid:rgba(40,50,80,.05);--note:#fff7da;--note-line:#e9c45a;--pencil:#c98a2c;
  position:relative;flex:1 1 auto;min-height:0;container-type:inline-size;container-name:board;background:var(--paper);background-image:radial-gradient(var(--grid) 1px,transparent 1.2px);background-size:22px 22px;color:var(--ink);font-family:${BOARD_FONT};overflow:hidden}
.aha-board[data-font=standard]{font-family:inherit}
.aha-board[data-theme=dark]{--ink:#ecebe4;--ink-soft:#c9c8bf;--head:#9cc2ff;--marker:rgba(214,178,58,.45);--accent:#ff8a80;--accent2:#7fd6a8;--paper:#1d2622;--grid:rgba(255,255,255,.05);--note:#2a3530;--note-line:#8f7a2f;--pencil:#e7c27a}
.aha-boardScroll{position:absolute;inset:0;overflow:auto;padding:22px 30px 40px}
.aha-boardTitle{font-size:28px;line-height:38px;color:var(--head);margin:0 0 14px;font-weight:700}
.aha-boardTitle span{background:linear-gradient(transparent 62%,var(--marker) 62%,var(--marker) 92%,transparent 92%)}
.aha-cols{display:grid;grid-template-columns:1fr 1fr;gap:34px;align-items:start}
.aha-colBody{display:flex;flex-direction:column;gap:12px;min-width:0}
.aha-op{position:relative;isolation:isolate;min-width:0;font-size:19px;line-height:30px}
/* Text hugs its own width so the highlighter covers the words, not the column. */
.aha-op:is([data-t=p],[data-t=h],[data-t=list]){align-self:flex-start;max-width:100%}
.aha-op[data-now=true]::after{content:'';position:absolute;inset:-2px -6px;border-radius:9px;background:var(--marker);opacity:.42;z-index:-1;pointer-events:none;animation:aha-sweep .55s ease-out both}
.aha-op[data-now=true]:not([data-t=p],[data-t=h],[data-t=list])::after{background:transparent;box-shadow:0 0 0 3px var(--marker);opacity:1}
@keyframes aha-sweep{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
@media (prefers-reduced-motion:reduce){.aha-op[data-now=true]::after{animation:none}}
.aha-op-h{font-size:23px;line-height:32px;color:var(--head);font-weight:700}
.aha-op-h span{background:linear-gradient(transparent 60%,var(--marker) 60%,var(--marker) 92%,transparent 92%)}
.aha-op-p,.aha-op-note,.aha-op-h,.aha-boardTitle{white-space:pre-line}
.aha-op-p strong{font-weight:700}
.aha-op mark{background:var(--marker);color:inherit;border-radius:3px;padding:0 2px}
.aha-op-math{display:flex;justify-content:safe center;font-size:1.06em;overflow-x:auto;overflow-y:hidden;font-family:inherit}
.aha-op-math .katex{font-size:1.15em}
/* Too long for one line even at 70 %: break after =, + and → as inline math does (board/fit.js). */
.aha-op-math[data-fit=wrap] .katex-display>.katex{white-space:normal}
/* An equation number follows its formula instead of covering the formula's end. */
.aha-op-math .katex-display>.katex>.katex-html>.katex-tag{position:static;display:inline-block;margin-left:1em}
.aha-op-list{margin:0;padding-left:1.3em}.aha-op-list li{margin:2px 0}
.aha-op-note{border:2px solid var(--note-line);background:var(--note);border-radius:12px;padding:8px 12px}
.aha-op-note[data-tone=warn]{--note-line:var(--accent)}.aha-op-note[data-tone=tip]{--note-line:var(--accent2)}
.aha-op-figure{display:flex;flex-direction:column;align-items:center;gap:4px;width:100%}
.aha-op-figure>div{width:100%;display:flex;justify-content:center}
.aha-op-figure svg{width:100%;max-width:560px;height:auto;max-height:380px;overflow:visible}
.aha-figCaption{font-size:15px;color:var(--ink-soft)}
.aha-board[data-theme=dark] .aha-op-figure svg [stroke="#2b2b2b"],.aha-board[data-theme=dark] .aha-op-figure svg [stroke="#23262f"]{stroke:#ecebe4}
.aha-board[data-theme=dark] .aha-op-figure svg [fill="#2b2b2b"],.aha-board[data-theme=dark] .aha-op-figure svg text:not([fill]){fill:#ecebe4}
.aha-op-table{border-collapse:collapse;font-size:16px;line-height:24px}
.aha-op-table th,.aha-op-table td{border:1.6px solid var(--ink-soft);padding:3px 10px;text-align:left}
.aha-op-table th{color:var(--head)}
.aha-op-code{margin:0;padding:10px 12px;border-radius:10px;background:rgba(0,0,0,.05);font:13.5px/20px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre;overflow:auto;color:var(--ink)}
.aha-board[data-theme=dark] .aha-op-code{background:rgba(255,255,255,.06)}
.aha-op-anim{width:100%;border:0;border-radius:10px;background:transparent}
.aha-op[data-aside=true]{padding-left:10px;border-left:3px dashed var(--accent2)}
.aha-markRing{position:absolute;inset:-6px -10px;border:2.4px solid var(--accent);border-radius:40% 45% 42% 48%;pointer-events:none;opacity:.85}
.aha-markLine{position:absolute;left:0;right:0;bottom:-2px;height:3px;background:var(--accent);border-radius:3px;pointer-events:none}
.aha-markBox{position:absolute;inset:-4px -6px;border:2.4px solid var(--accent);border-radius:6px;pointer-events:none}
.aha-pencil{position:absolute;width:26px;height:26px;pointer-events:none;transform:translate(-3px,-22px) rotate(8deg);transition:left .06s linear,top .06s linear;z-index:3;filter:drop-shadow(0 2px 2px rgba(0,0,0,.2))}
.aha-pencil[data-glide=false]{transition:none}
.aha-pager{position:absolute;right:12px;top:10px;display:flex;gap:6px;z-index:4}
.aha-pager button{width:26px;height:26px;border-radius:7px;border:1px solid var(--ink-soft);background:var(--paper);color:var(--ink);cursor:pointer;font-size:12px}
.aha-pager button[data-active=true]{background:var(--ink);color:var(--paper)}
.aha-prep{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(440px,calc(100% - 28px));display:flex;flex-direction:column;gap:8px;padding:14px 16px;border-radius:14px;background:var(--aha-surface);border:1px solid var(--aha-border);box-shadow:0 14px 40px rgba(0,0,0,.18);color:var(--aha-text);z-index:4}
.aha-prepStages{display:flex;gap:6px;margin:0;padding:0;list-style:none;counter-reset:prep}
.aha-prepStages li{counter-increment:prep;display:flex;align-items:center;gap:6px;flex:1;padding:4px 10px;border-radius:999px;background:var(--aha-soft);color:var(--aha-muted);font-size:12.5px}
.aha-prepStages li::before{content:counter(prep);display:inline-grid;place-items:center;width:18px;height:18px;border-radius:50%;background:var(--aha-border);color:var(--aha-surface);font-size:11px;font-weight:600}
.aha-prepStages li[data-state=now]{background:color-mix(in srgb,var(--aha-brand) 14%,transparent);color:var(--aha-text);font-weight:600}
.aha-prepStages li[data-state=now]::before{background:var(--aha-brand)}
.aha-prepStages li[data-state=done]{color:var(--aha-text)}
.aha-prepStages li[data-state=done]::before{content:'✓';background:var(--aha-ok)}
.aha-prepNow{font-size:14px;line-height:22px}
.aha-prepHint{font-size:15px}
.aha-prepHint[data-hand=true]{font-family:${BOARD_FONT};font-size:16px}
.aha-buffering{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:max-content;max-width:calc(100% - 28px);display:flex;align-items:center;gap:10px;padding:10px 16px;border-radius:12px;background:var(--aha-surface);border:1px solid var(--aha-border);color:var(--aha-text);font-family:inherit;z-index:4}
@container board (max-width:640px){.aha-cols{grid-template-columns:1fr}.aha-boardScroll{padding:16px}}
/* Board pages laid out off screen for PDF and PNG exports (capture.js). */
.aha-exportPages{position:fixed;left:-40000px;top:0;display:flex;flex-direction:column;align-items:flex-start;gap:24px;pointer-events:none}
.aha-board.aha-exportPage{flex:none;width:1200px;min-height:675px;padding:40px 56px 24px;display:flex;flex-direction:column;overflow:visible;box-sizing:border-box}
.aha-exportPage>.aha-cols{flex:1 0 auto}
.aha-exportPage .aha-op-math{overflow:visible}
.aha-exportPage .aha-op-code{white-space:pre-wrap;overflow-wrap:anywhere;overflow:visible}
.aha-exportFoot{display:flex;justify-content:space-between;gap:24px;margin-top:22px;font-size:13px;line-height:18px;color:var(--ink-soft);opacity:.75}

/* ── cheat sheet and print ─────────────────────────────────────────────── */
.aha-sheet{column-gap:18px;font-size:var(--sheet-size,12px);line-height:1.45}
.aha-sheetSection{break-inside:avoid;margin:0 0 10px;padding:8px 10px;border:1px solid var(--aha-border);border-radius:8px;background:var(--aha-surface)}
.aha-sheetSection h4{font-size:1.12em;margin:0 0 4px}
.aha-sheetItem{margin:3px 0}
.aha-sheetItem b{font-weight:650}
.aha-sheet[data-highlight=true] .aha-sheetItem[data-kind=formula],.aha-sheet[data-highlight=true] .aha-sheetItem[data-kind=definition]{background:color-mix(in srgb,#ffd64f 26%,transparent);border-radius:4px;padding:0 3px}
.aha-sheet[data-highlight=true] .aha-sheetItem[data-kind=pitfall]{color:var(--aha-bad)}
.aha-cite{color:var(--aha-muted);font-size:.85em;margin-left:4px}
@media print{body *{visibility:hidden!important}.aha-printable,.aha-printable *{visibility:visible!important}.aha-printable{position:absolute;left:0;top:0;width:100%;padding:0 6mm}.aha-noprint{display:none!important}.aha-sheetSection{border-color:#999;background:#fff}}

/* ── flashcards ────────────────────────────────────────────────────────── */
.aha-flash{perspective:1200px;cursor:pointer;min-height:240px}
.aha-flashInner{position:relative;min-height:240px;transition:transform .5s;transform-style:preserve-3d}
.aha-flash[data-flipped=true] .aha-flashInner{transform:rotateY(180deg)}
.aha-flashFace{position:absolute;inset:0;backface-visibility:hidden;display:flex;align-items:center;justify-content:center;text-align:center;padding:26px;border:1px solid var(--aha-border);border-radius:16px;background:var(--aha-surface);font-size:18px;line-height:28px}
.aha-flashBack{transform:rotateY(180deg)}
`
