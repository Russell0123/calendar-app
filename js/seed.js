// 初始資料：一個行事曆、基本標籤、課表、看板視圖（沒有任務）
import { courseRows } from './periods.js';

export function SEED(state, { put }) {
  const cal = put('calendars', { name: '114-1 行事曆', order: 0 });
  state.meta.current_calendar_id = cal.id;

  const tag = {};
  let order = 0;
  [
    ['類型', [['學業', 'blue'], ['工作', 'orange'], ['創作', 'yellow'], ['日常', 'green'], ['國定假日', 'red']]],
    ['屬性', [['考試', 'red'], ['作業', 'gray'], ['行程', 'blue'], ['任務', 'purple'], ['點子', 'yellow']]],
  ].forEach(([group, list]) => list.forEach(([name, color]) => (tag[name] = put('tags', { calendar_id: cal.id, name, color, group, order: order++ }).id)));

  // 課表（科目標籤由 db.linkCourses 自動建立）
  courseRows(cal.id).forEach(r => put('courses', r));
  state.meta.courses_seeded = true;

  const V = (name, group, tag_ids, order) => put('views', { calendar_id: cal.id, name, group, filter: { tag_ids, range: 'all', status: 'all' }, order });
  V('全部', null, [], 0);
  V('屬性', '屬性', [], 1);
  V('科目', '科目', [], 2);
  V('考試', null, [tag['考試']], 3);
}
