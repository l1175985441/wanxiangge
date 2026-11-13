/* 设-4：世界书条目列表与搜索词（共享状态） */
export let pickEntries = [];
export let entFilter = '';
export function setPickEntries(v) { pickEntries = v; }
export function setEntFilter(v) { entFilter = v; }
