/* 从 ui/sections.js 原样搬出，逻辑一字未改（206 单） */
import { getSettings } from '../../core/settings.js'; import { isBroken } from '../../core/cache.js'; import { autoListTimer, booksCache, listBooksCache, paintBookPicks, setAutoListTimer } from '../sections.js'; import { saveBar, stage, stagedValue } from './shared.js'; import { button, card, checkbox, el, line, row, section, textInput } from './shared.js';

export function secExtract(host, intoBox) {
    const SECID = 'extract';
    const s = getSettings();
    const box = intoBox || section(
        '读取控制（提取／排除四格）',
        '文本名单与点选的世界书／条目改完按段底那颗「保存」一起存（三个规则开关拨动即生效）。'
        + '世界书这一块不用手打书名：点下面的书名就进名单（再点＝排除、再点＝拿掉），'
        + '点「看条目」能一条条挑。标签那一块默认按结构剥掉成对的机器块与 HTML 注释——'
        + '剥完为空会自动退回原文，不会比剥之前更坏。',
        { open: false, five: true });
    const cTag = card('标签与剥壳');
    line(cTag, '提取标签', textInput('wxg-extract-tags', stagedValue(SECID, 'extractTags', s.extractTags), '例：正文, content', 'stage-extract-tags', 'wxg-short'));
    line(cTag, '排除标签', textInput('wxg-exclude-tags', stagedValue(SECID, 'excludeTags', s.excludeTags), '例：状态栏, 变量（留空＝只按结构剥）', 'stage-exclude-tags', 'wxg-short'));
    cTag.appendChild(checkbox('wxg-strip-paired', '按结构剥掉成对的机器块（配对的开闭标签，整块剥）',
        stagedValue(SECID, 'stripPairedBlocks', s.stripPairedBlocks), 'stage-strip-paired'));
    cTag.appendChild(checkbox('wxg-strip-comments', '剥掉 HTML 注释（<!-- … -->）',
        stagedValue(SECID, 'stripHtmlComments', s.stripHtmlComments), 'stage-strip-comments'));
    box.appendChild(cTag);
    /* ---- 世界书：点选（⛔ 不立刻存，攒到段底一起存） ---- */
    const cBook = card('世界书名单（读哪些／哪些不读）');
    line(cBook, '提取（要读的）',
        textInput('wxg-extract-books', stagedValue(SECID, 'extractBooks', s.extractBooks), '留空＝角色卡绑定那本；也可手填，逗号分开', 'stage-extract-books', 'wxg-short'));
    line(cBook, '排除（不读的）',
        textInput('wxg-exclude-books', stagedValue(SECID, 'excludeBooks', s.excludeBooks), '点下面书名也能填进来；也可手填', 'stage-exclude-books', 'wxg-short'));
    const pick = el('div', 'wxg-pickwrap');
    pick.id = 'wxg-bookpick';
        const pickHead = el('div', 'wxg-pick-head', '世界书');   /* 81：41 字说明进 title */
    pickHead.title = '点一下＝进「提取」；再点＝进「排除」；再点＝拿掉；最后按段底的保存';
    pick.appendChild(pickHead);
    cBook.appendChild(pick);
    row(cBook,
        button('读世界书列表', 'list-books', 'wxg-primary'),
        el('span', 'wxg-note', '（没读到就手填；有些酒馆版本没开这个接口）'));
    const bookList = el('div', 'wxg-note', '');
    bookList.id = 'wxg-book-list';
    cBook.appendChild(bookList);
    const entPick = el('div', 'wxg-pickwrap');
    entPick.id = 'wxg-entpick';
    cBook.appendChild(entPick);
    /*
     * ⭐⭐ 材料 01（界面第 2 条）：**打开这一页就自动列世界书** ✓
     *   旧：打开时区域是**空的** ✗ ⇒ 必须手动先点一次「读世界书列表」才出按钮 ✗
     *   现在：渲染完就自己去点一下那颗按钮 ✓（复用现成的 list-books 路，⛔ 重写逻辑 ✗）
     *   ⛔ 只在“还没列过”时发 ✓（避免每次重画都去读一遍世界书 ✗）
     */
    /*
     * 依据＝本轮查“首跑红、复跑绿”（run-tests-pick 偎发）：
     *   旧：每次重画都排一个 setTimeout(0) ✗ ⇒ 重画多次后有多个定时器，
     *        它们都会去点当前的「list-books」按钮 ⇒ 列表被反复刷新、
     *        卡片短暂为空 ⇒ 夹具正好在那一瞬查不到控件。
     *   现在：只保留最新那一个定时器；回调里先看 host 还在不在、按钮还在不在。
     */
    if (autoListTimer) {
        try { clearTimeout(autoListTimer); } catch (eClear) { }
        setAutoListTimer(null);
    }
    setAutoListTimer(setTimeout(() => {
        setAutoListTimer(null);
        try {
            if (!host || host.isConnected === false) { return; }   /* 旧页面已被换掉 ⇒ ⛔ 再去点它 */
            const snap = booksCache.get();
            if (isBroken(snap)) { return; }   /* B7：读不到就不要反复去叫（⛔ 死循环） */
            if (Array.isArray(listBooksCache) && listBooksCache.length) {
                /* ⭐ RD1-2：缓存里有 ⇒ **直接把芯片画回来** ✓（旧：直接 return ⇒ 重绘后全没 ✗） */
                try { paintBookPicks(host); } catch (ePB) { /* 画不出来也不能把这一页搞挂 ✓ */ }
                return;
            }
            const btn = host.querySelector('[data-action="list-books"]');
            if (btn && btn.click && btn.isConnected !== false) {
                btn.click();
            }
        } catch (e) { /* 列不出来也不能把这一页搞挂 ✓ */ }
    }, 0));
    const entNote = el('div', 'wxg-note', '');
    entNote.id = 'wxg-entnote';
    cBook.appendChild(entNote);
    cBook.appendChild(checkbox('wxg-only-enabled', '只读开启着的条目（不选世界书时＝角色卡绑定世界里开启的条目）',
        stagedValue(SECID, 'onlyEnabledEntries', s.onlyEnabledEntries), 'stage-only-enabled'));
    line(cBook, '好感来源（"手机"）',
        textInput('wxg-affinity-source', stagedValue(SECID, 'affinitySource', s.affinitySource), '例：手机 或 关系表', 'stage-affinity-source', 'wxg-short'),
        el('span', 'wxg-note', '留空＝还没有数（表里写「未建立」）'));
    box.appendChild(cBook);
    box.appendChild(saveBar(SECID));
    if (!intoBox) { host.appendChild(box); }

}
