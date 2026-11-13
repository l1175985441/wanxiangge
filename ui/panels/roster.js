/* 从 ui/sections.js 原样搬出，逻辑一字未改（206 单） */
import { channelReport } from '../../core/wb-channel.js'; import { columnsFor } from '../../core/roster-cols.js'; import { describeRoster, getRoster, loadState, sortRosterList } from '../../core/state.js'; import { hasMergeSnapshot } from '../../core/merge.js'; import { tallyLine } from '../../core/tally.js'; import { trimText } from '../../core/utils.js'; import { PER_PAGE, clampPage, openChar, pager, rosterFilter, rosterPage, rosterSearch, setRosterPage } from '../sections.js'; import { button, card, checkbox, el, foldable, line, row, section, textInput } from './shared.js';

export function secRoster(host) {
    const roster = getRoster();
    const box = section('人物名册',
        '名册按聊天各分各的（开新档＝新世界，数据不串）。别名表由你自己维护——正文里叫昵称也能召回上。',
        { open: true });
    const d = describeRoster();
    const state = loadState();
    const fresh = Array.isArray(state.newPeople) ? state.newPeople.filter(Boolean) : [];
    box.appendChild(el('div', 'wxg-note', d.total
        ? '现有 ' + String(d.total) + ' 人' + (d.players ? '（其中玩家棋子 ' + String(d.players) + ' 人）' : '')
        : '还没有人物。'));
    if (fresh.length) {
        const line = el('div', 'wxg-store', '引擎新认了 ' + String(fresh.length) + ' 个人：' + fresh.join('、')
            + '（名字对不对？不对就点「按这条合并…」并进老记录，或「忽略这条」）');
        line.setAttribute('data-tone', 'bad');
        box.appendChild(line);
        row(box, button('一键收下这些新认的人', 'accept-new-all'));
    }
    /*
     * ⭐ 装盒：录入 一块、名册 一块（体检第一条）
     * ⭐ 一屏一个焦点：**名册里已经有人了 ⇒ 录入默认收起**。
     *    68 个人的时候它还占着半屏上半部分，名单要往下滚才看得见——
     *    她天天要看的是名单，录入一个月用一次。⛔ 不删，点一下就展开。
     */
    const hasPeople = roster.length > 0;
    const cIn = card('录入');
    cIn.classList.add('wxg-wide');
    let inTarget = cIn;
    if (hasPeople) {
        inTarget = foldable('展开录入（加人／导入／从世界书读人）', false);
        cIn.appendChild(inTarget);
    }
    row(inTarget, textInput('wxg-new-name', '', '新人物名字', 'noop'), button('加入名册', 'add-char', 'wxg-primary'), button('一键盘入预设名册', 'preset-roster'));
    row(inTarget, textInput('wxg-import-roster', '', '批量导入：名字一行一个（也认逗号、顿号）', 'noop'), button('批量导入', 'import-roster'));
    row(inTarget,
        textInput('wxg-book-name', '', '从世界书读人：填世界书名（留空＝角色卡绑定那本）', 'noop', 'wxg-short'),
        button('从世界书读人', 'read-book', 'wxg-primary'),
        button('列出世界书', 'list-books'));
    const bookList = el('div', 'wxg-note', '');
    bookList.id = 'wxg-book-list';
    inTarget.appendChild(bookList);
    const dupBox = el('div', 'wxg-note', '');
    dupBox.id = 'wxg-dup-picker';
    inTarget.appendChild(dupBox);
    row(inTarget, button('查重（找出被拆成两条的）', 'detect-dupes'),
                /* ⭐修复 15（材料 02）：**一键合并查重出的所有重复组** ✓ */
                button('一键合并重复组', 'merge-all-dupes'),
                /*
                 * 依据＝阿砚任务 1-b（M05）：`undoLastMerge` 写了但**全库 0 个调用点**；
                 *   选项②——真接上它，且没有「合并前」快照时直接置灰（⛔ 点了才告诉她没得撤）。
                 */
                (() => {
                    const b = button('撤销上次合并', 'undo-last-merge', 'wxg-btn-xs');
                    if (!hasMergeSnapshot()) {
                        b.disabled = true;
                        b.title = '没有「合并前」的快照（已被快照上限挤掉）';
                    }
                    return b;
                })(),
                );
    box.appendChild(cIn);
    /*
     * ⭐ 世界书**通道**那一行（必须看得见）：
     *    真机踩过"点读人 → 0 人"，根因是 ST 1.18 原版**没有** `ctx.getLorebookEntries` 那一组，
     *    而我们只认它 ⇒ 静默读出 0 条、她完全没法自己判断原因。
     *    现在：走哪条通道、缺什么，直接写在读人按钮旁边。
     */
    const chRep = channelReport();
    const chLine = el('div', 'wxg-store', chRep.text
        + (chRep.ok ? '' : '　⇒ 不知道书名就下面手填一下（也能读）'));
    chLine.setAttribute('data-tone', chRep.ok ? 'ok' : 'bad');
    box.appendChild(chLine);
    const cList = card('名册');
    cList.classList.add('wxg-wide');   /* 82：名册表铺满（卡只占左半，右半空） */
    /*
     * ⭐ 行化（有数据排版术第七条）：**一个人一行**。
     *    `名字 ＋ 胶囊（玩家棋子/新认/已手改）｜ 别名·好感 灰字 ｜ 右侧 改 · 删`
     * ⚠️ 原来一个人一张卡（名字行＋两个输入框行＋开关行 ≈ 135px）：
     *    真机灌了 47 人之后一屏只看得到 3 个人——"有哪些条"根本扫不出来，
     *    正好撞在验收口径上（三秒要能抓住有哪些人）。
     * 改/删都在行上；点「改」才展开三个输入框（⛔ 不用为编辑把每行都撑开）。
     */
    /*
     * ⭐ 筛选行 —— **照目标包**：`全部｜创建时间｜修改时间｜玩家棋子｜名字` ＋ 右侧**搜索框**（搜“名字或别名”）。
     *   原来是“全部／玩家棋子／新认的／我改过的”四个胶囊（那是早期自己想的）。
     *   ⚠️ “我改过的”这个**筛选**去了，但它的信息没丢：行上的「已手改」辨识还在（新认的人也还有那条提示带）。
     */
    const isFresh = (c) => fresh.some((n) => trimText(n) === trimText(c.name));
    const kw = trimText(rosterSearch).toLowerCase();
    const hitKw = (c) => !kw
        || String(c.name || '').toLowerCase().includes(kw)
        || (Array.isArray(c.aliases) ? c.aliases.some((a) => String(a || '').toLowerCase().includes(kw)) : false);
    let shownRoster = roster.filter(hitKw);
    if (rosterFilter === 'player') {
        shownRoster = shownRoster.filter((c) => c.isPlayer);
    }
    /* ★ R62：排序交给纯函数（可测），并带正反序 ✓ */
    if (rosterFilter === 'created' || rosterFilter === 'changed' || rosterFilter === 'name') {
        shownRoster = sortRosterList(shownRoster, rosterFilter, rosterSortDir);
    /*
     * 依据＝阿砚第三批 C 档 P2 · F3：总数要印出来。
     *   名册有筛选与搜索；不印总数，她就分不清“筛没了”还是“本来就这么多”。
     */
    const tallyRoster = tallyLine('名册', roster.length, shownRoster.length);
    cList.appendChild(el('div', 'wxg-note', tallyRoster));   /* F3：把“显示 N / 共 M”印出来 */
    }
    const rf = el('div', 'wxg-filters');
    const mkR = (key, label, n) => {
        const b = el('button', 'wxg-filter' + (rosterFilter === key ? ' is-on' : ''), label);
        b.type = 'button';
        b.setAttribute('data-action', 'roster-filter');
        b.setAttribute('data-id', key);
        if (n !== null) {
            b.appendChild(el('span', 'wxg-filter-n', String(n)));
        }
        return b;
    };
    const dirMark = (k) => (rosterFilter === k ? (rosterSortDir === 'desc' ? ' ▼' : ' ▲') : '');
    rf.appendChild(mkR('all', '全部', roster.length));
    rf.appendChild(mkR('created', '创建时间' + dirMark('created'), null));
    rf.appendChild(mkR('changed', '修改时间' + dirMark('changed'), null));
    rf.appendChild(mkR('player', '玩家棋子', roster.filter((c) => c.isPlayer).length));
    rf.appendChild(mkR('name', '名字' + dirMark('name'), null));
    const sw = el('div', 'wxg-searchwrap');
    sw.appendChild(el('span', 'wxg-searchico', '⌕'));
    const si = el('input', 'wxg-searchbox');
    si.type = 'search';
    si.placeholder = '搜：名字 或 别名';
    si.value = rosterSearch;
    si.setAttribute('data-action', 'roster-search');
    sw.appendChild(si);
    rf.appendChild(sw);
    cList.appendChild(rf);
    setRosterPage(clampPage(rosterPage, shownRoster.length, PER_PAGE.roster));
    const pageList = shownRoster;   /* 85#1：全部渲染（不再分页） */
    /*
     * ⭐ 翻页条：**挪到页底**（照目标包：分页贴页底）。
     *    原来放在**列表上方**——那是早期参照的做法；包里明确要"贴页底"。
     *    ⛔ 改回上面（虽然长列表里"翻页在下头"要滑到底才看得到）——**以包为准**。
     */
    const pagerAtBottom = null;   /* 85#1：不再分页 */
    const topbar = el('div', 'wxg-roster-topbar');
    const funcBtn = button('功能 ⋮', 'roster-func', 'wxg-btn is-func');
    funcBtn.style.height = '28px';
    funcBtn.style.minHeight = '28px';
    funcBtn.style.lineHeight = '26px';
    funcBtn.style.padding = '0 12px';
    funcBtn.style.whiteSpace = 'nowrap';
    funcBtn.title = '去重合并／删除／清空（入口位；包里就是这么标的）';
    topbar.appendChild(funcBtn);
    /*
     * ⭐ LY5（材料 11·布局层）：**页头那颗 ⋮ 要在页面最顶端** ✓
     *   旧：`cList.appendChild(topbar)` ⇒ 被塞进「名册」卡**内部** ✗
     *     ⇒ 夹在筛选胶囊条与表头**正中间** ✗（酒馆里看着很突兀 ✗）
     *   现在：插到**第一张卡之前** ✓（与状态页／世界状态页同一个做法 ✓）
     */
    box.insertBefore(topbar, cIn);
    /*
     * A5：**空列不占位** —— 整列没值（典型：势力）就连表头带单元格一起藏；
     *   好感列空时去好感表取（有数就有内容）。
     */
    const cols = columnsFor(roster, state);
    /*
     * 80 号：这块卡只有 461px（5 列必然挤：末列算出 0px、act 压进名字格 22px）
     *   ⇒ 固定 **2 列**：名称｜操作。身份／势力并进名字格**第二行小灰字**，取不到就不显示。
     */
    const allEmpty = !cols.showId && !cols.showFac;
    const list = el('div', 'wxg-roster wxg-table-2');
    const rhead = el('div', 'wxg-thead wxg-table-2');
    rhead.appendChild(el('div', 'wxg-th', '角色名称'));
    rhead.appendChild(el('div', 'wxg-th', ''));   /* 操作列无标题（⛔ 填字） */
    list.appendChild(rhead);
    for (const c of pageList) {
        const open = String(openChar) === String(c.id);
        /*
         * ⭐ **整行可点展开**（复核方："每个角色下面一个按钮好像是有点奇怪"——对）。
         *    68 个人的名单上糊 136 个按钮，名单就不成名单了；
         *    而且「删」摆在密集列表里太容易误点 ⇒ 收进展开区。
         *    行的右侧留一个 `›` 提示"这行能点"。
         * ⚠️ 行上挂 data-action 是安全的：里面的输入框/开关/删除**各自都有 data-action**，
         *    事件的 closest 会先命中它们（点输入框不会把行收起来）。
         */
        const r = el('div', 'wxg-r is-click' + (open ? ' is-open' : ''));
        r.setAttribute('data-action', 'open-person-card');
        r.setAttribute('data-id', c.id);
        /*
         * ⭐ 照目标包改成**四列表**：`角色名称｜好感｜身份｜势力`，列间**竖实线**，空值写 `—`。
         *    为什么：原来是"名字 + 一行灰字（别名/好感）"，48 个人扫不动；
         *    包里是列对齐的账本样子（四列等宽、看得见的竖线）。
         *    ⚠️ 别名没丢：它在浮层里（点开就看得到）。
         */
        const main = el('div', 'wxg-td wxg-c-name');
        const title = el('div', 'wxg-r-title');
        title.appendChild(el('span', 'wxg-r-who', c.name));
        if (c.isYou || c.isPlayer) {
            title.appendChild(el('span', 'wxg-badge is-ok', '你'));
        }
        title.appendChild(el('span', 'wxg-badge ' + (c.offstage === true ? 'is-soft' : 'is-ok'), c.offstage === true ? '后台' : '前台'));
        if (isFresh(c)) {   /* 85#12：只认 newPeople */
            title.appendChild(el('span', 'wxg-badge is-warn', '新认的人'));
        }
    /* 67 号：两颗挤在一行会裁掉第二颗 ⇒ **合成一颗**，细节进 title（⛔ 调 min-width） */
    const flags = [];
    if (c.manual) { flags.push('已手改'); }
    if (c.noBench === true) { flags.push('不推'); }
    if (flags.length) {
        const badge = el('span', 'wxg-badge ' + (c.manual ? 'is-info' : ''), flags.join(' · '));
        if (flags.length === 2) {
            badge.title = '这一位你手动改过，且已关掉「推演／平行事件」';
        }
        title.appendChild(badge);
    }
        main.appendChild(title);
        r.appendChild(main);
        /* 80 号：身份／势力不再占独立列，并进名字格第二行（小灰字） */
        {
            const meta = [];
            if (trimText(c.identity)) { meta.push('身份 · ' + trimText(c.identity)); }
            if (trimText(c.faction)) { meta.push('势力 · ' + trimText(c.faction)); }
            if (meta.length) { main.appendChild(el('div', 'wxg-c-meta', meta.join('　'))); }
        }
        if (open) {
            r.classList.add('is-sel');
        }
        const act = el('div', 'wxg-r-act');
        /*
         * 新认的人与手动忽略的人，各给一颗当场处置的钮：
         * · 新认的「收下／忽略」——认错了要能当面否掉，不必进卡再找；
         * · 已忽略的「恢复」——否则关了就只能改账本才能放回来。
         * 只在这两种行上挂 ✓ 名单不会糊满按钮 ✓
         */
        if (c.ignored === true) {
            act.appendChild(button('恢复参与推演', 'unignore-char', 'wxg-btn-xs', c.id));
        } else if (isFresh(c)) {
            act.appendChild(button('收下', 'accept-new', 'wxg-btn-xs', c.id));
            /* 79 ：忽略搬进 ⋯ */
        }
        act.appendChild(el('span', 'wxg-r-caret' + (open ? ' is-open' : ''), open ? '⌄' : '›'));
        /*
         * ⭐ 行上留一个「⋯」＝还开**老的完整编辑器**（删除／收下／忽略／合并那些都在里头）。
         *    为什么留：浮层这一版先做"看＋改八格＋别名＋玩家棋子"，老编辑器里还有几样没搬过去；
         *    ⛔ 不能因为换交互就把她的功能摸不到（audit-3 红了 4 条就是提醒这个）。
         *    等浮层把老编辑器的活全接手了，再撤这个入口（那时才叫"只删入口"）。
         */
        const moreBtn = button('⋯', 'edit-char', 'wxg-btn-xs wxg-r-more', c.id);
        moreBtn.title = '更多（删除／收下／忽略／合并等）';
        /*
         * ⭐ 行高真凶（第 6 轮真机量出来的）：这颗按钮被酒馆全局 `.menu_button`
         *   撑到 **36px**，而同行别的格子才 30～35 ⇒ 行高 = max + 内边距 = 63px。
         *   屝过两回 CSS 都压不过（它是酒馆自己的类）⇒ **直接写内联**（内联必胜，且只影响这一颗）。
         */
        moreBtn.style.height = '22px';
        moreBtn.style.minHeight = '22px';
        moreBtn.style.lineHeight = '20px';
        moreBtn.style.padding = '0 7px';
        moreBtn.style.fontSize = '13px';
        act.appendChild(moreBtn);
        r.appendChild(act);
        if (open) {
            const fields = el('div', 'wxg-char-fields');
            const alias = textInput('wxg-alias-' + c.id, c.aliases.join('、'), '别名／昵称（顿号或逗号分开）', 'set-alias', 'wxg-alias');
            alias.setAttribute('data-id', c.id);
            fields.appendChild(alias);
            const aff = textInput('wxg-aff-' + c.id, c.affinity, '好感（读自手机；没有就空着）', 'set-affinity', 'wxg-affinity');
            aff.setAttribute('data-id', c.id);
            fields.appendChild(aff);
            r.appendChild(fields);
            const actions = el('div', 'wxg-char-actions');
            const playerLabel = el('label', 'checkbox_label wxg-chip-sm');
            const pbox = document.createElement('input');
            pbox.type = 'checkbox';
            pbox.checked = c.isPlayer === true;
            pbox.setAttribute('data-action', 'set-player');
            pbox.setAttribute('data-id', c.id);
            playerLabel.appendChild(pbox);
            playerLabel.appendChild(el('span', null,
                c.isYou ? '玩家棋子（照酒馆里的人设名自动认的；不想算就取消勾）' : '玩家棋子'));
            actions.appendChild(playerLabel);
            if (isFresh(c)) {
                actions.appendChild(button('忽略这条', 'ignore-char', 'wxg-btn-xs', c.id));
            }
            actions.appendChild(button('删', 'del-char', 'wxg-btn-xs', c.id));
            r.appendChild(actions);
        }
        list.appendChild(r);
    }
    if (allEmpty) {
        list.appendChild(el('div', 'wxg-note wxg-roster-blank',
            '还没有身份／势力／好感——等正文回写，或从世界书读人时带进来。'));
    }
    cList.appendChild(list);
    if (pagerAtBottom) {
        const pw = el('div', 'wxg-roster-pager');
        pw.appendChild(pagerAtBottom());
        cList.appendChild(pw);
    }
    box.appendChild(cList);
    host.appendChild(box);



}
