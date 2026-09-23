package io.github.russell0123.calendar;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Typeface;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.StrikethroughSpan;
import android.text.style.StyleSpan;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.Locale;

/**
 * 桌面小工具：跟 App 裡一樣的月曆（6 週 × 7 天，每格最多 3 個任務色條）。
 * 資料由 App 透過 WidgetBridgePlugin 存進 SharedPreferences；‹ › 切換月份，點日期打開 App。
 */
public class CalendarWidget extends AppWidgetProvider {
    static final String PREFS = "calendar_widget";
    static final String KEY_DATA = "data";
    static final String KEY_OFFSET = "offset";
    private static final String ACTION_PREV = "io.github.russell0123.calendar.WIDGET_PREV";
    private static final String ACTION_NEXT = "io.github.russell0123.calendar.WIDGET_NEXT";
    private static final String ACTION_TODAY = "io.github.russell0123.calendar.WIDGET_TODAY";
    private static final int MAX_EVENTS = 3;
    private static final String[] WEEK = {"日", "一", "二", "三", "四", "五", "六"};

    /** 重畫所有已放在桌面上的小工具 */
    static void refreshAll(Context ctx) {
        AppWidgetManager m = AppWidgetManager.getInstance(ctx);
        int[] ids = m.getAppWidgetIds(new ComponentName(ctx, CalendarWidget.class));
        for (int id : ids) m.updateAppWidget(id, build(ctx));
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager m, int[] ids) {
        for (int id : ids) m.updateAppWidget(id, build(ctx));
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        String a = intent.getAction();
        if (a == null) return;
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        int off = p.getInt(KEY_OFFSET, 0);
        if (ACTION_PREV.equals(a)) off--;
        else if (ACTION_NEXT.equals(a)) off++;
        else if (ACTION_TODAY.equals(a)) off = 0;
        else return;
        p.edit().putInt(KEY_OFFSET, off).apply();
        refreshAll(ctx);
    }

    private static PendingIntent broadcast(Context ctx, String action, int req) {
        Intent i = new Intent(ctx, CalendarWidget.class).setAction(action);
        return PendingIntent.getBroadcast(ctx, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static String key(Calendar c) {
        return String.format(Locale.US, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    /** 網頁的色碼（#RRGGBB 或 #RRGGBBAA）→ Android 的 ARGB 整數 */
    private static int css(String s, int fallback) {
        try {
            if (s == null || !s.startsWith("#")) return fallback;
            long v = Long.parseLong(s.substring(1), 16);
            if (s.length() == 7) return (int) (0xFF000000L | v);
            if (s.length() == 9) return (int) (((v & 0xFF) << 24) | (v >>> 8));
        } catch (Exception ignored) { }
        return fallback;
    }

    static RemoteViews build(Context ctx) {
        String pkg = ctx.getPackageName();
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONObject data;
        try { data = new JSONObject(p.getString(KEY_DATA, "{}")); } catch (Exception e) { data = new JSONObject(); }
        JSONObject days = data.optJSONObject("days");
        if (days == null) days = new JSONObject();
        boolean dark = data.optBoolean("dark", false);
        boolean neon = data.optBoolean("neon", false);

        // 跟 App 的主題一致
        int bg = dark ? 0xF21D1C1A : (neon ? 0xF2FFFFFF : 0xF2F1EDE4);
        int cellBg = dark ? 0xFF1D1C1A : (neon ? 0xFFFFFFFF : 0xFFF1EDE4);
        int ink = dark ? 0xFFE8E3D8 : 0xFF2B2A27;
        int muted = dark ? 0xFF9A9387 : 0xFF8B8579;
        int line = dark ? 0xFF3A3833 : (neon ? 0xFFE1E4E1 : 0xFFDCD5C7);
        int todayColor = neon ? (dark ? 0xFF5CF27A : 0xFF1F9E37) : (dark ? 0xFFD08A5A : 0xFFB0683A);

        Calendar now = Calendar.getInstance();
        String todayKey = key(now);
        Calendar first = Calendar.getInstance();
        first.set(Calendar.DAY_OF_MONTH, 1);
        first.add(Calendar.MONTH, p.getInt(KEY_OFFSET, 0));
        int month = first.get(Calendar.MONTH);

        Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openApp = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        RemoteViews root = new RemoteViews(pkg, R.layout.widget_calendar);
        root.setInt(R.id.widget_root, "setBackgroundColor", bg);
        root.setTextViewText(R.id.widget_title, first.get(Calendar.YEAR) + "年" + (month + 1) + "月");
        root.setTextColor(R.id.widget_title, ink);
        root.setTextColor(R.id.widget_prev, muted);
        root.setTextColor(R.id.widget_next, muted);
        root.setTextColor(R.id.widget_today, muted);
        root.setOnClickPendingIntent(R.id.widget_title, openApp);
        root.setOnClickPendingIntent(R.id.widget_prev, broadcast(ctx, ACTION_PREV, 1));
        root.setOnClickPendingIntent(R.id.widget_next, broadcast(ctx, ACTION_NEXT, 2));
        root.setOnClickPendingIntent(R.id.widget_today, broadcast(ctx, ACTION_TODAY, 3));

        root.removeAllViews(R.id.widget_weekdays);
        for (String w : WEEK) {
            RemoteViews t = new RemoteViews(pkg, R.layout.widget_weekday);
            t.setTextViewText(R.id.wd, w);
            t.setTextColor(R.id.wd, muted);
            root.addView(R.id.widget_weekdays, t);
        }

        root.removeAllViews(R.id.widget_grid);
        root.setInt(R.id.widget_grid, "setBackgroundColor", line); // 格線＝格子之間露出的底色
        Calendar c = (Calendar) first.clone();
        c.add(Calendar.DAY_OF_MONTH, -(c.get(Calendar.DAY_OF_WEEK) - 1));
        for (int w = 0; w < 6; w++) {
            RemoteViews week = new RemoteViews(pkg, R.layout.widget_week);
            for (int d = 0; d < 7; d++) {
                RemoteViews cell = new RemoteViews(pkg, R.layout.widget_cell);
                String k = key(c);
                boolean out = c.get(Calendar.MONTH) != month;
                boolean isToday = k.equals(todayKey);
                cell.setInt(R.id.cell, "setBackgroundColor", cellBg);

                SpannableString num = new SpannableString(String.valueOf(c.get(Calendar.DAY_OF_MONTH)));
                if (isToday) num.setSpan(new StyleSpan(Typeface.BOLD), 0, num.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                cell.setTextViewText(R.id.cell_day, num);
                cell.setTextColor(R.id.cell_day, isToday ? todayColor : (out ? muted : ink));

                cell.removeAllViews(R.id.cell_events);
                JSONArray evs = days.optJSONArray(k);
                if (evs != null) {
                    int shown = Math.min(evs.length(), MAX_EVENTS);
                    for (int i = 0; i < shown; i++) {
                        JSONArray e = evs.optJSONArray(i);
                        if (e == null) continue;
                        RemoteViews ev = new RemoteViews(pkg, R.layout.widget_event);
                        SpannableString title = new SpannableString(e.optString(0));
                        boolean done = e.optInt(3, 0) == 1;
                        if (done) title.setSpan(new StrikethroughSpan(), 0, title.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                        ev.setTextViewText(R.id.ev, title);
                        ev.setInt(R.id.ev, "setBackgroundColor", css(e.optString(1), line));
                        int fg = css(e.optString(2), ink);
                        ev.setTextColor(R.id.ev, done ? (fg & 0x00FFFFFF) | 0x80000000 : fg);
                        cell.addView(R.id.cell_events, ev);
                    }
                    if (evs.length() > MAX_EVENTS) {
                        RemoteViews more = new RemoteViews(pkg, R.layout.widget_event);
                        more.setTextViewText(R.id.ev, "+" + (evs.length() - MAX_EVENTS));
                        more.setTextColor(R.id.ev, muted);
                        more.setInt(R.id.ev, "setBackgroundColor", 0x00000000);
                        cell.addView(R.id.cell_events, more);
                    }
                }
                cell.setOnClickPendingIntent(R.id.cell, openApp);
                week.addView(R.id.week, cell);
                c.add(Calendar.DAY_OF_MONTH, 1);
            }
            root.addView(R.id.widget_grid, week);
        }
        return root;
    }
}
