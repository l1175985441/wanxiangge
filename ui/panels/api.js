/* 从 ui/sections.js 原样搬出，逻辑一字未改（206 单） */
import { expandPair } from '../controls-note.js'; import { getSettings } from '../../core/settings.js'; import { trimText } from '../../core/utils.js'; import { apiKeyShown, button, card, el, emptyBlock, foldable, hostOf, line, numberInput, paintModelChips, row, saveBar, section, select, stage, stagedValue, textInput, textarea } from '../sections.js';
export function secApi(host) {
    const SECID = 'api';
    const s = getSettings();
    const api = s.api || {};
    const box = section('自定义 API（后台推演走这条通道）',
        '不锁死在酒馆默认连接上。云酒馆建议「经酒馆服务器转发」——密钥留在服务器侧，也绕开跨域。',
        { open: false, five: true });
    box.appendChild(expandPair({ el: el, button: button }));   /* 六：全部展开／全部收起 */
    const cCh = card('通道');
    /*
     * ⭐⭐ 她 13:xx 澄清后的真需求（我上一版 v0.3.71 修错了地方 ✗）：
     *   「我说的是**连接方式**……那个**下拉框**我保存了书签以后**没有出现在这里面**。
     *     最普通的插件不是都有这种的吗？」
     *   ⇒ 把「连接方式」做成**通道选择器**：两种连接方式 ＋ **她存的书签**（每条一个选项）✓
     *   ⚠️ 选中的值仍是 api.mode（direct／proxy）⇒ 旧数据照读 ✓（书签那几条是临时选项，选中即切走）
     */
    const modeOpts = [
        { value: 'proxy', label: '经酒馆服务器转发（云酒馆最稳）' },
        { value: 'direct', label: '直连（浏览器直接请求）' },
    ];
    for (const pf of (Array.isArray(api.profiles) ? api.profiles : [])) {
        const pfNick = trimText(pf && pf.nick);
        if (pfNick) {
            modeOpts.push({ value: 'profile:' + pfNick, label: '书签：' + pfNick + '（' + (pf.mode === 'direct' ? '直连' : '经酒馆转发') + '）' });
        }
    }
    /*
     * ⭐⭐ 当前用的是哪套通道（她 13:xx 报的“切完就回弹、两处对不上”）：
     *   有 `api.currentProfile` ⇒ 下拉框当前值就显示**她正在用的那个书签** ✓
     *   没有（老数据）⇒ 照旧显示 `api.mode` ✓（旧账照读）
     *   ⛔ 不动 direct／proxy 的老路（她的两段式 ✓ 测试也照旧 ✓）
     */
    /*
     * ⚠️ 修上一版的不一致：下拉框里**没有这个书签时**，`<select>` 会自动落回第一项（proxy），
     *   而人话行与「删」却还按 currentProfile 说话 ⇒ **三处不一致** ✗
     *   ⇒ 现在统一：**只有那个书签真的在选项里**，才算“当前这套” ✓
     */
    const curNick = (function () {
        /*
         * ⚠️ 真机复核抓到（第 11 轮）：选完书签重绘时，这里读的**还是旧快照** ✗
         *   ⇒ 算出空 ⇒ 「删」不渲染、人话回落到 mode ✗（两处同一个根因）
         *   ⇒ 现在：**草稿与已存两边都看**（草稿优先 ✓），
         *        并且只要它**在任一边的书签列表里存在**，就算“当前这套” ✓
         *   ⛔ 两段式架构不动（只是读的时候多看一眼已存那份 ✓）
         */
        const savedPick = getSettings().api || {};
        const want = trimText(api.currentProfile) || trimText(savedPick.currentProfile);
        if (!want) { return ''; }
        const draftList = Array.isArray(api.profiles) ? api.profiles : [];
        const savedList = Array.isArray(savedPick.profiles) ? savedPick.profiles : [];
        const hit = draftList.some((x) => (trimText(x && x.nick) || trimText(x && x.name)) === want) || savedList.some((x) => (trimText(x && x.nick) || trimText(x && x.name)) === want);
        return hit ? want : '';
    })();
    const curPick = curNick ? ('profile:' + curNick) : api.mode;
    /*
     * ⭐⭐ 照她 14:xx 发的截图（SP数据库的「当前 API 预设」：下拉框 ＋ 加/删）把形状对齐：
     *   「连接方式」这一行＝下拉框（列全部可用套路）＋「＋」（存成书签）＋「删」（删当前书签）✓
     *   ⛔ 纯加法、零新逻辑：「＋」复用原来的 save-profile（它自会去读书签名输入框）；
     *        「删」复用原来的 del-profile（把当前书签名当 data-id 传过去）✓
     */
    const modeRow = el('div', 'wxg-row');
    modeRow.appendChild(select('wxg-api-mode', modeOpts, curPick, 'stage-api-mode'));
    const plusBtn = button('＋', 'save-profile', 'wxg-btn-sm');
    plusBtn.setAttribute('title', '把下面「书签名」里填的名字，存成一套（同名就更新）');
    modeRow.appendChild(plusBtn);
    const curNickForDel = curNick;   /* 与下拉框同源 ✓（修上一版的不一致） */
    if (curNickForDel) {
        const delBtn = button('删', 'del-profile', 'wxg-btn-sm', curNickForDel);
        delBtn.setAttribute('title', '删掉当前这个书签「' + curNickForDel + '」');
        modeRow.appendChild(delBtn);
    }
    const modeLine = el('div', 'wxg-line');
    modeLine.appendChild(el('span', 'wxg-line-k', '连接方式'));
    /*
     * ⭐ LY6（材料 11·布局层）：**「连接方式」那一行要套 .wxg-line-v** ✓
     *   旧：把 .wxg-row 直接挂在 .wxg-line 下 ✗ ⇒ 少了标准的 .wxg-line-v 包装层 ✗
     *     ⇒ `.wxg-line > .wxg-line-v > select.wxg-pole` 的宽度样式**完全没命中** #wxg-api-mode ✗
     *     ⇒ 而 .wxg-row 自带 margin:7px 0 ⇒ 这一行的上下间距比别的行大一圈 ✗
     */
    const modeWrap = el('div', 'wxg-line-v');
    modeWrap.appendChild(modeRow);
    modeLine.appendChild(modeWrap);
    cCh.appendChild(modeLine);
    /* 一句人话：现在走的是哪条 ✓（照世界背面那句“我跟着…”的写法） */
    cCh.appendChild(el('div', 'wxg-note', '现在走的是：' + (curNickForDel
        ? ('书签「' + curNickForDel + '」那一套')
        : (api.mode === 'direct' ? '直连（浏览器直接请求）' : '经酒馆服务器转发'))
        + '。想换别的就在上面选；想存成一套，先填下面的「书签名」再点「＋」。'));
    /*
     * 依据＝阿砚 3 件任务 · 渲染层 #7（自定义 API 分组）：
     *   11 个控件原来平铺在一张卡里 ⇒ 按「连接／生成／测试」分三组，默认收起（连接组常开，因为地址/密钥要看得见）。
     */
    const mkApiFold = (title, open) => {
        const f = foldable(title, open === true);
        const b = el('div', 'wxg-sec-body');
        f.appendChild(b);
        cCh.appendChild(f);
        return b;
    };
    const bConn = mkApiFold('连接（地址／密钥／模型）', false);
    const bGen = mkApiFold('生成（打杂模型／温度／喂多少字／重试）', false);
    const bTest = mkApiFold('测一下连接', false);
    line(bConn, '接口地址', textInput('wxg-api-url', api.url, 'https://…/v1', 'stage-api-url', 'wxg-short'));
    /* ⭐ 她 13:xx：「密钥那里不能自动隐藏」⇒ 默认 password（遮住）＋ 旁边一个「显示」开关 ✓ */
    /* 九（阿砚九格）：密钥框补三句口径（本机读取·不离库·不打印），框里⛔ 回显 */
    line(bConn, '密钥', textInput('wxg-api-key', api.key, '（本机读取，不打印）', 'stage-api-key', 'wxg-short', (apiKeyShown ? 'text' : 'password')),
        button(apiKeyShown ? '隐藏' : '显示', 'toggle-api-key', 'wxg-btn-sm'));
    bConn.appendChild(el('div', 'wxg-note', '本机读取 · 不离库 · 不打印；只有你点「显示」才在框里露出来。'));
    line(bConn, '推演模型', textInput('wxg-api-model', api.model, '例：gemini-3.8-flash', 'stage-api-model', 'wxg-short'));
    /*
     * ⭐ 目标核对 3①：**拉取模型列表**（她："只能自己输名字太麻烦"）。
     *   点一下拉回来 ⇒ 列成一排可点的小片 ⇒ 点一个就填进「推演模型」（走同一条草稿，照旧要点段底保存）。
     *   ⚠️ 拉不到就**如实说原因**，**⛔ 影响手输**。
     */
    line(bConn, '', button('拉取模型列表', 'fetch-models', 'wxg-btn-sm'),
        el('span', 'wxg-note', '（向地址 + /models 要一份清单；拉不到也可以自己填）'));
    const modelBoxEl = el('div', 'wxg-chipwrap', '');
    modelBoxEl.id = 'wxg-api-modellist';
    cCh.appendChild(modelBoxEl);
    /* ⭐ RD1-3：拉过就画回来 ✓（旧：重绘变空盒 ✗） */
    try { paintModelChips(modelBoxEl); } catch (eMP) { /* 同上 ✓ */ }
    line(bGen, '打杂模型', textInput('wxg-api-model-cheap', api.modelCheap, '留空＝同上', 'stage-api-model-cheap', 'wxg-short'));
    /* ⭐修复 15（材料 02）：**温度框设 step="0.1"** ✓
     *   （旧：步长默认 1 ✗ ⇒ 她想填 0.6 这种小数很别扭 ✗） */
    const tempInput = numberInput('wxg-api-temp-code', api.temperature, 0, 2, 'stage-api-temp');
    tempInput.step = '0.1';
    line(bGen, '温度',
        tempInput,
        el('span', 'wxg-note', '单次最多输出'),
        numberInput('wxg-api-maxtok', api.maxTokens, 200, 65536, 'stage-api-maxtok'));
    /*
     * ⭐⭐ 她可调的一个旋钮（真机取证后才明白它有多重要）：
     *   她那个中转对**长请求**一律掉线（直连 reset、转发 502+ECONNRESET、连流式也照掉 ✗）；
     *   而**只有她知道那站能收多大的请求** ⇒ 把上限交给她，一档一档往下试 ✓
     */
    line(bGen, '每轮最多喂多少字正文', numberInput('wxg-api-material-cap', Number(api.materialCap) || 6000, 500, 40000, 'stage-api-material-cap'));
    line(bGen, '链路掉线后自己再试几次',
        numberInput('wxg-auto-retry-max', Number(api.autoRetryMax) || 2, 0, 5, 'stage-auto-retry-max'));
    cCh.appendChild(el('div', 'wxg-note', '链路掉线（reset／超时／回体空）时，它会自己等一会儿再试：这里填它最多自己试几次（0＝不自动试 ✓；默认 2 ✓）'));
    cCh.appendChild(el('div', 'wxg-note', '这个数**越小越容易穿过慢或爱掉线的站**（每轮只带最近这么多字），但模型看到的上下文也越少。卡住时可以一档一档往下试：6000 → 3000 → 1500 ✓'));
    /*
     * ⭐ 目标核对 3②：**把"已保存的地址/模型"摆出来**。
     *   她报过"模型名字填了、sk也填了"却仍报"没配好" ⇒
     *   光看输入框里的字**分不清是没保存上还是没填**。
     *   这行读的是**已落盘的设置值**（⛔ 输入框）⇒ 一眼就知道存没存上。
     */
    const savedApi = getSettings().api || {};
    cCh.appendChild(el('div', 'wxg-note wxg-api-savedline',
        '已保存的：地址 ' + (trimText(savedApi.url) || '（空）')
        + '｜推演模型 ' + (trimText(savedApi.model) || '（空）')
        + '｜模式 ' + (savedApi.mode === 'direct' ? '直连' : '经酒馆转发')));
    row(bTest, button('测一下连接', 'test-api', 'wxg-primary'), el('span', 'wxg-note', '（只发一句很短的话，验证地址／密钥／模型对不对）'));
    box.appendChild(cCh);
    /* ⭐ 书签（她点名要的："加一个保存 API／另存为，我可以设定好几个 API 转"） */
    const cProf = card('书签（存好几套通道，一键切）');
    const profs = Array.isArray(api.profiles) ? api.profiles : [];
    if (!profs.length) {
        cProf.appendChild(emptyBlock('还没有书签。上面填好一套，起个名字点「另存为书签」，以后一键切回来。'));
    } else {
        const listEl = el('div', 'wxg-prof-list');
        for (const p of profs) {
            const r = el('div', 'wxg-prof');
            const info = el('div', 'wxg-prof-info');
            info.appendChild(el('span', 'wxg-prof-nick', trimText(p.nick)));
            info.appendChild(el('span', 'wxg-note', (trimText(p.model) || '（没填模型）')
                + (trimText(p.url) ? ' · ' + hostOf(p.url) : '')
                + ' · ' + (p.mode === 'direct' ? '直连' : '走酒馆转发')));
            r.appendChild(info);
            const acts = el('div', 'wxg-row');
            const use = button('切到这套', 'apply-profile', 'wxg-btn-sm wxg-primary', trimText(p.nick));
            acts.appendChild(use);
            acts.appendChild(button('删', 'del-profile', 'wxg-btn-sm', trimText(p.nick)));
            r.appendChild(acts);
            listEl.appendChild(r);
        }
        cProf.appendChild(listEl);
    }
    row(cProf,
        textInput('wxg-profile-nick', '', '书签名（例：主站／备用站）', 'noop', 'wxg-short'),
        button('另存为书签', 'save-profile', 'wxg-primary'));
    cProf.appendChild(el('div', 'wxg-note', '书签存的是**整套**：连接方式／地址／密钥／模型／温度／输出上限。'
        + '书签名一样就更新那一条（不会越存越多）；想现在就用它，点上面那颗「切到这套」。'));
    box.appendChild(cProf);
    /* ★ 20261023 她拍板：附加主体参数／排除主体参数／附加请求头（不靠酒馆也能自己调） */
    /* ★ 20261023 她拍板：附加主体参数／排除主体参数／附加请求头（不靠酒馆也能自己调） */
    const cParams = card('请求参数（不靠酒馆也能自己调）');
    line(cParams, '附加主体参数',
        textarea('wxg-api-extra-body', stagedValue('api', 'extraBody', s.api.extraBody),
            '一行一个：key: value（合并进请求体）', 'stage-api-extra-body', 3));
    line(cParams, '排除主体参数',
        textInput('wxg-api-exclude-body', stagedValue('api', 'excludeBody', s.api.excludeBody),
            '一行一个字段名（默认 top_p）', 'stage-api-exclude-body'));
    line(cParams, '附加请求头',
        textarea('wxg-api-extra-headers', stagedValue('api', 'extraHeaders', s.api.extraHeaders),
            '一行一个：Header: Value', 'stage-api-extra-headers', 2));
    cParams.appendChild(el('div', 'wxg-note',
        '默认已排除 top_p：有些模型不收它，会被它拖成 400。附加主体参数一行一个 key: value，值会自动认数字／true false／JSON；附加请求头同样一行一个。'));
    box.appendChild(cParams);
    box.appendChild(saveBar('api'));
    host.appendChild(box);

}
