package com.contextcompanion.app

import android.content.Context
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * Local caretaker lock only. It does not grant access to a patient's device or
 * to any unpaired cloud data. The password is never persisted; only a salted
 * PBKDF2 verifier is stored in the app-private preferences.
 */
class CbcAccessModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  companion object {
    private const val PREFERENCES = "cbc_access_gate"
    private const val SALT_KEY = "caretaker_password_salt"
    private const val VERIFIER_KEY = "caretaker_password_verifier"
    private const val ITERATIONS = 310_000
    private const val KEY_LENGTH_BITS = 256

    private fun deriveVerifier(password: String, salt: ByteArray): ByteArray {
      val chars = password.toCharArray()
      return try {
        SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
          .generateSecret(PBEKeySpec(chars, salt, ITERATIONS, KEY_LENGTH_BITS)).encoded
      } finally {
        chars.fill('\u0000')
      }
    }
  }

  override fun getName() = "CbcAccessGate"

  @ReactMethod
  fun hasCaretakerPassword(promise: Promise) {
    val prefs = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    promise.resolve(prefs.contains(SALT_KEY) && prefs.contains(VERIFIER_KEY))
  }

  @ReactMethod
  fun setCaretakerPassword(password: String, promise: Promise) {
    if (password.length < 12) {
      promise.reject("WEAK_PASSWORD", "Use a caretaker password with at least 12 characters.")
      return
    }
    try {
      val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
      val verifier = deriveVerifier(password, salt)
      context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit()
        .putString(SALT_KEY, Base64.encodeToString(salt, Base64.NO_WRAP))
        .putString(VERIFIER_KEY, Base64.encodeToString(verifier, Base64.NO_WRAP))
        .apply()
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("PASSWORD_SETUP_FAILED", error)
    }
  }

  @ReactMethod
  fun verifyCaretakerPassword(password: String, promise: Promise) {
    try {
      val prefs = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
      val salt = prefs.getString(SALT_KEY, null)?.let { Base64.decode(it, Base64.NO_WRAP) }
      val expected = prefs.getString(VERIFIER_KEY, null)?.let { Base64.decode(it, Base64.NO_WRAP) }
      if (salt == null || expected == null) {
        promise.resolve(false)
        return
      }
      promise.resolve(MessageDigest.isEqual(expected, deriveVerifier(password, salt)))
    } catch (error: Exception) {
      promise.reject("PASSWORD_VERIFY_FAILED", error)
    }
  }
}
