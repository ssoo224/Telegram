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
perms = ["POST_NOTIFICATIONS", "RECORD_AUDIO", "CAMERA", "MODIFY_AUDIO_SETTINGS", "VIBRATE", "READ_MEDIA_IMAGES", "READ_MEDIA_VIDEO", "READ_EXTERNAL_STORAGE"]
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
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.view.View;
import android.view.Window;
import android.widget.Toast;
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

        // إتاحة واجهة الحفظ التي يستدعيها index.html داخل WebView.
        decor.post(() -> {
            try {
                WebView webView = getBridge().getWebView();
                webView.addJavascriptInterface(new BabylonAndroidBridge(), "BabylonAndroidNative");
            } catch (Exception ignored) { }
        });

        // طلب صلاحيات الوسائط/الإشعارات مرة واحدة عند أول تشغيل فقط.
        android.content.SharedPreferences prefs =
            getSharedPreferences("babylon_permissions", MODE_PRIVATE);
        if (!prefs.getBoolean("first_request_done", false)) {
            prefs.edit().putBoolean("first_request_done", true).apply();
            decor.postDelayed(this::requestInitialPermissions, 700);
        }
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
        public void saveMedia(String source, String filename, String mimeType) {
            if (source == null || source.isEmpty()) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "تعذر تنزيل الملف", Toast.LENGTH_SHORT).show());
                return;
            }
            mediaExecutor.execute(() -> saveMediaInternal(source, filename, mimeType));
        }
    }

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

# 2.7) ربط حفظ الصور والفيديوهات من index.html بجسر أندرويد الأصلي
html_file = root / "index.html"
if html_file.exists():
    hs = rd(html_file)
    marker = "window.BabylonAndroid = {"
    if marker in hs and "saveMedia: function (source, filename, mimeType)" not in hs:
        hs = hs.replace(marker, marker + """
     saveMedia: function (source, filename, mimeType) {
       var nativeBridge = window.BabylonAndroidNative;
       if (!nativeBridge || typeof nativeBridge.saveMedia !== 'function') {
         throw new Error('Android media bridge unavailable');
       }
       nativeBridge.saveMedia(String(source || ''), String(filename || ''), String(mimeType || 'application/octet-stream'));
     },""", 1)
        wr(html_file, hs)
        print("index.html patched: native gallery downloads enabled")
    elif marker not in hs:
        print("::warning::لم أجد BabylonAndroid في index.html — تحقق من اسم ملف الواجهة")
else:
    print("::warning::index.html مفقود — لم يتم ربط زر التنزيل بالجسر الأصلي")

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
