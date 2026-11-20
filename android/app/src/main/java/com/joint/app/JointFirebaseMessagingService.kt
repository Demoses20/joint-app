package com.joint.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
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
        // MainActivity retrieves the current token when the authenticated JOINT page is ready.
        getSharedPreferences("joint_fcm", MODE_PRIVATE)
            .edit()
            .putString("token", token)
            .apply()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)

        val data = message.data
        val title = data["title"] ?: message.notification?.title ?: "JOINT"
        val body = data["body"] ?: message.notification?.body
            ?: "You have a new notification."
        val target = data["url"] ?: "https://myjointapp.com/notifications.html"
        val avatarUrl = data["actor_avatar_url"].orEmpty()

        // FCM data messages are handled on Firebase's worker thread, so load the
        // sender's avatar before constructing the notification.
        val senderAvatar = downloadSenderAvatar(avatarUrl)

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

        // Large icon displays the actual notifier's profile photo.
        // Keep the JOINT small status-bar icon as the notification identity.
        if (senderAvatar != null) {
            builder.setLargeIcon(senderAvatar)
        }

        val notification = builder.build()

        try {
            NotificationManagerCompat.from(this).notify(
                (data["notification_id"] ?: System.currentTimeMillis().toString()).hashCode(),
                notification
            )
        } catch (_: SecurityException) {
            // Android notification permission may have been revoked.
        }
    }

    private fun downloadSenderAvatar(rawUrl: String): Bitmap? {
        if (rawUrl.isBlank()) return null

        val uri = try {
            Uri.parse(rawUrl)
        } catch (_: Exception) {
            return null
        }

        // Only download HTTPS profile images from the URL supplied by the server.
        if (uri.scheme != "https" || uri.host.isNullOrBlank()) return null

        var connection: HttpURLConnection? = null
        return try {
            connection = (URL(rawUrl).openConnection() as HttpURLConnection).apply {
                connectTimeout = 5000
                readTimeout = 5000
                instanceFollowRedirects = true
                requestMethod = "GET"
                setRequestProperty("Accept", "image/*")
                connect()
            }

            // Do not follow a redirect to a non-HTTPS destination.
            if (connection.url.protocol != "https") return null
            if (connection.responseCode !in 200..299) return null

            val contentType = connection.contentType.orEmpty()
            if (!contentType.startsWith("image/")) return null

            val length = connection.contentLengthLong
            if (length > 2L * 1024L * 1024L) return null

            connection.inputStream.use { input ->
                BitmapFactory.decodeStream(input)
            }
        } catch (error: Exception) {
            android.util.Log.w("JOINT-FCM", "Could not load notification avatar", error)
            null
        } finally {
            connection?.disconnect()
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
