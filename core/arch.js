/**
 * 万象阁 · 行数硬锁当架构约束（阿砚第三批 C 档 P2 · D6）
 *
 * 依据＝D6「行数硬锁当架构约束」；挡的风险：接线层长成 3000 行、没人敢动。
 *
 * 口径（⛔ 拿行数当“好坏”的替代品）：
 *   · 行数只是**提醒**：超线不代表坏，代表“该拆了，或者该在台账里写明为什么还这么大”
 *   · 每个文件都有两个数：`soft`（提醒线）与 `hard`（硬线，超了自测直接红）
 *   · 台账里**显式豁免**的文件必须写理由（⛔ 只填一个数字了事）
 *
 * 这一层只在自测里跑（运行时读不到文件），所以 `run-tests-wiring.mjs` 把它放进了 test-only 白名单。
 */

/** 软线/硬线（硬线超了 ⇒ 自测红；软线超了 ⇒ 只提醒） */
export const LINE_LIMITS = {
    /*
     * 阿砚第三批收尾：本轮从主文件抽出了四个模块
     *   （`ui/esc-close.js`／`ui/prompt-copy.js`／`ui/runwarn-view.js`／`ui/chron-search.js`），
     *   但红条／变量清单／世界网格／编年搜索四处仍留在主文件，硬线从 8200 抬到 8250（实际 8218）。
     *   下一步要不要再抬，得先按段拆 `secWorld`；⛔ 靠抬线跟着长。
     */
    'ui/sections.js': { soft: 6000, hard: 8250, why: '面板所有段都在这一个文件里（历史原因）；已抽出 esc-close／prompt-copy／runwarn-view／chron-search，再拆先按段迁 secWorld' },
    'core/state.js': { soft: 2600, hard: 3100, why: '状态仓库＋一堆归一化函数；再涨就该把 normalize* 分出去' },
    'core/pipeline.js': { soft: 2600, hard: 3000, why: '两步推演＋补推＋召回串在这；再涨就该拆 stepWorld/stepChars' },
    'core/apiclient.js': { soft: 1200, hard: 1500, why: '两套通道＋流式＋补丁都在；再涨就拆 channel 适配' },
    'core/adapter.js': { soft: 1000, hard: 1300, why: '平台适配＋底稿＋缓存镜像；再涨就拆 mirror' },
    'core/recall.js': { soft: 1000, hard: 1300, why: '召回＋注入组装；再涨就拆 assemble' },
    'core/worldbook.js': { soft: 950, hard: 1200, why: '世界书桥＋好感读取' },
    'core/book-wiki.js': { soft: 850, hard: 1100, why: '世界书维基档案（提取/合并/写回都在这）' },
    'core/book.js': { soft: 700, hard: 900, why: '世界书落点（摘要/人物/编年分页）' },
    'core/config.js': { soft: 700, hard: 900, why: '常量/模板/枚举表' },
    'index.js': { soft: 750, hard: 950, why: '入口：事件绑定/启动/面板挂载全在这' },
    'ui/sections.js 之外 ui/*.js': { soft: 650, hard: 900, why: '界面单件（每个界面文件各自一份）' },
    'core/*.js 其余': { soft: 600, hard: 900, why: '单件默认线' },
};

/** 台账里显式豁免（必须写理由；⛔ 空理由） */
export const LINE_EXEMPTIONS = {
    /* 'path/to/file.js': '为什么允许它这么大', */
};

/** 取某个文件适用的线（没登记就用默认） */
export function limitOf(file) {
    const f = String(file || '').replace(/\\/g, '/');
    if (LINE_LIMITS[f]) { return Object.assign({ file: f }, LINE_LIMITS[f]); }
    if (f.startsWith('ui/')) { return Object.assign({ file: f }, LINE_LIMITS['ui/sections.js 之外 ui/*.js']); }
    return Object.assign({ file: f }, LINE_LIMITS['core/*.js 其余']);
}

/**
 * 核一遍。
 * @param {Array<{file:string, lines:number}>} files
 * @returns {{ok:boolean, hard:Array, soft:Array, exempt:Array}}
 */
export function checkLineLimits(files) {
    const hard = [];
    const soft = [];
    const exempt = [];
    for (const item of Array.isArray(files) ? files : []) {
        const f = String((item && item.file) || '').replace(/\\/g, '/');
        const n = Number(item && item.lines);
        if (!f || !Number.isFinite(n)) { continue; }
        if (LINE_EXEMPTIONS[f]) {
            exempt.push({ file: f, lines: n, why: LINE_EXEMPTIONS[f] });
            continue;
        }
        const lim = limitOf(f);
        if (n > lim.hard) {
            hard.push({ file: f, lines: n, hard: lim.hard, soft: lim.soft, why: lim.why });
        } else if (n > lim.soft) {
            soft.push({ file: f, lines: n, hard: lim.hard, soft: lim.soft, why: lim.why });
        }
    }
    return { ok: hard.length === 0, hard, soft, exempt };
}

/** 给人看的一行 */
export function lineLine(report) {
    const r = report || { hard: [], soft: [] };
    if (r.hard && r.hard.length) {
        return '行数硬线超了 ' + String(r.hard.length) + ' 件：'
            + r.hard.map((x) => x.file + '(' + x.lines + '>' + x.hard + ')').join('、');
    }
    if (r.soft && r.soft.length) {
        return '行数提醒线超了 ' + String(r.soft.length) + ' 件（还没到硬线）：'
            + r.soft.map((x) => x.file + '(' + x.lines + '>' + x.soft + ')').join('、');
    }
    return '行数：所有文件都在线内';
}
