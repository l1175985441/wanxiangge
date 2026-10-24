/**
 * 万象阁 · 长活闸（A 组 H4）
 *
 * 依据＝阿砚 A 组 H4：「长活的“尽力而为 vs 真保证”分层（闸不依赖 DOM；灰按钮只是尽量）」。
 * 挡的病：**连点发两串模型调用**（白等一份、花两份钱）。
 *
 * 分工（这一层是“真保证”）：
 *   · 这里＝模块内的占用登记，**不读 DOM、不看按钮灰没灰**；
 *   · 界面把按钮变灰只是“尽量”，挡不住键盘回车 / 悬浮球 / 魔法棒三个入口各点一次；
 *   · 所以任何长活入口都必须先 `claim()`，抢不到就直接回话（⛔ 静默排队、⛔ 两个一起跑）。
 */

const busyMap = new Map();

/**
 * 抢闸。抢到返回 true；已被占返回 false（调用方负责把"已经有一份在跑"说给用户）。
 * @param {string} name 闸名（如 'update' / 'backfill' / 'publish'）
 */
export function claim(name) {
    const key = String(name || 'default');
    if (busyMap.has(key)) {
        return false;
    }
    busyMap.set(key, { at: Date.now() });
    return true;
}

/** 放闸。⛔ 抛错；没占过也当成功（幂等） */
export function release(name) {
    const key = String(name || 'default');
    busyMap.delete(key);
    return true;
}

/** 有没有人在跑（面板想显示"运行中"就问它，⛔ 读 DOM） */
export function isBusy(name) {
    return busyMap.has(String(name || 'default'));
}

/** 谁在跑、跑了多久（诊断用；也方便夹具验"闸会自己过期"这类事） */
export function busyInfo(name) {
    const rec = busyMap.get(String(name || 'default'));
    if (!rec) {
        return null;
    }
    return { at: rec.at, ms: Date.now() - rec.at };
}

/** 只在测试/极端情况下用：把闸全清掉（换聊天时防止一次异常把闸卡死） */
export function releaseAll() {
    busyMap.clear();
}
