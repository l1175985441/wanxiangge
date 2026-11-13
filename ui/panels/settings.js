import { secGeneral } from './general.js'; import { secAppearance } from './appearance.js'; import { secRecall } from './recall.js'; import { secExtract } from './extract.js'; import { button, el, row, section } from '../sections.js'; export function secSettings(host) {
    const box = section('设置', '总控、外观、召回、读取控制都在这一页。', { open: false });
    const seg = (head) => {
        const g = el('div', 'wxg-seg');
        g.appendChild(el('div', 'wxg-note wxg-sec-head', head));
        box.appendChild(g);
        return g;
    };
    secGeneral(host, seg('① 跑起来'));
    secAppearance(host, seg('② 长什么样'));
    secRecall(host, seg('③ 每轮怎么挑'));
    const s4 = seg('④ 读什么');
    secExtract(host, s4);
    s4.appendChild(el('div', 'wxg-note', '备份'));
    row(s4, button('导出备份（JSON）', 'export-data'),
        button('导出聊天原文', 'export-chat'),
        button('导入备份（JSON）', 'import-data'));
    host.appendChild(box);
}
