// Static and scoped. No authored or player-supplied styles are interpolated.
export const NARRATIVE_CSS = `
.ludory-narrative{box-sizing:border-box;position:relative;width:100%;height:100%;min-height:320px;padding:clamp(12px,3vw,30px);display:flex;flex-direction:column;justify-content:flex-end;color:#f5f1ef;font:400 clamp(16px,2vw,21px)/1.5 system-ui,sans-serif;background:linear-gradient(145deg,#1a2635,#24374a);overflow:auto}
.ludory-narrative *{box-sizing:border-box}
.ludory-narrative__panel{background:rgba(10,18,30,.91);border:1px solid #9db3c6;border-radius:16px;padding:clamp(14px,3vw,28px);width:min(100%,830px);margin:0 auto;box-shadow:0 8px 25px #0006}
.ludory-narrative h2,.ludory-narrative h3{line-height:1.25;margin:0 0 12px;font-weight:650}
.ludory-narrative p{margin:0 0 16px;white-space:pre-wrap;overflow-wrap:anywhere}
.ludory-narrative__actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:14px}
.ludory-narrative button{border:1px solid #c2d5e3;border-radius:9px;background:#284b67;color:#fff;min-height:44px;padding:8px 14px;font:inherit;cursor:pointer;overflow-wrap:anywhere}
.ludory-narrative button:hover{background:#376589}
.ludory-narrative button:focus-visible{outline:3px solid #ffcd74;outline-offset:3px}
.ludory-narrative button[aria-pressed=true]{background:#fff2d0;color:#152535;border-color:#ffcf73}
.ludory-narrative__toolbar{display:flex;justify-content:space-between;gap:8px;margin-bottom:14px}
.ludory-narrative__variants{display:flex;flex-direction:column;gap:12px}
.ludory-narrative__group{padding:9px 0;border-bottom:1px solid #728ca055}
.ludory-narrative__group h3{font-size:.9em;color:#d5e5f1}
.ludory-narrative__preview{padding:12px;background:#1c344a;border-left:3px solid #ffcf73;border-radius:8px}
.ludory-narrative__actions img{display:block;max-width:min(100%,290px);max-height:170px;object-fit:contain;border-radius:8px}
.ludory-narrative__fallback{color:#eed9a9;font-size:.85em}
.ludory-narrative__journal{padding:10px;border:1px solid #acc4d1;border-radius:12px;background:#182c3a}
.ludory-narrative__journal ul{padding-left:22px;margin:8px 0}
.ludory-narrative__journal li{margin-bottom:9px}
.ludory-narrative__journal img{display:block;max-width:min(100%,290px);max-height:170px;object-fit:contain;margin:7px 0;border-radius:8px}
.ludory-narrative__reply{padding:10px 0;color:#d9e8f8;font-style:italic}
.ludory-narrative[data-orientation=portrait]{padding:12px}
.ludory-narrative[data-orientation=portrait] .ludory-narrative__panel{padding:14px}
.ludory-narrative[data-orientation=portrait] .ludory-narrative__actions{flex-direction:column}
.ludory-narrative[data-orientation=portrait] .ludory-narrative__actions button{width:100%}
@media (prefers-reduced-motion:reduce){.ludory-narrative *{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
`;
