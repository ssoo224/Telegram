#!/usr/bin/env python3
"""يعدّل مشروع أندرويد المولَّد بـ Capacitor: الصلاحيات، الإشعارات، رقم النسخة، والتوقيع."""
import os, re, sys, shutil, pathlib

root = pathlib.Path(__file__).resolve().parent.parent      # app/
app = root / "android" / "app"
run = os.environ.get("RUN_NUMBER", "1")

def rd(p): return p.read_text(encoding="utf-8")
def wr(p, s): p.write_text(s, encoding="utf-8")
def die(msg, p=None):
    print("::error::" + msg)
    if p and p.exists(): print(rd(p)[:3000])
    sys.exit(1)

# 1) Firebase (الإشعارات)
gs = root / "google-services.json"
if gs.exists():
    shutil.copy(gs, app / "google-services.json"); print("google-services.json copied")
else:
    print("::warning::app/google-services.json مفقود — الإشعارات ما راح تشتغل")

# 2) AndroidManifest
mf = app / "src" / "main" / "AndroidManifest.xml"
m = rd(mf)
perms = ["POST_NOTIFICATIONS", "RECORD_AUDIO", "CAMERA", "MODIFY_AUDIO_SETTINGS", "VIBRATE", "READ_MEDIA_IMAGES", "READ_MEDIA_VIDEO", "READ_EXTERNAL_STORAGE", "REQUEST_INSTALL_PACKAGES"]
add = "".join('    <uses-permission android:name="android.permission.%s" />\n' % p
              for p in perms if 'android.permission.%s"' % p not in m)
add += '    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />\n'
add += '    <uses-feature android:name="android.hardware.camera" android:required="false" />\n'
add += '    <uses-feature android:name="android.hardware.microphone" android:required="false" />\n'
if "</manifest>" not in m: die("manifest غير متوقع", mf)
m = m.replace("</manifest>", add + "</manifest>")
if "windowSoftInputMode" not in m:
    m, n = re.subn(r"<activity\b", '<activity android:windowSoftInputMode="adjustResize"', m, count=1)
    if n != 1: die("ما لقيت activity", mf)
meta = '        <meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" android:value="messages" />\n'
meta += '        <meta-data android:name="com.google.firebase.messaging.default_notification_icon" android:resource="@drawable/ic_stat_notify" />\n'
meta += '        <meta-data android:name="com.google.firebase.messaging.default_notification_color" android:resource="@color/notif_gold" />\n'
if "default_notification_channel_id" not in m:
    if "</application>" not in m: die("ما لقيت application", mf)
    m = m.replace("</application>", meta + "    </application>")
wr(mf, m)

# 2.5) أيقونة الإشعار الصغيرة (أبيض على شفاف) + لون الإشعار
res = app / "src" / "main" / "res"
badge = root.parent / "badge-96.png"
if badge.exists():
    (res / "drawable").mkdir(parents=True, exist_ok=True)
    shutil.copy(badge, res / "drawable" / "ic_stat_notify.png")
    print("notification icon copied")
else:
    print("::warning::badge-96.png مفقود — أيقونة الإشعار راح تطلع مربع أبيض")
(res / "values").mkdir(parents=True, exist_ok=True)
wr(res / "values" / "notif_colors.xml", '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="notif_gold">#C9961F</color>\n</resources>\n')

# 2.6) Android 15+ يفرض edge-to-edge: المحتوى يطلع تحت شريط الحالة. نضيف حشوة (padding) بحجم الأشرطة.
java_root = app / "src" / "main" / "java"
mains = list(java_root.rglob("MainActivity.java"))
if not mains: die("ما لقيت MainActivity.java", java_root)
ma = mains[0]
pkg = re.search(r"^\s*package\s+([\w.]+)\s*;", rd(ma), re.M)
if not pkg: die("ما لقيت package", ma)
wr(ma, r"""package %s;

import android.Manifest;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.view.View;
import android.view.Window;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import android.util.Base64;

public class MainActivity extends BridgeActivity {
    private static final int MEDIA_PERMISSION_REQUEST = 7301;
    private final ExecutorService mediaExecutor = Executors.newSingleThreadExecutor();

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        WindowCompat.setDecorFitsSystemWindows(window, false);

        View decor = window.getDecorView();
        decor.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        );
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(window, decor);
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);

        // تسجيل واجهة الحفظ فوراً (قبل تحميل الصفحة) ليعمل التنزيل إلى المعرض.
        registerNativeBridge();
        BabylonCall.onIntent(this, getIntent());

        // طلب صلاحيات الوسائط/الإشعارات مرة واحدة عند أول تشغيل فقط.
        android.content.SharedPreferences prefs =
            getSharedPreferences("babylon_permissions", MODE_PRIVATE);
        if (!prefs.getBoolean("first_request_done", false)) {
            prefs.edit().putBoolean("first_request_done", true).apply();
            decor.postDelayed(this::requestInitialPermissions, 700);
        }
    }

    // مرجع للصفحة الحيّة: تستخدمه أزرار الإشعار لإرسال (رد) و(مقروءة) إلى التطبيق.
    static WebView liveWebView;
    private boolean nativeBridgeRegistered = false;

    private void registerNativeBridge() {
        if (nativeBridgeRegistered) return;
        try {
            WebView webView = getBridge().getWebView();
            webView.addJavascriptInterface(new BabylonAndroidBridge(), "BabylonAndroidNative");
            webView.addJavascriptInterface(new BabylonCall.Bridge(getApplicationContext()), "BabylonCallNative");
            liveWebView = webView;
            nativeBridgeRegistered = true;
        } catch (Throwable t) {
            android.util.Log.e("BabylonChat", "registerNativeBridge failed", t);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        BabylonCall.onIntent(this, intent);
    }

    @Override
    public void onPause() {
        super.onPause();
        keepWebAliveForCall();
    }

    @Override
    public void onStop() {
        super.onStop();
        keepWebAliveForCall();
    }

    /** أثناء المكالمة لا نترك الصفحة تتجمد بالخلفية (وإلا ينقطع الصوت). */
    private void keepWebAliveForCall() {
        try {
            if (BabylonCall.active && getBridge() != null && getBridge().getWebView() != null) {
                WebView w = getBridge().getWebView();
                w.onResume();
                w.resumeTimers();
            }
        } catch (Throwable ignored) { }
    }

    @Override
    public void onStart() {
        super.onStart();
        registerNativeBridge();
    }

    @Override
    public void onResume() {
        super.onResume();
        registerNativeBridge();
        BabylonNotifications.dispatchPending(getApplicationContext(), liveWebView);
    }

    private void requestInitialPermissions() {
        java.util.ArrayList<String> needed = new java.util.ArrayList<>();
        if (Build.VERSION.SDK_INT >= 33) {
            if (checkSelfPermission(Manifest.permission.READ_MEDIA_IMAGES) != PackageManager.PERMISSION_GRANTED)
                needed.add(Manifest.permission.READ_MEDIA_IMAGES);
            if (checkSelfPermission(Manifest.permission.READ_MEDIA_VIDEO) != PackageManager.PERMISSION_GRANTED)
                needed.add(Manifest.permission.READ_MEDIA_VIDEO);
            if (checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED)
                needed.add("android.permission.POST_NOTIFICATIONS");
        } else if (Build.VERSION.SDK_INT >= 23 && Build.VERSION.SDK_INT <= 28) {
            if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED)
                needed.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
            if (checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED)
                needed.add(Manifest.permission.READ_EXTERNAL_STORAGE);
        }
        if (!needed.isEmpty())
            requestPermissions(needed.toArray(new String[0]), MEDIA_PERMISSION_REQUEST);
    }

    private class BabylonAndroidBridge {
        @JavascriptInterface
        public void showMessageNotificationEx(String title, String body, String avatar, String otherId, String chatId) {
            BabylonNotifications.show(getApplicationContext(), title, body, avatar, otherId, chatId);
        }

        @JavascriptInterface
        public void cacheAvatar(String otherId, String src) {
            BabylonNotifications.cacheAvatar(getApplicationContext(), otherId, src);
        }

        @JavascriptInterface
        public void ackAction(String id) {
            BabylonNotifications.ack(getApplicationContext(), id);
        }

        /** يفتح رابط https بالمتصفح الخارجي (لتنزيل تحديث التطبيق). */
        @JavascriptInterface
        public void openExternal(String url) {
            try {
                if (url == null || !url.startsWith("https://")) return;
                Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
            } catch (Throwable ignored) { }
        }

        /** تحديث بضغطة وحدة: ينزّل الـ APK من موقعنا ويفتح شاشة التثبيت. */
        @JavascriptInterface
        public void installUpdate(String url) {
            runUpdate(url);
        }

        @JavascriptInterface
        public void flushPending() {
            runOnUiThread(() -> BabylonNotifications.dispatchPending(getApplicationContext(), liveWebView));
        }

        @JavascriptInterface
        public void saveMedia(String source, String filename, String mimeType) {
            if (source == null || source.isEmpty()) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "تعذر تنزيل الملف", Toast.LENGTH_SHORT).show());
                return;
            }
            mediaExecutor.execute(() -> saveMediaInternal(source, filename, mimeType));
        }
    }

    // BABYLON-UPD-BEGIN
    private volatile boolean updating = false;

    private void updJs(String state, int pct) {
        runOnUiThread(() -> {
            try {
                WebView w = liveWebView;
                if (w != null) w.evaluateJavascript("window.__babylonUpd&&window.__babylonUpd('" + state + "'," + pct + ")", null);
            } catch (Throwable ignored) { }
        });
    }

    /** مسموح فقط رابط /api/apk من نفس موقع التطبيق (حتى ما تنفتح الدالة لروابط غريبة). */
    private boolean updUrlAllowed(String url) {
        try {
            if (url == null || !url.startsWith("https://")) return false;
            WebView w = liveWebView;
            String cur = (w == null) ? null : w.getUrl();
            if (cur == null) return false;
            Uri u = Uri.parse(url);
            String host = u.getHost();
            String path = u.getPath();
            return host != null && host.equals(Uri.parse(cur).getHost()) && "/api/apk".equals(path);
        } catch (Throwable t) {
            return false;
        }
    }

    private void runUpdate(String url) {
        if (!updUrlAllowed(url)) { updJs("error", 0); return; }
        if (updating) return;
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            runOnUiThread(() -> {
                try {
                    Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()));
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Throwable ignored) { }
            });
            updJs("perm", 0);
            return;
        }
        updating = true;
        new Thread(() -> {
            try {
                downloadAndInstall(url);
            } catch (Throwable t) {
                updJs("error", 0);
            } finally {
                updating = false;
            }
        }).start();
    }

    private void downloadAndInstall(String source) throws Exception {
        File dir = new File(getCacheDir(), "updates");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("mkdir");
        File apk = new File(dir, "babylon-chat.apk");
        HttpURLConnection c = (HttpURLConnection) new URL(source).openConnection();
        c.setConnectTimeout(20000);
        c.setReadTimeout(30000);
        c.setInstanceFollowRedirects(true);
        c.connect();
        if (c.getResponseCode() != 200) throw new Exception("http " + c.getResponseCode());
        long total = c.getContentLengthLong();
        long done = 0;
        int last = -1;
        updJs("dl", 0);
        try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(apk)) {
            byte[] buf = new byte[32768];
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
                done += n;
                if (total > 0) {
                    int p = (int) (done * 100L / total);
                    if (p != last) { last = p; updJs("dl", p); }
                }
            }
        } finally {
            c.disconnect();
        }
        if (apk.length() < 1000000L) throw new Exception("small");
        try (InputStream chk = new java.io.FileInputStream(apk)) {
            if (chk.read() != 'P' || chk.read() != 'K') throw new Exception("not apk");
        }
        updJs("ready", 100);
        final Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".updates", apk);
        runOnUiThread(() -> {
            try {
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, "application/vnd.android.package-archive");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
            } catch (Throwable t) {
                updJs("error", 0);
            }
        });
    }
    // BABYLON-UPD-END

    private void saveMediaInternal(String source, String filename, String mimeType) {
        try {
            byte[] bytes;
            if (source.startsWith("data:")) {
                int comma = source.indexOf(',');
                if (comma < 0) throw new Exception("invalid data URL");
                String meta = source.substring(0, comma);
                String body = source.substring(comma + 1);
                bytes = meta.contains(";base64")
                    ? Base64.decode(body, Base64.DEFAULT)
                    : java.net.URLDecoder.decode(body, "UTF-8").getBytes("UTF-8");
            } else {
                URL url = new URL(source);
                HttpURLConnection connection = (HttpURLConnection) url.openConnection();
                connection.setConnectTimeout(20000);
                connection.setReadTimeout(30000);
                connection.setInstanceFollowRedirects(true);
                connection.connect();
                try (InputStream in = connection.getInputStream();
                     ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[16384];
                    int count;
                    while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
                    bytes = out.toByteArray();
                } finally {
                    connection.disconnect();
                }
            }
            if (bytes.length == 0) throw new Exception("empty media");
            String name = (filename == null || filename.trim().isEmpty())
                ? "babylon-media-" + System.currentTimeMillis() : filename.replaceAll("[\\\\/]", "_");
            String mime = (mimeType == null || mimeType.isEmpty()) ? "application/octet-stream" : mimeType;

            if (Build.VERSION.SDK_INT >= 29) {
                boolean video = mime.startsWith("video/");
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                values.put(MediaStore.MediaColumns.RELATIVE_PATH,
                    (video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES) + "/Babylon Chat");
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                Uri collection = video
                    ? MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                    : MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                Uri item = getContentResolver().insert(collection, values);
                if (item == null) throw new Exception("MediaStore insert failed");
                try (java.io.OutputStream out = getContentResolver().openOutputStream(item)) {
                    if (out == null) throw new Exception("cannot open output");
                    out.write(bytes);
                }
                ContentValues done = new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                getContentResolver().update(item, done, null, null);
            } else {
                if (Build.VERSION.SDK_INT >= 23 &&
                    checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                    runOnUiThread(() -> Toast.makeText(this, "اسمح بصلاحية التخزين ثم أعد التنزيل", Toast.LENGTH_LONG).show());
                    return;
                }
                boolean video = mime.startsWith("video/");
                File dir = new File(Environment.getExternalStoragePublicDirectory(
                    video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES), "Babylon Chat");
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("cannot create directory");
                File file = new File(dir, name);
                try (FileOutputStream out = new FileOutputStream(file)) { out.write(bytes); }
                android.media.MediaScannerConnection.scanFile(this, new String[]{file.getAbsolutePath()}, new String[]{mime}, null);
            }
            runOnUiThread(() -> Toast.makeText(this, "تم تحميل الصورة او الفيديو في المعرض", Toast.LENGTH_LONG).show());
        } catch (Exception e) {
            runOnUiThread(() -> Toast.makeText(this, "تعذر تنزيل الصورة أو الفيديو", Toast.LENGTH_LONG).show());
        }
    }
}
""" % pkg.group(1))
print("MainActivity patched:", ma)

# 2.65) إشعارات الرسائل: صورة المرسل + أزرار (رد) و(اعتبارها مقروءة)
NOTIF_PKG = pkg.group(1)
NOTIF_JAVA = r"""package __PKG__;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.os.Build;
import android.util.Base64;
import android.webkit.WebView;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;
import androidx.core.graphics.drawable.IconCompat;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/** إشعارات الرسائل: صورة المرسل + أزرار (رد) و(اعتبارها مقروءة). */
public class BabylonNotifications {
    static final String CHANNEL_ID = "messages";
    static final String ACTION_REPLY = "__PKG__.NOTIF_REPLY";
    static final String ACTION_READ = "__PKG__.NOTIF_READ";
    static final String KEY_TEXT = "babylon_reply_text";
    private static final String PREFS = "babylon_notif";
    private static final String PENDING = "pending";
    private static final int MAX_MSGS = 8;
    static final String ME_ID = "__me__";

    private static final ExecutorService exec = Executors.newSingleThreadExecutor();
    private static final Map<String, Chat> chats = new HashMap<>();
    private static final Map<String, Long> dispatched = new HashMap<>();

    private static class Msg {
        final String text; final long time; final boolean mine;
        Msg(String text, long time, boolean mine) { this.text = text; this.time = time; this.mine = mine; }
    }

    private static class Chat {
        String chatId = "", otherId = "", title = "";
        Bitmap avatar;
        final List<Msg> msgs = new ArrayList<>();
    }

    // ---------- عرض الإشعار ----------

    public static void show(final Context ctx, final String title, final String body,
                            final String avatarSrc, final String otherId, final String chatId) {
        exec.execute(() -> render(ctx, title, body, avatarSrc, otherId, chatId, false));
    }

    /** للتطبيق المغلق: تُنفَّذ على خيط FCM نفسه، فيظهر الإشعار فوراً قبل أن تُجمَّد العملية. */
    public static void showNow(Context ctx, String title, String body,
                               String avatarSrc, String otherId, String chatId) {
        render(ctx, title, body, avatarSrc, otherId, chatId, true);
    }

    private static void render(final Context ctx, final String title, final String body,
                               final String avatarSrc, final String otherId, final String chatId,
                               final boolean fast) {
        {
            try {
                Bitmap raw;
                if (fast) {
                    raw = readAvatar(ctx, otherId); // من القرص فقط: بدون انتظار الشبكة
                } else {
                    raw = loadBitmap(avatarSrc);
                    if (raw != null) saveAvatar(ctx, otherId, raw); else raw = readAvatar(ctx, otherId);
                }
                Bitmap av = circle(raw);
                final boolean placeholder = (av == null);
                if (av == null) av = letterAvatar(title);
                String key = (chatId != null && !chatId.isEmpty()) ? chatId : ("t:" + title);
                synchronized (chats) {
                    Chat c = chats.get(key);
                    if (c == null) { c = new Chat(); chats.put(key, c); }
                    // منع تكرار نفس الرسالة (إشعار الخادم + إشعار الصفحة)
                    if (!c.msgs.isEmpty()) {
                        Msg last = c.msgs.get(c.msgs.size() - 1);
                        if (!last.mine && last.text.equals(body == null ? "" : body)
                            && System.currentTimeMillis() - last.time < 10000) return;
                    }
                    c.chatId = chatId == null ? "" : chatId;
                    c.otherId = otherId == null ? "" : otherId;
                    c.title = title == null ? "" : title;
                    c.avatar = av;
                    c.msgs.add(new Msg(body == null ? "" : body, System.currentTimeMillis(), false));
                    while (c.msgs.size() > MAX_MSGS) c.msgs.remove(0);
                    post(ctx, key, c, false);
                }
                // الإشعار ظهر الآن. إذا ما عندنا صورة محفوظة نحاول تحميلها بمهلة قصيرة ونحدّث الإشعار بصمت.
                if (fast && placeholder && avatarSrc != null && (avatarSrc.startsWith("http") || avatarSrc.startsWith("data:"))) {
                    Bitmap net = loadBitmap(avatarSrc, 3000, 4000);
                    if (net != null) {
                        saveAvatar(ctx, otherId, net);
                        synchronized (chats) {
                            Chat c2 = chats.get(key);
                            if (c2 != null) { c2.avatar = circle(net); post(ctx, key, c2, true); }
                        }
                    }
                }
            } catch (Throwable t) {
                android.util.Log.e("BabylonNotif", "show failed", t);
            }
        }
    }

    private static void post(Context ctx, String key, Chat c, boolean quiet) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ctx.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) return;
        ensureChannel(ctx);
        int id = key.hashCode();

        // صورتي أنا (تُحفظ تحت المعرّف __me__) حتى تظهر مع ردّي بدل صورة الطرف الآخر.
        Person.Builder mb = new Person.Builder().setName("أنت").setKey("__me__");
        Bitmap myRaw = readAvatar(ctx, ME_ID);
        Bitmap myAv = circle(myRaw);
        if (myAv == null) myAv = letterAvatar("أنا");
        mb.setIcon(IconCompat.createWithBitmap(myAv));
        Person me = mb.build();
        Person.Builder pb = new Person.Builder().setName(c.title);
        if (!c.otherId.isEmpty()) pb.setKey(c.otherId);
        if (c.avatar != null) pb.setIcon(IconCompat.createWithBitmap(c.avatar));
        Person other = pb.build();

        NotificationCompat.MessagingStyle style = new NotificationCompat.MessagingStyle(me);
        for (Msg m : c.msgs) style.addMessage(m.text, m.time, m.mine ? me : other);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(smallIcon(ctx))
            .setColor(Color.parseColor("#C9961F"))
            .setStyle(style)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setOnlyAlertOnce(quiet)
            .setShowWhen(true)
            .setWhen(System.currentTimeMillis());
        if (c.avatar != null) b.setLargeIcon(c.avatar);

        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (open != null) {
            open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            b.setContentIntent(PendingIntent.getActivity(ctx, id, open,
                PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag()));
        }

        if (!c.chatId.isEmpty()) {
            // زر (رد): إدخال نص مباشرة من الإشعار
            Intent replyIntent = new Intent(ctx, BabylonNotificationReceiver.class)
                .setAction(ACTION_REPLY)
                .putExtra("chatId", c.chatId)
                .putExtra("otherId", c.otherId);
            PendingIntent replyPi = PendingIntent.getBroadcast(ctx, id + 1, replyIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | mutableFlag());
            RemoteInput remote = new RemoteInput.Builder(KEY_TEXT).setLabel("رد").build();
            b.addAction(new NotificationCompat.Action.Builder(0, "رد", replyPi)
                .addRemoteInput(remote)
                .setAllowGeneratedReplies(true)
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
                .setShowsUserInterface(false)
                .build());

            // زر (اعتبارها مقروءة)
            Intent readIntent = new Intent(ctx, BabylonNotificationReceiver.class)
                .setAction(ACTION_READ)
                .putExtra("chatId", c.chatId)
                .putExtra("otherId", c.otherId);
            PendingIntent readPi = PendingIntent.getBroadcast(ctx, id + 2, readIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag());
            b.addAction(new NotificationCompat.Action.Builder(0, "اعتبارها مقروءة", readPi)
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
                .setShowsUserInterface(false)
                .build());
        }

        try {
            NotificationManagerCompat.from(ctx).notify(id, b.build());
        } catch (SecurityException e) {
            android.util.Log.w("BabylonNotif", "notify denied", e);
        }
    }

    // ---------- تخزين صور المرسلين (لإشعارات التطبيق المغلق) ----------

    /** تحفظ صورة المستخدم محلياً ليستعملها الإشعار حتى لو كان التطبيق مغلقاً. */
    public static void cacheAvatar(final Context ctx, final String otherId, final String src) {
        exec.execute(() -> {
            Bitmap b = loadBitmap(src);
            if (b != null) saveAvatar(ctx, otherId, b);
        });
    }

    /** تحفظ صورتي أنا (المستلم) لتُستعمل مع الردود من الإشعار. تُحمَّل فقط إذا تغيّر الرابط. */
    public static void cacheMyAvatar(final Context ctx, final String src) {
        if (src == null || !src.startsWith("http")) return;
        exec.execute(() -> {
            try {
                java.io.File f = avatarFile(ctx, ME_ID);
                if (f != null && f.exists() && src.equals(prefs(ctx).getString("me_src", ""))) return;
                Bitmap b = loadBitmap(src);
                if (b != null) {
                    saveAvatar(ctx, ME_ID, b);
                    prefs(ctx).edit().putString("me_src", src).apply();
                }
            } catch (Throwable ignored) { }
        });
    }

    private static java.io.File avatarFile(Context ctx, String otherId) {
        if (otherId == null || otherId.isEmpty()) return null;
        java.io.File dir = new java.io.File(ctx.getFilesDir(), "notif_avatars");
        if (!dir.exists()) dir.mkdirs();
        return new java.io.File(dir, otherId.replaceAll("[^A-Za-z0-9_-]", "_") + ".jpg");
    }

    private static void saveAvatar(Context ctx, String otherId, Bitmap b) {
        try {
            java.io.File f = avatarFile(ctx, otherId);
            if (f == null) return;
            try (java.io.FileOutputStream out = new java.io.FileOutputStream(f)) {
                b.compress(Bitmap.CompressFormat.JPEG, 90, out);
            }
        } catch (Throwable ignored) { }
    }

    private static Bitmap readAvatar(Context ctx, String otherId) {
        try {
            java.io.File f = avatarFile(ctx, otherId);
            return (f != null && f.exists()) ? BitmapFactory.decodeFile(f.getAbsolutePath()) : null;
        } catch (Throwable t) { return null; }
    }

    // ---------- ردود أزرار الإشعار ----------

    static void onReply(Context ctx, String chatId, String otherId, String text) {
        synchronized (chats) {
            Chat c = chats.get(chatId);
            if (c != null) {
                c.msgs.add(new Msg(text, System.currentTimeMillis(), true));
                while (c.msgs.size() > MAX_MSGS) c.msgs.remove(0);
                post(ctx, chatId, c, true); // يحدّث الإشعار ويوقف مؤشر التحميل
            } else {
                NotificationManagerCompat.from(ctx).cancel(chatId.hashCode());
            }
        }
        enqueue(ctx, "reply", otherId, chatId, text);
    }

    static void onRead(Context ctx, String chatId, String otherId) {
        synchronized (chats) { chats.remove(chatId); }
        NotificationManagerCompat.from(ctx).cancel(chatId.hashCode());
        enqueue(ctx, "read", otherId, chatId, "");
    }

    // ---------- طابور الأوامر المنتظرة للصفحة ----------

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static synchronized JSONArray loadPending(Context ctx) {
        try { return new JSONArray(prefs(ctx).getString(PENDING, "[]")); }
        catch (Exception e) { return new JSONArray(); }
    }

    private static synchronized void enqueue(Context ctx, String action, String otherId, String chatId, String text) {
        try {
            JSONArray arr = loadPending(ctx);
            JSONObject o = new JSONObject();
            o.put("id", UUID.randomUUID().toString());
            o.put("action", action);
            o.put("otherId", otherId == null ? "" : otherId);
            o.put("chatId", chatId == null ? "" : chatId);
            o.put("text", text == null ? "" : text);
            o.put("time", System.currentTimeMillis());
            arr.put(o);
            prefs(ctx).edit().putString(PENDING, arr.toString()).apply();
        } catch (Exception e) {
            android.util.Log.e("BabylonNotif", "enqueue failed", e);
        }
        dispatchPending(ctx, MainActivity.liveWebView);
    }

    /** تستدعيها الصفحة بعد استلام الأمر حتى يُحذف من الطابور. */
    public static synchronized void ack(Context ctx, String id) {
        try {
            JSONArray arr = loadPending(ctx), out = new JSONArray();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                if (!id.equals(o.optString("id"))) out.put(o);
            }
            prefs(ctx).edit().putString(PENDING, out.toString()).apply();
            dispatched.remove(id);
        } catch (Exception ignored) { }
    }

    /** تُرسل الأوامر المنتظرة إلى الصفحة (يجب استدعاؤها من الخيط الرئيسي). */
    public static synchronized void dispatchPending(Context ctx, WebView wv) {
        if (wv == null) return;
        try {
            JSONArray arr = loadPending(ctx);
            long now = System.currentTimeMillis();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                String id = o.optString("id");
                if (now - o.optLong("time", now) > 24L * 3600 * 1000) { ack(ctx, id); continue; }
                Long last = dispatched.get(id);
                if (last != null && now - last < 10000) continue;
                dispatched.put(id, now);
                String js = "try{var B=window.BabylonAndroid;if(B&&B.runNativeNotifAction)B.runNativeNotifAction("
                    + JSONObject.quote(id) + "," + JSONObject.quote(o.optString("action")) + ","
                    + JSONObject.quote(o.optString("otherId")) + "," + JSONObject.quote(o.optString("chatId")) + ","
                    + JSONObject.quote(o.optString("text")) + ");}catch(e){}";
                wv.evaluateJavascript(js, null);
            }
        } catch (Exception e) {
            android.util.Log.e("BabylonNotif", "dispatch failed", e);
        }
    }

    // ---------- مساعدات ----------

    private static int immutableFlag() { return Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0; }
    private static int mutableFlag() { return Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0; }

    private static int smallIcon(Context ctx) {
        int r = ctx.getResources().getIdentifier("ic_stat_notify", "drawable", ctx.getPackageName());
        return r != 0 ? r : ctx.getApplicationInfo().icon;
    }

    private static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "الرسائل", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("إشعارات الرسائل الجديدة");
        ch.enableVibration(true);
        nm.createNotificationChannel(ch);
    }

    private static Bitmap loadBitmap(String src) { return loadBitmap(src, 10000, 15000); }

    private static Bitmap loadBitmap(String src, int connectMs, int readMs) {
        if (src == null || src.isEmpty()) return null;
        try {
            byte[] bytes;
            if (src.startsWith("data:")) {
                int comma = src.indexOf(',');
                if (comma < 0 || !src.substring(0, comma).contains(";base64")) return null;
                bytes = Base64.decode(src.substring(comma + 1), Base64.DEFAULT);
            } else if (src.startsWith("http")) {
                HttpURLConnection con = (HttpURLConnection) new URL(src).openConnection();
                con.setConnectTimeout(connectMs);
                con.setReadTimeout(readMs);
                con.setInstanceFollowRedirects(true);
                try (InputStream in = con.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                    bytes = out.toByteArray();
                } finally {
                    con.disconnect();
                }
            } else {
                return null;
            }
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (Throwable t) {
            return null;
        }
    }

    /** قصّ الصورة على شكل دائرة. */
    private static Bitmap circle(Bitmap src) {
        if (src == null) return null;
        int w = src.getWidth(), h = src.getHeight(), s = Math.min(w, h);
        Bitmap out = Bitmap.createBitmap(s, s, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(out);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        cv.drawCircle(s / 2f, s / 2f, s / 2f, p);
        p.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.SRC_IN));
        Rect from = new Rect((w - s) / 2, (h - s) / 2, (w - s) / 2 + s, (h - s) / 2 + s);
        cv.drawBitmap(src, from, new Rect(0, 0, s, s), p);
        return out;
    }

    /** إذا ما عنده صورة: دائرة ذهبية فيها أول حرف من اسمه. */
    private static Bitmap letterAvatar(String name) {
        int size = 192;
        Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(out);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(Color.parseColor("#C9961F"));
        cv.drawCircle(size / 2f, size / 2f, size / 2f, p);
        String letter = "؟";
        if (name != null && !name.trim().isEmpty()) {
            String t = name.trim();
            letter = new String(Character.toChars(t.codePointAt(0)));
        }
        p.setColor(Color.WHITE);
        p.setTextAlign(Paint.Align.CENTER);
        p.setTypeface(Typeface.DEFAULT_BOLD);
        p.setTextSize(size * 0.5f);
        float y = size / 2f - (p.descent() + p.ascent()) / 2f;
        cv.drawText(letter, size / 2f, y, p);
        return out;
    }
}
"""
NOTIF_RECEIVER = r"""package __PKG__;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import androidx.core.app.RemoteInput;

/** يستقبل ضغطات زر (رد) و(اعتبارها مقروءة) من الإشعار. */
public class BabylonNotificationReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String chatId = intent.getStringExtra("chatId");
        String otherId = intent.getStringExtra("otherId");
        if (chatId == null || chatId.isEmpty()) return;

        if (BabylonNotifications.ACTION_REPLY.equals(intent.getAction())) {
            Bundle results = RemoteInput.getResultsFromIntent(intent);
            CharSequence text = results == null ? null : results.getCharSequence(BabylonNotifications.KEY_TEXT);
            if (text == null || text.toString().trim().isEmpty()) return;
            BabylonNotifications.onReply(ctx.getApplicationContext(), chatId, otherId, text.toString().trim());
        } else if (BabylonNotifications.ACTION_READ.equals(intent.getAction())) {
            BabylonNotifications.onRead(ctx.getApplicationContext(), chatId, otherId);
        }
    }
}
"""
wr(ma.parent / "BabylonNotifications.java", NOTIF_JAVA.replace("__PKG__", NOTIF_PKG))
wr(ma.parent / "BabylonNotificationReceiver.java", NOTIF_RECEIVER.replace("__PKG__", NOTIF_PKG))
print("notification helpers written:", ma.parent)
m2 = rd(mf)
if "BabylonNotificationReceiver" not in m2:
    if "</application>" not in m2: die("ما لقيت application", mf)
    m2 = m2.replace("</application>", '        <receiver android:name="%s.BabylonNotificationReceiver" android:exported="false" />\n    </application>' % NOTIF_PKG)
    wr(mf, m2)
    print("notification receiver registered in manifest")

# 2.67) تحديث التطبيق بضغطة وحدة: مزوّد ملفات يسمح لمثبّت أندرويد بقراءة الـ APK من كاش التطبيق
wr(ma.parent / "BabylonUpdateProvider.java",
   "package %s;\n\nimport androidx.core.content.FileProvider;\n\npublic class BabylonUpdateProvider extends FileProvider {}\n" % NOTIF_PKG)
(res / "xml").mkdir(parents=True, exist_ok=True)
wr(res / "xml" / "babylon_update_paths.xml",
   '<?xml version="1.0" encoding="utf-8"?>\n<paths>\n    <cache-path name="updates" path="updates/" />\n</paths>\n')
m3 = rd(mf)
if "BabylonUpdateProvider" not in m3:
    prov = ('        <provider android:name="%s.BabylonUpdateProvider" android:authorities="${applicationId}.updates" android:exported="false" android:grantUriPermissions="true">\n'
            '            <meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/babylon_update_paths" />\n'
            '        </provider>\n') % NOTIF_PKG
    if "</application>" not in m3: die("ما لقيت application", mf)
    wr(mf, m3.replace("</application>", prov + "    </application>"))
    print("update provider registered in manifest")

# 2.68) مكالمات صوتية واردة أصلية: إشعار بملء الشاشة + رنين والتطبيق مغلق
CALL_JAVA = r"""package __PKG__;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.view.WindowManager;
import android.os.PowerManager;
import java.lang.ref.WeakReference;
import android.webkit.JavascriptInterface;
import androidx.core.app.NotificationCompat;

/** مكالمة صوتية واردة: إشعار بملء الشاشة + رنين متواصل (يعمل والتطبيق مغلق). */
public class BabylonCall {
    static final String CHANNEL = "babylon_calls";
    static final int NOTIF_ID = 77001;
    static final String X_ID = "bb_call_id";
    static final String X_ACCEPT = "bb_call_accept";
    private static String pendingId = "";
    private static String pendingMode = "";
    static volatile boolean active = false;          // مكالمة جارية الآن
    static WeakReference<Activity> actRef = null;
    private static PowerManager.WakeLock proxLock = null;

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "المكالمات", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("مكالمات صوتية واردة");
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[]{0, 700, 400, 700, 400, 700});
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        AudioAttributes aa = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
        ch.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), aa);
        nm.createNotificationChannel(ch);
    }

    public static void show(Context ctx, String title, String callId, String chatId) {
        if (active) return;   // أنت بمكالمة: الصفحة ترسل "مشغول" للمتصل
        try {
            ensureChannel(ctx);
            Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
            if (open == null) return;
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            open.putExtra(X_ID, callId == null ? "" : callId);
            open.putExtra(X_ACCEPT, false);
            Intent acc = new Intent(open);
            acc.putExtra(X_ACCEPT, true);
            int imm = Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0;
            PendingIntent full = PendingIntent.getActivity(ctx, 7701, open, PendingIntent.FLAG_UPDATE_CURRENT | imm);
            PendingIntent ans = PendingIntent.getActivity(ctx, 7702, acc, PendingIntent.FLAG_UPDATE_CURRENT | imm);
            Intent dec = new Intent(ctx, BabylonCallReceiver.class);
            dec.setAction("__PKG__.CALL_DECLINE");
            dec.putExtra(X_ID, callId == null ? "" : callId);
            PendingIntent decPi = PendingIntent.getBroadcast(ctx, 7703, dec, PendingIntent.FLAG_UPDATE_CURRENT | imm);

            int icon = ctx.getResources().getIdentifier("ic_stat_notify", "drawable", ctx.getPackageName());
            if (icon == 0) icon = android.R.drawable.sym_call_incoming;
            String t = (title == null || title.isEmpty()) ? "مكالمة واردة" : title;
            NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(icon)
                .setContentTitle(t)
                .setContentText("مكالمة صوتية واردة")
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setColor(Color.parseColor("#C9961F"))
                .setOngoing(true)
                .setAutoCancel(true)
                .setTimeoutAfter(45000)
                .setFullScreenIntent(full, true)
                .setContentIntent(full)
                .addAction(0, "رفض", decPi)
                .addAction(0, "رد", ans);
            if (Build.VERSION.SDK_INT < 26) {
                Uri ring = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                b.setSound(ring);
                b.setVibrate(new long[]{0, 700, 400, 700, 400, 700});
            }
            Notification n = b.build();
            n.flags |= Notification.FLAG_INSISTENT;   // رنين متكرر لين الرد أو انتهاء المهلة
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIF_ID, n);
        } catch (Throwable t) {
            android.util.Log.e("BabylonCall", "show failed", t);
        }
    }

    public static void cancel(Context ctx) {
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(NOTIF_ID);
        } catch (Throwable ignored) { }
    }

    /** تُستدعى من MainActivity عند فتحها من إشعار المكالمة. */
    static void onIntent(Activity a, Intent i) {
        try {
            actRef = new WeakReference<Activity>(a);
            if (i == null || !i.hasExtra(X_ID)) return;
            String id = i.getStringExtra(X_ID);
            boolean acc = i.getBooleanExtra(X_ACCEPT, false);
            pendingId = id == null ? "" : id;
            pendingMode = acc ? "accept" : "show";
            i.removeExtra(X_ID);
            i.removeExtra(X_ACCEPT);
            if (Build.VERSION.SDK_INT >= 27) {
                a.setShowWhenLocked(true);
                a.setTurnScreenOn(true);
            } else {
                a.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                    | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
            }
            cancel(a.getApplicationContext());
        } catch (Throwable ignored) { }
    }

    /** جسر للصفحة: استلام المكالمة المعلّقة + التحكم بالسماعة. */
    public static class Bridge {
        private final Context ctx;
        public Bridge(Context c) { ctx = c; }

        @JavascriptInterface
        public String takePending() {
            String r = pendingId.isEmpty() ? "" : (pendingId + "|" + pendingMode);
            pendingId = "";
            pendingMode = "";
            return r;
        }

        @JavascriptInterface
        public void setSpeaker(boolean on) {
            try {
                AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
                if (am == null) return;
                am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                am.setSpeakerphoneOn(on);
            } catch (Throwable ignored) { }
        }

        @JavascriptInterface
        public void startService(String name) {
            try {
                active = true;
                Intent i = new Intent(ctx, BabylonCallService.class);
                i.putExtra("name", name == null ? "" : name);
                if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i); else ctx.startService(i);
            } catch (Throwable t) { android.util.Log.e("BabylonCall", "startService failed", t); }
        }

        @JavascriptInterface
        public void stopService() {
            try {
                active = false;
                ctx.stopService(new Intent(ctx, BabylonCallService.class));
            } catch (Throwable ignored) { }
        }

        @JavascriptInterface
        public void keepScreenOn(final boolean on) {
            try {
                final Activity a = actRef == null ? null : actRef.get();
                if (a == null) return;
                a.runOnUiThread(new Runnable() {
                    public void run() {
                        if (on) a.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                        else a.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    }
                });
            } catch (Throwable ignored) { }
        }

        @JavascriptInterface
        public void setProximity(boolean on) {
            try {
                PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
                if (on) {
                    if (proxLock == null && pm != null && pm.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) {
                        proxLock = pm.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "babylon:prox");
                        proxLock.setReferenceCounted(false);
                    }
                    if (proxLock != null && !proxLock.isHeld()) proxLock.acquire(4L * 3600 * 1000);
                } else if (proxLock != null && proxLock.isHeld()) {
                    proxLock.release();
                }
            } catch (Throwable ignored) { }
        }

        @JavascriptInterface
        public void resetAudio() {
            try {
                AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
                if (am == null) return;
                am.setSpeakerphoneOn(false);
                am.setMode(AudioManager.MODE_NORMAL);
            } catch (Throwable ignored) { }
        }
    }
}
"""
CALL_RECV = r"""package __PKG__;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.webkit.WebView;

/** زر (رفض) بإشعار المكالمة. */
public class BabylonCallReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent i) {
        try {
            final String id = i.getStringExtra("bb_call_id");
            BabylonCall.cancel(ctx);
            final WebView wv = MainActivity.liveWebView;
            if (wv != null && id != null && !id.isEmpty()) {
                final String js = "try{window.BabylonCalls&&window.BabylonCalls.decline(" + org.json.JSONObject.quote(id) + ")}catch(e){}";
                wv.post(new Runnable() { public void run() { wv.evaluateJavascript(js, null); } });
            }
        } catch (Throwable ignored) { }
    }
}
"""
wr(ma.parent / "BabylonCall.java", CALL_JAVA.replace("__PKG__", NOTIF_PKG))
wr(ma.parent / "BabylonCallReceiver.java", CALL_RECV.replace("__PKG__", NOTIF_PKG))
CALL_SERVICE = r"""package __PKG__;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;

/** خدمة أمامية: تبقي المايك والمكالمة شغالين لو خرجت من التطبيق أثناء المكالمة. */
public class BabylonCallService extends Service {
    static final String CH = "babylon_call_ongoing";
    static final int ID = 77002;
    private PowerManager.WakeLock wl;

    @Override
    public IBinder onBind(Intent i) { return null; }

    @Override
    public int onStartCommand(Intent i, int flags, int startId) {
        try {
            String name = i == null ? "" : i.getStringExtra("name");
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null && nm.getNotificationChannel(CH) == null) {
                    NotificationChannel ch = new NotificationChannel(CH, "المكالمة الجارية", NotificationManager.IMPORTANCE_LOW);
                    ch.setSound(null, null);
                    nm.createNotificationChannel(ch);
                }
            }
            Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
            PendingIntent pi = null;
            if (open != null) {
                open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                pi = PendingIntent.getActivity(this, 7704, open,
                    PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
            }
            int icon = getResources().getIdentifier("ic_stat_notify", "drawable", getPackageName());
            if (icon == 0) icon = android.R.drawable.sym_action_call;
            NotificationCompat.Builder b = new NotificationCompat.Builder(this, CH)
                .setSmallIcon(icon)
                .setContentTitle("مكالمة جارية")
                .setContentText(name == null ? "" : name)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setColor(Color.parseColor("#C9961F"))
                .setOngoing(true)
                .setUsesChronometer(true)
                .setShowWhen(true)
                .setWhen(System.currentTimeMillis());
            if (pi != null) b.setContentIntent(pi);
            Notification n = b.build();
            if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            else startForeground(ID, n);
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null && wl == null) {
                wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "babylon:call");
                wl.setReferenceCounted(false);
                wl.acquire(4L * 3600 * 1000);
            }
        } catch (Throwable t) {
            android.util.Log.e("BabylonCall", "service start failed", t);
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        try { if (wl != null && wl.isHeld()) wl.release(); } catch (Throwable ignored) { }
        wl = null;
        super.onDestroy();
    }
}
"""
wr(ma.parent / "BabylonCallService.java", CALL_SERVICE.replace("__PKG__", NOTIF_PKG))
mfc = rd(mf)
if "USE_FULL_SCREEN_INTENT" not in mfc:
    mfc = mfc.replace("</manifest>", '    <uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />\n</manifest>')
for _perm in ["FOREGROUND_SERVICE", "FOREGROUND_SERVICE_MICROPHONE", "WAKE_LOCK"]:
    if 'android.permission.%s"' % _perm not in mfc:
        mfc = mfc.replace("</manifest>", '    <uses-permission android:name="android.permission.%s" />\n</manifest>' % _perm)
if "BabylonCallService" not in mfc:
    mfc = mfc.replace("</application>", '        <service android:name="%s.BabylonCallService" android:exported="false" android:foregroundServiceType="microphone" />\n    </application>' % NOTIF_PKG)
if "BabylonCallReceiver" not in mfc:
    mfc = mfc.replace("</application>", '        <receiver android:name="%s.BabylonCallReceiver" android:exported="false" />\n    </application>' % NOTIF_PKG)
wr(mf, mfc)
print("BabylonCall registered (incoming call full-screen notification)")

# 2.66) خدمة FCM الأصلية: تعرض إشعار الرسالة (صورة + أزرار) والتطبيق مغلق
NOTIF_SERVICE = r"""package __PKG__;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/** يعرض إشعار الرسالة (صورة + رد + مقروءة) حتى لو كان التطبيق مغلقاً. */
public class BabylonMessagingService extends MessagingService {
    /** التطبيق ظاهر أمام المستخدم: الصفحة تتولى التنبيه، فلا نعرض إشعاراً هنا. */
    private boolean appInForeground() {
        try {
            android.app.ActivityManager am = (android.app.ActivityManager) getSystemService(ACTIVITY_SERVICE);
            if (am == null) return false;
            for (android.app.ActivityManager.RunningAppProcessInfo p : am.getRunningAppProcesses()) {
                if (p.pid == android.os.Process.myPid()) {
                    return p.importance == android.app.ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND;
                }
            }
        } catch (Throwable ignored) { }
        return false;
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        try {
            Map<String, String> d = message.getData();
            if (d != null && "call".equals(d.get("type"))) {
                if (!appInForeground()) BabylonCall.show(getApplicationContext(), d.get("title"), d.get("callId"), d.get("chatId"));
            } else if (d != null && "call_end".equals(d.get("type"))) {
                BabylonCall.cancel(getApplicationContext());
            } else if (d != null && "msg".equals(d.get("type")) && !appInForeground()) {
                BabylonNotifications.cacheMyAvatar(getApplicationContext(), d.get("meAvatar"));
                BabylonNotifications.showNow(getApplicationContext(), d.get("title"), d.get("body"),
                    d.get("avatar"), d.get("senderId"), d.get("chatId"));
            }
        } catch (Throwable t) {
            android.util.Log.e("BabylonNotif", "onMessageReceived failed", t);
        }
        super.onMessageReceived(message);
    }
}
"""
plug_dir = root / "node_modules" / "@capacitor" / "push-notifications"
plug_svc = next(plug_dir.rglob("MessagingService.java"), None) if plug_dir.exists() else None
if plug_svc and "public class MessagingService" in rd(plug_svc):
    wr(ma.parent / "BabylonMessagingService.java", NOTIF_SERVICE.replace("__PKG__", NOTIF_PKG))
    m3 = rd(mf)
    if "BabylonMessagingService" not in m3:
        if "xmlns:tools" not in m3:
            m3 = re.sub(r"<manifest\b", '<manifest xmlns:tools="http://schemas.android.com/tools"', m3, count=1)
        svc = ('        <service android:name="%s.BabylonMessagingService" android:exported="false">\n'
               '            <intent-filter><action android:name="com.google.firebase.MESSAGING_EVENT" /></intent-filter>\n'
               '        </service>\n'
               '        <service android:name="com.capacitorjs.plugins.pushnotifications.MessagingService" tools:node="remove" />\n'
               '    </application>') % NOTIF_PKG
        m3 = m3.replace("</application>", svc)
        wr(mf, m3)
    bg0 = app / "build.gradle"
    g0 = rd(bg0)
    if "firebase-messaging" not in g0:
        g0, nd = re.subn(r"(\ndependencies\s*\{)", r"\1\n    implementation 'com.google.firebase:firebase-messaging:23.4.1'", g0, count=1)
        if nd == 1: wr(bg0, g0)
        else: print("::warning::ما لقيت dependencies في build.gradle — أضف firebase-messaging يدوياً")
    print("BabylonMessagingService registered (closed-app notifications)")
else:
    print("::warning::ما لقيت MessagingService الخاص بـ @capacitor/push-notifications — إشعارات التطبيق المغلق بدون صورة/أزرار")

# 2.7) ربط حفظ الصور والفيديوهات من index.html بجسر أندرويد الأصلي
# نعدّل كل النسخ الممكنة من index.html، بما فيها النسخة المنسوخة داخل assets (هي التي تُشحن فعلاً).
SAVE_SIG = "saveMedia: function (source, filename, mimeType)"
SAVE_JS = """
     saveMedia: function (source, filename, mimeType) {
       var nativeBridge = window.BabylonAndroidNative;
       if (!nativeBridge || typeof nativeBridge.saveMedia !== 'function') {
         throw new Error('Android media bridge unavailable');
       }
       nativeBridge.saveMedia(String(source || ''), String(filename || ''), String(mimeType || 'application/octet-stream'));
     },"""
marker = "window.BabylonAndroid = {"
candidates = [
    root / "index.html",
    root / "www" / "index.html",
    root / "dist" / "index.html",
    root / "public" / "index.html",
    app / "src" / "main" / "assets" / "public" / "index.html",
]
ok_count = 0
for html_file in candidates:
    if not html_file.exists():
        continue
    hs = rd(html_file)
    if SAVE_SIG in hs:
        ok_count += 1
        print("index.html already has saveMedia:", html_file)
    elif marker in hs:
        wr(html_file, hs.replace(marker, marker + SAVE_JS, 1))
        ok_count += 1
        print("index.html patched: native gallery downloads enabled:", html_file)
    else:
        print("::warning::لم أجد BabylonAndroid في", html_file)
if ok_count == 0:
    print("::error::لم يتم ربط زر التنزيل بالجسر الأصلي — لا توجد نسخة index.html صالحة")

# 2.8) ربط إشعارات الرسائل (الصورة + أزرار رد/مقروءة) في index.html بالجسر الأصلي
NOTIF_SIG = "showMessageNotificationEx: function"
NOTIF_JS = """
     cacheAvatar: function (otherId, src) {
       var nb = window.BabylonAndroidNative;
       if (nb && typeof nb.cacheAvatar === 'function') nb.cacheAvatar(String(otherId || ''), String(src || ''));
     },
     showMessageNotificationEx: function (title, body, avatar, otherId, chatId) {
       var nb = window.BabylonAndroidNative;
       if (!nb || typeof nb.showMessageNotificationEx !== 'function') return;
       nb.showMessageNotificationEx(String(title || ''), String(body || ''), String(avatar || ''), String(otherId || ''), String(chatId || ''));
     },
     showMessageNotification: function (title, body, avatar) {
       window.BabylonAndroid.showMessageNotificationEx(title, body, avatar, '', '');
     },
     runNativeNotifAction: function (id, action, otherId, chatId, text) {
       try {
         if (typeof currentUser === 'undefined' || !currentUser || typeof window.onNativeNotificationAction !== 'function') return false;
         try { window.BabylonAndroidNative.ackAction(String(id)); } catch (e0) {}
         window.onNativeNotificationAction(action, otherId, chatId, text);
         return true;
       } catch (e) { return false; }
     },"""
FLUSH_SIG = "n.flushPending"
FLUSH_JS = """
  setInterval(function () { try { var n = window.BabylonAndroidNative; if (n && typeof n.flushPending === 'function') n.flushPending(); } catch (e) {} }, 5000);"""
FLUSH_ANCHOR = "setInterval(saveToken, 4000);"
AV_SIG = "__nAvCached"
ME_SIG = "__nMeCached"
AV_ANCHOR = """                // إشعار نظام واحد فقط للرسالة الواردة الجديدة"""
AV_JS = """                // حفظ صورة المرسل محلياً في أندرويد لتظهر في إشعارات التطبيق المغلق.
                try { var __nb = window.BabylonAndroid; if (__nb && typeof __nb.cacheAvatar === 'function') { window.__nAvCached = window.__nAvCached || {}; var __av = pvUrl(u) || ''; if (__av && window.__nAvCached[otherId] !== __av.length) { window.__nAvCached[otherId] = __av.length; notifAvatarThumb(__av, otherId, function (th) { try { if (th) __nb.cacheAvatar(otherId, th); } catch (e) {} }); } } } catch (e) {}
"""
ME_JS = """                // حفظ صورتي أنا محلياً لتظهر مع ردّي من الإشعار.
                try { var __nbm = window.BabylonAndroid; if (__nbm && typeof __nbm.cacheAvatar === 'function' && typeof currentUser !== 'undefined' && currentUser) { var __me = (typeof pvUrl === 'function' ? pvUrl(currentUser) : '') || ''; window.__nMeCached = window.__nMeCached || 0; if (__me && window.__nMeCached !== __me.length) { window.__nMeCached = __me.length; notifAvatarThumb(__me, '__me__', function (th) { try { if (th) __nbm.cacheAvatar('__me__', th); } catch (e) {} }); } } } catch (e) {}
"""
for html_file in candidates:
    if not html_file.exists():
        continue
    hs = rd(html_file)
    changed = False
    if ME_SIG not in hs and AV_ANCHOR in hs:
        hs = hs.replace(AV_ANCHOR, ME_JS + AV_ANCHOR, 1); changed = True
    if NOTIF_SIG not in hs and marker in hs:
        hs = hs.replace(marker, marker + NOTIF_JS, 1); changed = True
    if FLUSH_SIG not in hs and FLUSH_ANCHOR in hs:
        hs = hs.replace(FLUSH_ANCHOR, FLUSH_ANCHOR + FLUSH_JS, 1); changed = True
    if AV_SIG not in hs and AV_ANCHOR in hs:
        hs = hs.replace(AV_ANCHOR, AV_JS + AV_ANCHOR, 1); changed = True
    if changed:
        wr(html_file, hs)
        print("index.html patched: message notifications (avatar + reply/read):", html_file)

# 3) build.gradle: رقم النسخة + التوقيع
bg = app / "build.gradle"
g = rd(bg)
g, n1 = re.subn(r"versionCode\s+\d+", "versionCode " + run, g, count=1)
g, n2 = re.subn(r'versionName\s+"[^"]*"', 'versionName "1.0.%s"' % run, g, count=1)
if n1 != 1 or n2 != 1: die("ما لقيت versionCode/versionName", bg)
signing = '''    signingConfigs {
        release {
            storeFile file(System.getenv("KS_FILE") ?: "release.jks")
            storePassword System.getenv("KS_PASS")
            keyAlias "babylon"
            keyPassword System.getenv("KS_PASS")
        }
    }
'''
g, n3 = re.subn(r"(\n\s*)buildTypes\s*\{", lambda mo: "\n" + signing + mo.group(1) + "buildTypes {", g, count=1)
g, n4 = re.subn(r"(buildTypes\s*\{\s*release\s*\{)", r"\1\n            signingConfig signingConfigs.release", g, count=1)
if n3 != 1 or n4 != 1: die("ما لقيت buildTypes/release", bg)
wr(bg, g)
print("patched OK: versionCode", run)
