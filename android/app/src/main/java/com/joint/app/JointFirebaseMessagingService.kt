package com.joint.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import java.net.HttpURLConnection
import java.net.URL

class JointFirebaseMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        getSharedPreferences("joint_fcm", MODE_PRIVATE)
            .edit()
            .putString("token", token)
            .apply()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val data = message.data
        android.util.Log.i("JOINT-FCM", "Push received; data keys=${data.keys}")

        val title = data["title"] ?: message.notification?.title ?: "JOINT"
        val body = data["body"] ?: message.notification?.body ?: "You have a new notification."
        val target = data["url"] ?: "https://myjointapp.com/notifications.html"
        val avatarUrl = data["actor_avatar_url"].orEmpty()
        val attachmentUrl = data["attachment_url"].orEmpty()
        val previewUrl = data["attachment_preview_url"].orEmpty()
        val isVideo = data["attachment_type"].orEmpty().contains("video", ignoreCase = true) ||
            attachmentUrl.substringBefore('?').substringBefore('#').matches(
                Regex("(?i).*\\.(mp4|webm|mov|m4v)$")
            )

        // Load attachment separately from the sender's avatar. For video, render a
        // representative frame because Android notification cards cannot play video.
        val senderAvatar = downloadImage(avatarUrl)
        val attachmentBitmap = when {
            previewUrl.isNotBlank() -> downloadImage(previewUrl)
            isVideo -> downloadVideoFrame(attachmentUrl)
            attachmentUrl.isNotBlank() -> downloadImage(attachmentUrl)
            else -> null
        }

        ensureChannel()
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("joint_notification_url", target)
        }
        val pending = PendingIntent.getActivity(
            this,
            (data["notification_id"] ?: target).hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_joint)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)

        if (senderAvatar != null) builder.setLargeIcon(senderAvatar)
        if (attachmentBitmap != null) {
            builder.setStyle(
                NotificationCompat.BigPictureStyle()
                    .bigPicture(attachmentBitmap)
                    .bigLargeIcon(senderAvatar)
                    .setSummaryText(body)
            )
        }

        try {
            NotificationManagerCompat.from(this).notify(
                (data["notification_id"] ?: System.currentTimeMillis().toString()).hashCode(),
                builder.build()
            )
            android.util.Log.i("JOINT-FCM", "Notification displayed.")
        } catch (error: SecurityException) {
            android.util.Log.w("JOINT-FCM", "Notification permission is not granted.", error)
        } catch (error: Exception) {
            android.util.Log.e("JOINT-FCM", "Unable to display notification.", error)
        }
    }

    private fun isTrustedMediaUrl(rawUrl: String): Boolean {
        return try {
            val uri = Uri.parse(rawUrl)
            uri.scheme == "https" && !uri.host.isNullOrBlank()
        } catch (_: Exception) { false }
    }

    private fun downloadImage(rawUrl: String): Bitmap? {
        if (!isTrustedMediaUrl(rawUrl)) return null
        var connection: HttpURLConnection? = null
        return try {
            connection = (URL(rawUrl).openConnection() as HttpURLConnection).apply {
                connectTimeout = 7000
                readTimeout = 9000
                instanceFollowRedirects = true
                requestMethod = "GET"
                setRequestProperty("Accept", "image/*")
                connect()
            }
            if (connection.url.protocol != "https" || connection.responseCode !in 200..299) return null
            if (!connection.contentType.orEmpty().startsWith("image/", ignoreCase = true)) return null
            if (connection.contentLengthLong > 8L * 1024L * 1024L) return null
            connection.inputStream.use { input ->
                val bytes = input.readBytes()
                if (bytes.size > 8 * 1024 * 1024) null
                else BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            }
        } catch (error: Exception) {
            android.util.Log.w("JOINT-FCM", "Could not load notification image.", error)
            null
        } finally {
            connection?.disconnect()
        }
    }

    private fun downloadVideoFrame(rawUrl: String): Bitmap? {
        if (!isTrustedMediaUrl(rawUrl)) return null
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(rawUrl, HashMap())
            retriever.getFrameAtTime(1_000_000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
        } catch (error: Exception) {
            android.util.Log.w("JOINT-FCM", "Could not create video notification thumbnail.", error)
            null
        } finally {
            try { retriever.release() } catch (_: Exception) {}
        }
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            if (manager.getNotificationChannel(CHANNEL_ID) == null) {
                manager.createNotificationChannel(
                    NotificationChannel(
                        CHANNEL_ID,
                        "JOINT notifications",
                        NotificationManager.IMPORTANCE_DEFAULT
                    )
                )
            }
        }
    }

    companion object {
        const val CHANNEL_ID = "joint_general"
    }
}
