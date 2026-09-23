package io.github.russell0123.calendar;

import android.content.Context;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** App（網頁端）把月曆資料交給桌面小工具：存起來後叫小工具重畫。 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

    @PluginMethod
    public void update(PluginCall call) {
        String data = call.getString("data", "{}");
        Context ctx = getContext();
        ctx.getSharedPreferences(CalendarWidget.PREFS, Context.MODE_PRIVATE)
            .edit().putString(CalendarWidget.KEY_DATA, data).apply();
        CalendarWidget.refreshAll(ctx);
        call.resolve();
    }
}
