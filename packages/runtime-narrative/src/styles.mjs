// Static and scoped. No authored or player-supplied styles are interpolated.
export const NARRATIVE_CSS = `
.ludory-narrative{box-sizing:border-box;position:relative;width:100%;height:100%;min-height:320px;padding:clamp(12px,3vw,30px);display:flex;flex-direction:column;justify-content:flex-end;color:#f5f1ef;font:400 clamp(16px,2vw,21px)/1.5 system-ui,sans-serif;background:linear-gradient(145deg,#1a2635,#24374a);overflow:auto}
.ludory-narrative *{box-sizing:border-box}
.ludory-narrative__panel{background:rgba(10,18,30,.91);border:1px solid #9db3c6;border-radius:16px;padding:clamp(14px,3vw,28px);width:min(100%,830px);margin:0 auto;box-shadow:0 8px 25px #0006}
.ludory-narrative[data-visual=true]{overflow:hidden;isolation:isolate}
.ludory-narrative[data-visual=true] .ludory-narrative__panel{position:relative;z-index:2;flex:0 1 auto;min-height:0;max-height:72%;overflow-y:auto;overscroll-behavior:contain;background:rgba(10,18,30,.93);border-color:#c1d1dd;box-shadow:0 9px 35px #0009}
.ludory-narrative__speaker{font-size:.95em;font-weight:750;letter-spacing:.025em;color:#ffdc9d;margin-bottom:4px!important}
.ludory-narrative__stage{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0;background:linear-gradient(155deg,#192936 0%,#304453 58%,#172532 100%)}
.ludory-narrative__stage img{position:absolute;display:block;max-width:none;pointer-events:none;user-select:none}
.ludory-narrative__background{inset:0;width:100%;height:100%;object-fit:cover;object-position:center center}
.ludory-narrative__portrait{bottom:0;height:86%;width:min(53%,600px);object-fit:contain;object-position:center bottom;filter:drop-shadow(0 8px 12px #0008)}
.ludory-narrative__portrait[data-slot=left]{left:2%}
.ludory-narrative__portrait[data-slot=center]{left:50%;transform:translateX(-50%)}
.ludory-narrative__portrait[data-slot=right]{right:2%}
.ludory-narrative__cg{inset:0;width:100%;height:100%;object-fit:contain;object-position:center 30%}
.ludory-narrative__stage[data-cg-mode=replace-stage] .ludory-narrative__cg{object-fit:cover;object-position:center center}
.ludory-narrative__stage[data-cg-mode=overlay] .ludory-narrative__cg{top:5%;left:12%;width:76%;height:70%;border-radius:12px;object-fit:contain;filter:drop-shadow(0 7px 18px #000a)}
.ludory-narrative[data-visual=true] .ludory-narrative__panel:focus{outline:none}
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
.ludory-narrative__premium-confirm{margin-top:12px;padding:12px;border:1px solid #eecb83;border-radius:9px;background:#302b33}
.ludory-narrative__premium-status,.ludory-narrative__premium-error{margin-top:12px;padding:10px;border-radius:8px;background:#433342}
.ludory-narrative__premium-error{border:1px solid #ffb1b1;color:#ffdfdf}
.ludory-narrative button:disabled{opacity:.65;cursor:not-allowed}
.ludory-narrative[data-orientation=portrait]{padding:12px}
.ludory-narrative[data-orientation=portrait] .ludory-narrative__panel{padding:14px}
.ludory-narrative[data-orientation=portrait] .ludory-narrative__actions{flex-direction:column}
.ludory-narrative[data-orientation=portrait] .ludory-narrative__actions button{width:100%}
.ludory-narrative[data-visual=true][data-orientation=portrait] .ludory-narrative__panel{max-height:57%}
.ludory-narrative[data-visual=true][data-orientation=portrait] .ludory-narrative__portrait{height:77%;width:67%}
.ludory-narrative[data-visual=true][data-orientation=portrait] .ludory-narrative__portrait[data-slot=left]{left:-12%}
.ludory-narrative[data-visual=true][data-orientation=portrait] .ludory-narrative__portrait[data-slot=right]{right:-12%}
.ludory-narrative[data-visual=true][data-orientation=portrait] .ludory-narrative__stage[data-cg-mode=overlay] .ludory-narrative__cg{left:2%;width:96%;height:55%;top:3%}
@media (max-width:600px) and (orientation:portrait){
  .ludory-narrative[data-mobile-preference=portrait]{min-width:0;min-height:0;justify-content:flex-start;font-size:max(1rem,16px);padding:max(12px,env(safe-area-inset-top,0px)) max(12px,env(safe-area-inset-right,0px)) max(12px,env(safe-area-inset-bottom,0px)) max(12px,env(safe-area-inset-left,0px));overflow-x:hidden;overflow-y:auto}
  .ludory-narrative[data-mobile-preference=portrait] .ludory-narrative__panel{min-width:0;max-width:520px;padding:clamp(12px,3.5vw,20px)}
  .ludory-narrative[data-mobile-preference=portrait] h2,.ludory-narrative[data-mobile-preference=portrait] h3{overflow-wrap:anywhere}
  .ludory-narrative[data-mobile-preference=portrait] .ludory-narrative__actions{min-width:0;flex-direction:column}
  .ludory-narrative[data-mobile-preference=portrait] .ludory-narrative__actions button{width:100%;max-width:100%;white-space:normal;overflow-wrap:anywhere}
  .ludory-narrative[data-mobile-preference=portrait] .ludory-narrative__toolbar button{min-width:0;overflow-wrap:anywhere}
  .ludory-narrative[data-visual=true][data-mobile-preference=portrait]{justify-content:flex-end;overflow:hidden}
  .ludory-narrative[data-visual=true][data-mobile-preference=portrait] .ludory-narrative__panel{max-height:58%;overflow-y:auto}
}
@media (prefers-reduced-motion:reduce){.ludory-narrative *{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
`;
