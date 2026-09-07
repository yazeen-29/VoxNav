package com.contextcompanion.app

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import org.json.JSONArray

class CbcNotificationModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val candidateTtlMs = 30 * 60 * 1000L

  override fun getName() = "CbcNotificationListener"

  @ReactMethod
  fun saveConfiguration(packages: ReadableArray, keywords: ReadableArray, promise: Promise) {
    val allowedPackages = mutableSetOf<String>()
    for (index in 0 until packages.size()) packages.getString(index)?.takeIf { it.matches(Regex("[a-zA-Z0-9._]+")) }?.let { allowedPackages.add(it) }
    val allowedKeywords = mutableSetOf<String>()
    for (index in 0 until keywords.size()) keywords.getString(index)?.trim()?.lowercase()?.takeIf { it.isNotBlank() && it.length <= 32 }?.let { allowedKeywords.add(it) }
    context.getSharedPreferences(CbcNotificationCaptureService.PREFERENCES, Context.MODE_PRIVATE).edit()
      .putStringSet(CbcNotificationCaptureService.KEY_PACKAGES, allowedPackages)
      .putStringSet(CbcNotificationCaptureService.KEY_KEYWORDS, allowedKeywords)
      .apply()
    promise.resolve(true)
  }

  @ReactMethod
  fun openNotificationAccessSettings(promise: Promise) {
    try {
      context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      promise.resolve(true)
    } catch (error: Exception) { promise.reject("SETTINGS_UNAVAILABLE", error) }
  }

  @ReactMethod
  fun isNotificationAccessEnabled(promise: Promise) {
    val enabled = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: ""
    val component = ComponentName(context, CbcNotificationCaptureService::class.java).flattenToString()
    promise.resolve(enabled.contains(component))
  }

  @ReactMethod
  fun getPendingCandidates(promise: Promise) {
    val preferences = context.getSharedPreferences(CbcNotificationCaptureService.PREFERENCES, Context.MODE_PRIVATE)
    val records = try { JSONArray(preferences.getString(CbcNotificationCaptureService.KEY_CANDIDATES, "[]")) } catch (_: Exception) { JSONArray() }
    val current = JSONArray()
    val response = Arguments.createArray()
    val now = System.currentTimeMillis()
    for (index in 0 until records.length()) {
      val record = records.optJSONObject(index) ?: continue
      if (now - record.optLong("createdAt") >= candidateTtlMs) continue
      current.put(record)
      response.pushMap(Arguments.createMap().apply {
        putString("id", record.optString("id"))
        putString("packageName", record.optString("packageName"))
        putString("keyword", record.optString("keyword"))
        putString("preview", record.optString("preview"))
        putString("kind", record.optString("kind", "notification_match"))
        if (record.has("previousAmount")) putDouble("previousAmount", record.optLong("previousAmount").toDouble())
        if (record.has("currentAmount")) putDouble("currentAmount", record.optLong("currentAmount").toDouble())
        putDouble("createdAt", record.optLong("createdAt").toDouble())
      })
    }
    preferences.edit().putString(CbcNotificationCaptureService.KEY_CANDIDATES, current.toString()).apply()
    promise.resolve(response)
  }

  @ReactMethod
  fun discardCandidate(candidateId: String, promise: Promise) {
    val preferences = context.getSharedPreferences(CbcNotificationCaptureService.PREFERENCES, Context.MODE_PRIVATE)
    val records = try { JSONArray(preferences.getString(CbcNotificationCaptureService.KEY_CANDIDATES, "[]")) } catch (_: Exception) { JSONArray() }
    val remaining = JSONArray()
    for (index in 0 until records.length()) {
      val record = records.optJSONObject(index) ?: continue
      if (record.optString("id") != candidateId) remaining.put(record)
    }
    preferences.edit().putString(CbcNotificationCaptureService.KEY_CANDIDATES, remaining.toString()).apply()
    promise.resolve(true)
  }
}
