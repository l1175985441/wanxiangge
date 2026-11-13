/* 从 ui/sections.js 原样搬出，逻辑一字未改（206 单） */
import { getChronicle } from '../../core/state.js'; import { floorLabel, trimText } from '../../core/utils.js'; import { makeChronSearch } from '../chron-search.js'; import { chronFilter, chronPage, chronSearch, setChronFilter, setChronPage } from '../sections.js'; import { PER_PAGE, clampPage, kindTone, pager, shortTime } from './shared.js'; import { button, card, el, heroEmpty, row, section } from './shared.js';

export function secChronicle(host) {
    const list = getChronicle();
    /*
     * ⚠️ 这里原来是 `{ open: true } + '⭐ …'` —— **对象拼字符串**，两个后果：
     *    · 拼出来的是 "[object Object]⭐ …" ⇒ hint 从来没显示过；
     *    · `open` 也没传进去 ⇒ "默认展开"从来没生效（编年一直是收起的）。
     *    ⇒ 改成独立传参（复核方指出）。
     */
    const box = section('编年',
        '每回合推演出来的东西**全部按时间攒在这里**（过去经历／正在经历是滚动更新的，旧的只有这儿能回看）。'
        + '编年**只给你看**：不注入、不喂模型。',
        { open: true });
    if (!list.length) {
        box.appendChild(heroEmpty('还没有记录（更新几轮就有了）', '立刻更新', 'update-now', '为什么会自动有：每次推演都会往这里记一条，你不用手填。'));
        host.appendChild(box);
        return;
    }
    /*
     * ⭐ 行化一切（有数据排版术第七条）：
     *    `时间（骨架列）｜ 谁 ＋ 正文 ｜ 种类胶囊`，一行一件事；
     *    按**楼层分组**（数字当骨架），顶部一排**筛选带计数**。
     * ⚠️ 原来每条摊成 5 行（时间／楼层／胶囊／人／正文），9 条就一屏多——
     *    真机截图里一排胶囊还被 flex 列拉成了通栏长条（见 CSS 里的说明）。
     */
    const KINDS = ['推演', '暗线', '警戒', '越界'];
    const countOf = (k) => list.filter((c) => String(c.kind || '推演').includes(k)).length;
    const all = list.slice(-120).reverse();
    let matched = chronFilter === 'all' ? all : all.filter((c) => String(c.kind || '推演').includes(chronFilter));
    /* A4：搜索词叠在筛选之上（先筛类型、再搜字，顺序不影响结果，但口径要固定） */
    const chronKw = trimText(chronSearch).toLowerCase();
    if (chronKw) {
        matched = matched.filter((c) => {
            const hay = [c.text, c.title, c.kind, c.time, c.people, c.who]
                .map((x) => (Array.isArray(x) ? x.join(' ') : String(x == null ? '' : x)))
                .join(' ')
                .toLowerCase();
            return hay.includes(chronKw);
        });
    }
    setChronPage(clampPage(chronPage, matched.length, PER_PAGE.chron));
    const shown = matched.slice((chronPage - 1) * PER_PAGE.chron, chronPage * PER_PAGE.chron);
    const bar = el('div', 'wxg-filters');
    const mkFilter = (key, label, n) => {
        const b = el('button', 'wxg-filter' + (chronFilter === key ? ' is-on' : ''), label);
        b.type = 'button';
        b.setAttribute('data-action', 'chron-filter');
        b.setAttribute('data-id', key);
        b.appendChild(el('span', 'wxg-filter-n', String(n)));
        return b;
    };
    bar.appendChild(mkFilter('all', '全部', all.length));
    for (const k of KINDS) {
        const n = countOf(k);
        if (n) {
            bar.appendChild(mkFilter(k, k, n));
        }
    }
    if (chronFilter !== 'all' && !countOf(chronFilter)) {
        setChronFilter('all');
    }
    box.appendChild(bar);
    /* A4：搜索框（和名册那个同款；⛔ 每敲一个字都重画，change 才筛） */
    /* A4：搜索框（构造在 ui/chron-search.js，主文件别再长） */
    box.appendChild(makeChronSearch(el, chronSearch));
    /*
     * 三（阿砚九格）：编年顶部一条统计——按**我们自己的分类**算，⛔ 套它的 7 类。
     *   「已归档」＝这本账里比当前可见范围（最近 120 条）更早的那些。
     */
    const archived = Math.max(0, list.length - all.length);
    const stat = el('div', 'wxg-statbar');
    stat.appendChild(el('span', 'wxg-statbar-k', '共 ' + String(list.length) + ' 条'));
    stat.appendChild(el('span', null, '暗线 ' + String(countOf('暗线')) + ' 条'));
    stat.appendChild(el('span', null, '已归档 ' + String(archived) + ' 条（早于可见的最近 ' + String(all.length) + ' 条）'));
    box.appendChild(stat);
    const hit = el('div', 'wxg-hitbar');
    hit.appendChild(el('span', null, '这一筛 ' + String(matched.length) + ' 条'
        + (matched.length === list.length ? '' : '（全账本 ' + String(list.length) + ' 条）')));
    hit.appendChild(el('span', null, '新的在上面 · 按楼层分组'));
    /*
     * ⭐ 「清空编年」放在这一条小结行上（不单开一段，照"一屏一个焦点"）。
     *    ⛔ 不做成显眼的大按钮——清空是**刻意**才点的操作，点之前会先弹条数给她看。
     */
    const clearBtn = el('button', 'wxg-btn-xs wxg-del', '清空编年');
    clearBtn.type = 'button';
    clearBtn.setAttribute('data-action', 'clear-chronicle');
    clearBtn.title = '把编年全部清掉（只清编年，别的都不动）';
    hit.appendChild(clearBtn);
    box.appendChild(hit);
    if (matched.length > PER_PAGE.chron) {
        box.appendChild(pager('chron-page', chronPage, PER_PAGE.chron, matched.length));
    }
    const cChron = card(chronFilter === 'all' ? '热账与旧卷（按回合攒）' : ('只看「' + chronFilter + '」'));
    cChron.classList.add('wxg-wide');   /* 81：卡片横向铺满（她：要么铺满、要么居中） */
    const byFloor = new Map();
    for (const c of shown) {
        const f = Number.isFinite(c.floor) && c.floor >= 0 ? Number(c.floor) : -1;
        if (!byFloor.has(f)) {
            byFloor.set(f, []);
        }
        byFloor.get(f).push(c);
    }
    const groups = Array.from(byFloor.entries())
        .map(([floor, items]) => ({
            floor,
            items: items.slice().sort((a, b) => (Number(b && b.at) || 0) - (Number(a && a.at) || 0)),
        }))
        .sort((a, b) => {
            if (a.floor === b.floor) {
                return 0;
            }
            if (a.floor < 0) {
                return 1;
            }
            if (b.floor < 0) {
                return -1;
            }
            return b.floor - a.floor;
        });
    /*
     * 四（阿砚九格）：冷热分开命名——最新那一组叫「热账」，更早的都叫「旧卷」。
     *   这不是纯视觉：她流程第⑤条“几百楼就把前面的剪出来单独封存”——这里是同一件事的可视化。
     */
    const hotFloor = groups.length ? groups[0].floor : null;
    for (const g of groups) {
        const isHot = g.floor === hotFloor;
        const showHead = g.items.length > 1;   /* 85#10：单条不印卷头（但行还要画） */
        if (showHead) {
            const head = el('div', 'wxg-grouphead');
            head.appendChild(el('b', null, (isHot ? '热账 · ' : '旧卷 · ')
                + (g.floor >= 0 ? floorLabel(g.floor) : '未记楼层')));
            head.appendChild(el('span', null, '共 ' + String(g.items.length) + ' 条'));
            cChron.appendChild(head);
        }
        for (const c of g.items) {
            const r = el('div', 'wxg-r');
            r.appendChild(el('div', 'wxg-r-k wxg-num', shortTime(c.at)));
            const main = el('div', 'wxg-r-main');
            const title = el('div', 'wxg-r-title');
            if (trimText(c.who)) {
                title.appendChild(el('span', 'wxg-r-who', c.who));
            } else {
                title.appendChild(el('span', 'wxg-none', '这轮没点到名'));   /* A3：占位词改人话 */
            }
            if (c.manual) {
                title.appendChild(el('span', 'wxg-badge is-warn', '已手动修改'));
            }
            main.appendChild(title);
            main.appendChild(el('div', 'wxg-r-sub', trimText(c.text) || '暂无'));
            r.appendChild(main);
            const act = el('div', 'wxg-r-act');
            act.appendChild(el('span', 'wxg-badge ' + kindTone(c.kind), String(c.kind || '推演')));
            /*
             * ⭐ 删这一条。编年原来是**只增不减**的（`addChronicle`／`getChronicle`，没有任何删的口子）
             *    ⇒ 写错了、或者早期测试数据混进去了，她自己在界面上**删不掉**
             *      （真机上真卡过一批合成文本）。
             * ⚠️ 下标按**账本里的原始位置**算：这里渲染的是"最近 120 条倒序＋筛选＋翻页"之后的行，
             *    ⛔ 不能拿循环下标当账本下标（会删错人）。用对象身份回查最稳。
             */
            const at = list.indexOf(c);
            const del = el('button', 'wxg-btn-xs wxg-del wxg-row-del', '删');   /* 五：hover 才现，屏上可见按钮减半 */
            del.type = 'button';
            del.setAttribute('data-action', 'del-chronicle');
            del.setAttribute('data-index', String(at));
            del.title = '删掉这一条（只删编年这一条，别的不动）';
            act.appendChild(del);
            r.appendChild(act);
            cChron.appendChild(r);
        }
    }
    box.appendChild(cChron);
    box.appendChild(el('div', 'wxg-note', '共 ' + String(list.length) + ' 条，这里显示最近 120 条（更早的仍在账本与世界书归档里）'));
    host.appendChild(box);

}
