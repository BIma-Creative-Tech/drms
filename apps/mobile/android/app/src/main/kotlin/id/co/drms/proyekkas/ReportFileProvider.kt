package id.co.drms.proyekkas

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File
import java.io.FileNotFoundException

/**
 * User 2026-10-19 (APK ↔ web parity, phase 4 Laporan): read-only `content://<applicationId>.reports/<name>` for the
 * report exports the app downloaded into `cacheDir/reports` — so "Buka" (ACTION_VIEW) and "Bagikan" (ACTION_SEND) can
 * hand the file to another app with a one-off read grant, without androidx FileProvider or a new plugin (pubspec and
 * lockfile stay pinned). Not exported; only plain file names inside that directory resolve.
 */
class ReportFileProvider : ContentProvider() {
    override fun onCreate(): Boolean = true

    private fun fileOf(uri: Uri): File? {
        val ctx = context ?: return null
        val name = uri.lastPathSegment ?: return null
        if (!NAME.matches(name)) return null
        val f = File(dir(ctx), name)
        return if (f.isFile) f else null
    }

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r") throw SecurityException("read only")
        val f = fileOf(uri) ?: throw FileNotFoundException(uri.toString())
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? {
        val f = fileOf(uri) ?: return null
        return MatrixCursor(arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)).apply { addRow(arrayOf<Any>(f.name, f.length())) }
    }

    override fun getType(uri: Uri): String? = mimeOf(uri.lastPathSegment ?: "")

    override fun insert(uri: Uri, values: ContentValues?): Uri? = throw UnsupportedOperationException()

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0

    companion object {
        val NAME = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$")

        fun dir(ctx: Context): File = File(ctx.cacheDir, "reports").apply { mkdirs() }

        fun uriFor(ctx: Context, name: String): Uri = Uri.parse("content://${ctx.packageName}.reports/$name")

        fun mimeOf(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
            "pdf" -> "application/pdf"
            "jpg", "jpeg" -> "image/jpeg" // D2410: request attachments (photo)
            "png" -> "image/png"
            "csv" -> "text/csv"
            "xlsx" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            else -> "application/octet-stream"
        }
    }
}
