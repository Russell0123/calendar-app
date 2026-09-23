// 新裝置第一次打開時的「示範用」行事曆：簡單課表＋五個示範任務＋一張流程圖
// 日期以建立當天為準往後排，讓首頁、月曆、課表一打開就看得到東西。登入後可改用雲端資料。
const pad = n => String(n).padStart(2, '0');
const day = (offset, weekdayOnly = false) => {
  const d = new Date(); d.setDate(d.getDate() + offset);
  if (weekdayOnly) while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1); // 上課相關的排在平日
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function SEED(state, { put }) {
  const cal = put('calendars', { name: '示範用', order: 0 });
  const C = cal.id;
  state.meta.current_calendar_id = C;

  // 標籤：類型、屬性兩組；科目標籤跟著課程建立
  const tag = {};
  let order = 0;
  const T = (name, color, group) => (tag[name] = put('tags', { calendar_id: C, name, color, group, order: order++ }).id);
  ['學業', '工作', '創作', '日常'].forEach(n => T(n, 'gray', '類型'));
  T('國定假日', 'darkgray', '類型');
  ['考試', '作業', '行程', '任務', '點子'].forEach(n => T(n, 'gray', '屬性'));
  ['國文', '英文', '數學'].forEach(n => T(n, 'gray', '科目'));

  // 課表：day 0＝週日…6＝週六；start/end 是節次索引（0＝第 1 節）
  [
    ['國文', 1, 0, 1, '201 教室', '陳老師'], ['國文', 3, 2, 2, '201 教室', '陳老師'],
    ['英文', 2, 2, 3, '語言教室', '林老師'], ['英文', 4, 0, 1, '語言教室', '林老師'],
    ['數學', 1, 4, 5, '305 教室', '王老師'], ['數學', 3, 0, 1, '305 教室', '王老師'], ['數學', 5, 2, 3, '305 教室', '王老師'],
  ].forEach(([name, d, start, end, room, teacher]) =>
    put('courses', { calendar_id: C, name, day: d, start, end, room, teacher, tag_id: tag[name], notes: '' }));

  // 五個示範任務
  const task = (title, extra) => put('tasks', {
    calendar_id: C, title, notes: '', date: null, end_date: null, start_time: null, end_time: null,
    status: 'todo', priority: 0, tag_ids: [], reminders: [], ...extra,
  }).id;
  const exam = task('數學小考（第三章）', { date: day(3, true), start_time: '10:20', tag_ids: [tag['學業'], tag['考試'], tag['數學']], priority: 3, reminders: [1440],
    notes: '範圍：第三章 3-1 ～ 3-4\n記得帶計算機' });
  const hw = task('英文作業：Unit 5 閱讀心得', { date: day(5, true), tag_ids: [tag['學業'], tag['作業'], tag['英文']], priority: 2, reminders: [1440] });
  const meet = task('國文報告小組討論', { date: day(2, true), start_time: '12:20', end_time: '13:10', tag_ids: [tag['學業'], tag['行程'], tag['國文']], priority: 1, reminders: [60],
    notes: '地點：圖書館討論室' });
  task('和朋友看電影', { date: day(6), start_time: '19:00', tag_ids: [tag['日常'], tag['行程']], reminders: [60] });
  const buy = task('買筆記本和紅筆', { tag_ids: [tag['任務']], priority: 1 });

  // 流程圖示範：兩件事彙集到小考前完成
  put('links', { calendar_id: C, from: buy, to: exam });
  put('links', { calendar_id: C, from: meet, to: hw });
  put('boards', { calendar_id: C, title: '考前準備', nodes: [
    { task_id: buy, x: 40, y: 40 }, { task_id: meet, x: 40, y: 200 },
    { task_id: hw, x: 300, y: 200 }, { task_id: exam, x: 300, y: 40 },
  ] });

  const V = (name, group, tag_ids, o) => put('views', { calendar_id: C, name, group, filter: { tag_ids, range: 'all', status: 'all' }, order: o });
  V('全部', null, [], 0);
  V('屬性', '屬性', [], 1);
  V('科目', '科目', [], 2);
  V('考試', null, [tag['考試']], 3);
}
