package com.contextcompanion.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Receives only notifications from apps explicitly selected in the companion.
 * Matches occur locally and are held for 30 minutes until the person reviews,
 * saves, or discards them. No notification contents leave this device here.
 */
class CbcNotificationCaptureService : NotificationListenerService() {
  companion object {
    const val PREFERENCES = "cbc_notification_listener"
    const val KEY_PACKAGES = "allowed_packages"
    const val KEY_KEYWORDS = "keywords"
    const val KEY_CANDIDATES = "pending_candidates"
    const val CHANNEL_ID = "cbc_review_candidates"
    private const val MAX_CANDIDATES = 10
    private const val CANDIDATE_TTL_MS = 30 * 60 * 1000L

    /** Saves text only after the person deliberately selects this app in Android's share sheet. */
    fun addExplicitShare(context: Context, rawText: String) {
      val preview = rawText.trim().take(280)
      if (preview.isBlank()) return
      val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
      val candidates = readCandidates(preferences)
      candidates.put(JSONObject()
        .put("id", UUID.randomUUID().toString())
        .put("packageName", "manual-share")
        .put("keyword", "shared by you")
        .put("preview", preview)
        .put("createdAt", System.currentTimeMillis()))
      saveCandidates(preferences, candidates)
    }

    private fun readCandidates(preferences: android.content.SharedPreferences): JSONArray {
      val now = System.currentTimeMillis()
      val stored = try { JSONArray(preferences.getString(KEY_CANDIDATES, "[]")) } catch (_: Exception) { JSONArray() }
      val current = JSONArray()
      for (index in 0 until stored.length()) {
        val candidate = stored.optJSONObject(index) ?: continue
        if (now - candidate.optLong("createdAt") < CANDIDATE_TTL_MS) current.put(candidate)
      }
      return current
    }

    private fun saveCandidates(preferences: android.content.SharedPreferences, candidates: JSONArray) {
      val bounded = JSONArray()
      val start = maxOf(0, candidates.length() - MAX_CANDIDATES)
      for (index in start until candidates.length()) bounded.put(candidates.getJSONObject(index))
      preferences.edit().putString(KEY_CANDIDATES, bounded.toString()).apply()
    }
  }

  override fun onNotificationPosted(sbn: StatusBarNotification) {
    val preferences = getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    val allowedPackages = preferences.getStringSet(KEY_PACKAGES, emptySet()) ?: emptySet()
    if (!allowedPackages.contains(sbn.packageName)) return

    val keywords = preferences.getStringSet(KEY_KEYWORDS, emptySet()) ?: emptySet()
    if (keywords.isEmpty()) return

    val extras = sbn.notification.extras
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
    val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim().orEmpty()
    val preview = "$title $text".trim().take(280)
    val matchedKeyword = keywords.firstOrNull { keyword -> preview.contains(keyword, ignoreCase = true) } ?: return

    val candidates = readCandidates(preferences)
    val candidate = JSONObject()
      .put("id", UUID.randomUUID().toString())
      .put("packageName", sbn.packageName)
      .put("keyword", matchedKeyword)
      .put("preview", preview)
      .put("createdAt", System.currentTimeMillis())
    candidates.put(candidate)
    saveCandidates(preferences, candidates)
    postReviewNotification(matchedKeyword)
  }

  private fun postReviewNotification(keyword: String) {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Context review", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "Review a possible reminder before it is saved"
      })
    }
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
      putExtra("cbc_open_review", true)
    } ?: return
    val pendingIntent = PendingIntent.getActivity(this, 0, launchIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
    manager.notify(System.currentTimeMillis().toInt(), builder
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .setContentTitle("Possible reminder detected")
      .setContentText("A selected app mentioned “$keyword”. Tap to review before saving.")
      .setAutoCancel(true)
      .setContentIntent(pendingIntent)
      .build())
  }
}
