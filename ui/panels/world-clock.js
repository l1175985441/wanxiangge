/* 钟-1：世界钟・地点独立页（从世界局势页拆出，206 后） */
import { section, lockable, card, line, textInput, el, button } from './shared.js';
import { loadState } from '../../core/state.js';
import { trimText } from '../../core/utils.js';

export function secWorldClock(host) {
    const w = loadState().world;
    const box = section('世界钟・地点',
        '世界钟／地点允许写「未知」；「±1 天」只拨钟，不改账本。',
        { open: true, summary: trimText(w.clock) || '世界钟未知' });
    /* 口径（与 core/config.js 一致）：**世界钟／地点允许写“未知”，其它格不许**；⛔ 在 UI 上教她写“未知”。 */
    const cWorld = lockable(card('世界钟・地点'), 'world-clock');
    line(cWorld, '世界钟', textInput('wxg-world-clock', w.clock, '例：第二天 上午 10:20', 'set-world-clock', 'wxg-short'));
    line(cWorld, '地点', textInput('wxg-world-place', w.place, '例：四夷馆', 'set-world-place', 'wxg-short'));
    const wShift = el('div', 'wxg-row');
    wShift.appendChild(button('−1 天', 'shift-world-clock', 'wxg-btn-sm', '-1'));
    wShift.appendChild(button('+1 天', 'shift-world-clock', 'wxg-btn-sm', '1'));
    cWorld.appendChild(wShift);
    box.appendChild(cWorld);
    host.appendChild(box);
}
