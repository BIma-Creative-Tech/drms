package id.co.drms.proyekkas

import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.MediaStore
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Monotonic clock for the offline sync contract (ADR 0010 decision 7): `elapsed_ms` =
 * SystemClock.elapsedRealtime() (time since boot, not changeable by the user) and `boot_id` =
 * Settings.Global.BOOT_COUNT (API 24+), so the server can estimate the real time of offline items.
 *
 * Device integrity signals (ADR 0010 decision 10, QM-4): best effort, only REPORTED to the server
 * (POST /api/v1/devices/register `integrity`), never used to block. No third-party plugin and no
 * extra permission: su/Magisk files + test-keys build tags (root), well-known emulator build
 * properties, and the Settings.Global developer-options / ADB switches.
 *
 * Browser (user 2026-10-19): `open` hands an https URL to the default browser (ACTION_VIEW) — the APK "Keamanan
 * akun" opens the web 2FA page this way. Anything but https is refused; no browser installed → false.
 *
 * Files (user 2026-10-19, phase 4 Laporan): `save` writes a downloaded report export into cacheDir/reports (served
 * read-only by ReportFileProvider), `open` / `share` hand it to another app (ACTION_VIEW / ACTION_SEND chooser with a
 * read grant), `download` copies it into the public Download/ProyekKas folder (MediaStore, API 29+; no permission).
 * File work runs on the background executor (see Threading).
 *
 * Threading: since Flutter 3.29 the Dart UI isolate runs on the Android main thread by default
 * (engine `Settings::merged_platform_ui_thread = kEnabled`, Flutter 3.47.5 common/settings.h), so a
 * method-channel handler that does file-system or binder work on the main thread freezes the whole
 * UI. The integrity checks therefore run on a single background thread; the result is posted back
 * to the main thread (MethodChannel.MethodCallHandler docs allow any thread, main keeps it simple).
 */
class MainActivity : FlutterActivity() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var integrityExecutor: ExecutorService? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "id.co.drms.proyekkas/clock")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "elapsedRealtime" -> result.success(SystemClock.elapsedRealtime())
                    "bootCount" -> {
                        val count = try {
                            Settings.Global.getInt(contentResolver, Settings.Global.BOOT_COUNT)
                        } catch (e: Settings.SettingNotFoundException) {
                            -1
                        }
                        result.success(count)
                    }
                    else -> result.notImplemented()
                }
            }
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "id.co.drms.proyekkas/integrity")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "check" -> {
                        val executor = integrityExecutor ?: Executors.newSingleThreadExecutor().also {
                            integrityExecutor = it
                        }
                        executor.execute {
                            val report: Map<String, Boolean>? = try {
                                mapOf(
                                    "rooted" to isRooted(),
                                    "emulator" to isEmulator(),
                                    "developerMode" to globalFlag(Settings.Global.DEVELOPMENT_SETTINGS_ENABLED),
                                    "adbEnabled" to globalFlag(Settings.Global.ADB_ENABLED),
                                )
                            } catch (e: Exception) {
                                null // best effort: "not measured"
                            }
                            mainHandler.post { result.success(report) }
                        }
                    }
                    else -> result.notImplemented()
                }
            }
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "id.co.drms.proyekkas/files")
            .setMethodCallHandler { call, result ->
                val name = call.argument<String>("name") ?: ""
                if (!ReportFileProvider.NAME.matches(name)) {
                    result.success(false)
                    return@setMethodCallHandler
                }
                when (call.method) {
                    "save" -> background(result) {
                        val bytes = call.argument<ByteArray>("bytes") ?: return@background false
                        val dir = ReportFileProvider.dir(this)
                        // keep the cache small: exports older than a day go
                        dir.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > DAY_MS }?.forEach { it.delete() }
                        File(dir, name).writeBytes(bytes)
                        true
                    }
                    "open", "share" -> {
                        val uri = ReportFileProvider.uriFor(this, name)
                        val mime = ReportFileProvider.mimeOf(name)
                        val intent = if (call.method == "open") {
                            Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime)
                        } else {
                            Intent.createChooser(Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri), null)
                        }
                        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        try {
                            startActivity(intent)
                            result.success(true)
                        } catch (e: ActivityNotFoundException) {
                            result.success(false)
                        }
                    }
                    "download" -> background(result) {
                        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return@background false
                        val src = File(ReportFileProvider.dir(this), name)
                        if (!src.isFile) return@background false
                        val values = ContentValues().apply {
                            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                            put(MediaStore.MediaColumns.MIME_TYPE, ReportFileProvider.mimeOf(name))
                            put(MediaStore.MediaColumns.RELATIVE_PATH, "Download/ProyekKas")
                        }
                        val target = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return@background false
                        contentResolver.openOutputStream(target)?.use { out -> src.inputStream().use { it.copyTo(out) } } ?: return@background false
                        true
                    }
                    else -> result.notImplemented()
                }
            }
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "id.co.drms.proyekkas/browser")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "open" -> {
                        val uri = (call.argument<String>("url"))?.let { Uri.parse(it) }
                        if (uri == null || uri.scheme != "https") {
                            result.success(false)
                        } else {
                            try {
                                startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
                                result.success(true)
                            } catch (e: ActivityNotFoundException) {
                                result.success(false)
                            }
                        }
                    }
                    else -> result.notImplemented()
                }
            }
    }

    /** Runs [work] on the background executor and posts the result (false on any error) to the main thread. */
    private fun background(result: MethodChannel.Result, work: () -> Boolean) {
        val executor = integrityExecutor ?: Executors.newSingleThreadExecutor().also { integrityExecutor = it }
        executor.execute {
            val ok = try {
                work()
            } catch (e: Exception) {
                false
            }
            mainHandler.post { result.success(ok) }
        }
    }

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        integrityExecutor?.shutdownNow()
        integrityExecutor = null
        super.cleanUpFlutterEngine(flutterEngine)
    }

    private fun globalFlag(name: String): Boolean =
        try {
            Settings.Global.getInt(contentResolver, name, 0) != 0
        } catch (e: SecurityException) {
            false
        }

    private fun isRooted(): Boolean {
        if (Build.TAGS?.contains("test-keys") == true) return true
        return SU_PATHS.any { path ->
            try {
                File(path).exists()
            } catch (e: SecurityException) {
                false
            }
        }
    }

    private fun isEmulator(): Boolean {
        val fp = Build.FINGERPRINT ?: ""
        val model = Build.MODEL ?: ""
        val product = Build.PRODUCT ?: ""
        val hardware = Build.HARDWARE ?: ""
        return fp.startsWith("generic") || fp.startsWith("unknown") || fp.contains("emulator") ||
            model.contains("google_sdk") || model.contains("Emulator") || model.contains("Android SDK built for") ||
            (Build.MANUFACTURER ?: "").contains("Genymotion") ||
            hardware == "goldfish" || hardware == "ranchu" ||
            product.startsWith("sdk") || product.contains("_sdk") || product.contains("emulator") ||
            ((Build.BRAND ?: "").startsWith("generic") && (Build.DEVICE ?: "").startsWith("generic"))
    }

    private companion object {
        const val DAY_MS = 24L * 60 * 60 * 1000
        val SU_PATHS = arrayOf(
            "/system/app/Superuser.apk",
            "/sbin/su",
            "/system/bin/su",
            "/system/xbin/su",
            "/system/xbin/daemonsu",
            "/system/sd/xbin/su",
            "/system/bin/failsafe/su",
            "/data/local/su",
            "/data/local/bin/su",
            "/data/local/xbin/su",
            "/su/bin/su",
            "/sbin/magisk",
            "/system/bin/magisk",
            "/data/adb/magisk",
        )
    }
}
