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
import java.util.Locale

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
    const val KEY_PAYMENT_HISTORY = "payment_amount_history"
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

    val payment = extractPaymentAmount(preview)
    val paymentKey = "${sbn.packageName}:${title.lowercase(Locale.US).replace(Regex("\\s+"), " ").take(100)}"
    val previousPayment = payment?.let { rememberPaymentAndGetPrevious(preferences, paymentKey, it) }
    val isAmountChange = payment != null && previousPayment != null && payment > previousPayment

    val candidates = readCandidates(preferences)
    val candidate = JSONObject()
      .put("id", UUID.randomUUID().toString())
      .put("packageName", sbn.packageName)
      .put("keyword", matchedKeyword)
      .put("preview", preview)
      .put("createdAt", System.currentTimeMillis())
      .put("kind", if (isAmountChange) "payment_change" else "notification_match")
    if (isAmountChange) {
      candidate.put("previousAmount", previousPayment)
      candidate.put("currentAmount", payment)
      candidate.put("senderKey", paymentKey)
    }
    candidates.put(candidate)
    saveCandidates(preferences, candidates)
    postReviewNotification(matchedKeyword, previousPayment, payment)
  }

  private fun postReviewNotification(keyword: String, previousAmount: Long?, currentAmount: Long?) {
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
    val message = if (previousAmount != null && currentAmount != null) {
      "Amount changed from ₹$previousAmount to ₹$currentAmount. Review before acting."
    } else {
      "A selected app mentioned “$keyword”. Tap to review before saving."
    }
    val title = if (previousAmount != null && currentAmount != null) "Possible payment change" else "Possible reminder detected"
    manager.notify(System.currentTimeMillis().toInt(), builder
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .setContentTitle(title)
      .setContentText(message)
      .setAutoCancel(true)
      .setContentIntent(pendingIntent)
      .build())
  }

  private fun extractPaymentAmount(text: String): Long? {
    val hasPaymentAction = Regex("\\b(send|sent|transfer|payment|pay|approve|approved)\\b", RegexOption.IGNORE_CASE).containsMatchIn(text)
    if (!hasPaymentAction) return null
    val match = Regex("(?:₹|rs\\.?|inr\\.?)[\\s]*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)|\\b([0-9][0-9,]*(?:\\.[0-9]{1,2})?)\\s*(?:₹|rs\\.?|inr\\.?)", RegexOption.IGNORE_CASE).find(text) ?: return null
    val raw = (match.groups[1]?.value ?: match.groups[2]?.value)?.replace(",", "") ?: return null
    return raw.toDoubleOrNull()?.takeIf { it > 0 && it <= 100000000 }?.toLong()
  }

  private fun rememberPaymentAndGetPrevious(preferences: android.content.SharedPreferences, key: String, amount: Long): Long? {
    val now = System.currentTimeMillis()
    val stored = try { JSONObject(preferences.getString(KEY_PAYMENT_HISTORY, "{}")) } catch (_: Exception) { JSONObject() }
    val previous = stored.optJSONObject(key)?.takeIf { now - it.optLong("createdAt") < CANDIDATE_TTL_MS }?.optLong("amount")?.takeIf { it > 0 }
    stored.put(key, JSONObject().put("amount", amount).put("createdAt", now))
    preferences.edit().putString(KEY_PAYMENT_HISTORY, stored.toString()).apply()
    return previous
  }
}
