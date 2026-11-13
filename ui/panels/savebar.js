/* 公-2 片段：段底保存条重画。从 shared.js 分出（900 行硬线） */
import { saveBar } from './shared.js';
export function refreshSaveBar(host, secId) {
    const bar = host && host.querySelector ? host.querySelector('.wxg-savebar[data-id="' + secId + '"]') : null;
    if (!bar || !bar.parentNode) {
        return;
    }
    const parent = bar.parentNode;
    const fresh = saveBar(secId);
    parent.insertBefore(fresh, bar);
    parent.removeChild(bar);
}
