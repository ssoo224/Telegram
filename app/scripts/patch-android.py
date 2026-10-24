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
perms = ["POST_NOTIFICATIONS", "RECORD_AUDIO", "CAMERA", "MODIFY_AUDIO_SETTINGS", "VIBRATE"]
add = "".join('    <uses-permission android:name="android.permission.%s" />\n' % p
              for p in perms if 'android.permission.%s"' % p not in m)
add += '    <uses-feature android:name="android.hardware.camera" android:required="false" />\n'
add += '    <uses-feature android:name="android.hardware.microphone" android:required="false" />\n'
if "</manifest>" not in m: die("manifest غير متوقع", mf)
m = m.replace("</manifest>", add + "</manifest>")
if "windowSoftInputMode" not in m:
    m, n = re.subn(r"<activity\b", '<activity android:windowSoftInputMode="adjustResize"', m, count=1)
    if n != 1: die("ما لقيت activity", mf)
meta = '        <meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" android:value="messages" />\n'
if "default_notification_channel_id" not in m:
    if "</application>" not in m: die("ما لقيت application", mf)
    m = m.replace("</application>", meta + "    </application>")
wr(mf, m)

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
