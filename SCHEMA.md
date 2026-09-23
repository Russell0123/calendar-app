# 資料結構 v2

設計原則
- **行事曆是最上層容器**：每個行事曆的任務、標籤、課表、流程、視圖完全獨立，可新增、複製、刪除、清空。
- **標籤是扁平的**：分組（類型、科目…）只是標籤的選填屬性，在編輯任務時的標籤選單裡設定，不預設、不鎖死。
- **一個任務庫**：行事曆、看板、流程圖讀同一張 `tasks`。
- **任務之間是圖**：`links` 存「前置 → 後續」，可分散、可彙集。
- **同步就緒**：每筆資料有 `id`(uuid)、`created_at`、`updated_at`、`deleted_at`（軟刪除），之後接 Supabase 用「最後寫入者勝」合併。

除 `calendars` 外，每張表都有 `calendar_id`。

| 表 | 主要欄位 | 說明 |
|---|---|---|
| calendars | name, order | 行事曆 |
| tags | name, color, group?, order | group 選填；看板可「依分組分欄」 |
| tasks | title, notes, date?, end_date?, start_time?, end_time?, status, tag_ids[], reminders[] | 沒日期＝待安排；「點子」只是一個標籤 |
| links | from, to | 前置 → 後續 |
| boards | title, nodes[{task_id,x,y}] | 流程圖；線不存在這裡，兩端都在圖上就會畫出 |
| courses | name, day(0-6), start, end（節次索引，見 periods.js）, room, teacher, tag_ids[], notes | 課表；有標籤時自動連結同標籤的未完成任務 |
| routines | （舊版固定行程，已不使用） | |
| notes | date, text, done | 首頁隨手記 |
| views | name, group?, filter{tag_ids[], range, status} | 看板視圖；有 group＝分欄，否則列表。篩選：同分組 OR、跨分組 AND |

meta：`current_calendar_id`、`default_remind_time`（沒設時間的任務以此時間提醒）。
