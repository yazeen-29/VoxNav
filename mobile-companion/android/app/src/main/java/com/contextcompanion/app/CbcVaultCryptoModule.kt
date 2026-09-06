package com.contextcompanion.app

import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * Holds an end-to-end vault key in process memory only. Supabase receives the
 * encrypted snapshot and a passphrase-wrapped key envelope, never the raw key
 * or directory data. App lock/logout calls lock() to clear the in-memory key.
 */
class CbcVaultCryptoModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  companion object {
    private const val ITERATIONS = 310_000
    private const val KEY_BITS = 256
    private const val IV_BYTES = 12
  }
  private var vaultKey: ByteArray? = null

  override fun getName() = "CbcVaultCrypto"

  @ReactMethod
  @Synchronized
  fun createVault(passphrase: String, promise: Promise) {
    if (passphrase.length < 12) { promise.reject("WEAK_VAULT_PASSPHRASE", "Use a cloud-vault passphrase with at least 12 characters."); return }
    try {
      val raw = randomBytes(32)
      val salt = randomBytes(16)
      val wrapped = encrypt(deriveKey(passphrase, salt), raw)
      vaultKey?.fill(0)
      vaultKey = raw
      promise.resolve(Arguments.createMap().apply {
        putString("envelope", JSONObject().apply {
          put("version", 1); put("kdf", "PBKDF2-SHA-256"); put("iterations", ITERATIONS)
          put("salt", encode(salt)); put("ciphertext", wrapped.ciphertext); put("iv", wrapped.iv)
        }.toString())
      })
    } catch (error: Exception) { promise.reject("VAULT_CREATE_FAILED", error.message ?: "Could not create encrypted vault.", error) }
  }

  @ReactMethod
  @Synchronized
  fun unlockVault(passphrase: String, envelopeText: String, promise: Promise) {
    try {
      val envelope = JSONObject(envelopeText)
      require(envelope.getInt("version") == 1 && envelope.getInt("iterations") == ITERATIONS) { "Unsupported cloud-vault envelope." }
      val raw = decrypt(deriveKey(passphrase, decode(envelope.getString("salt"))), envelope.getString("ciphertext"), envelope.getString("iv"))
      require(raw.size == 32) { "Invalid cloud-vault key." }
      vaultKey?.fill(0)
      vaultKey = raw
      promise.resolve(true)
    } catch (error: Exception) { promise.reject("VAULT_UNLOCK_FAILED", "Could not unlock the cloud vault. Check the passphrase.", error) }
  }

  @ReactMethod
  @Synchronized
  fun encryptSnapshot(plaintext: String, promise: Promise) {
    try {
      require(plaintext.length <= 750_000) { "Directory is too large for this prototype sync." }
      val key = requireNotNull(vaultKey) { "Unlock the cloud vault first." }
      val encrypted = encrypt(key, plaintext.toByteArray(StandardCharsets.UTF_8))
      promise.resolve(Arguments.createMap().apply { putString("ciphertext", encrypted.ciphertext); putString("iv", encrypted.iv) })
    } catch (error: Exception) { promise.reject("VAULT_ENCRYPT_FAILED", error.message ?: "Could not encrypt trusted directory.", error) }
  }

  @ReactMethod
  @Synchronized
  fun decryptSnapshot(ciphertext: String, iv: String, promise: Promise) {
    try {
      val key = requireNotNull(vaultKey) { "Unlock the cloud vault first." }
      promise.resolve(String(decrypt(key, ciphertext, iv), StandardCharsets.UTF_8))
    } catch (error: Exception) { promise.reject("VAULT_DECRYPT_FAILED", "Could not decrypt cloud directory. Check the passphrase.", error) }
  }

  @ReactMethod
  @Synchronized
  fun lock(promise: Promise) { vaultKey?.fill(0); vaultKey = null; promise.resolve(true) }

  private data class Encrypted(val ciphertext: String, val iv: String)
  private fun randomBytes(length: Int) = ByteArray(length).also { SecureRandom().nextBytes(it) }
  private fun encode(value: ByteArray) = Base64.encodeToString(value, Base64.NO_WRAP)
  private fun decode(value: String) = Base64.decode(value, Base64.NO_WRAP)
  private fun deriveKey(passphrase: String, salt: ByteArray): ByteArray {
    val chars = passphrase.toCharArray()
    return try { SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(PBEKeySpec(chars, salt, ITERATIONS, KEY_BITS)).encoded } finally { chars.fill('\u0000') }
  }
  private fun encrypt(key: ByteArray, plaintext: ByteArray): Encrypted {
    val iv = randomBytes(IV_BYTES)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv)) }
    return Encrypted(encode(cipher.doFinal(plaintext)), encode(iv))
  }
  private fun decrypt(key: ByteArray, ciphertext: String, iv: String): ByteArray {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, decode(iv))) }
    return cipher.doFinal(decode(ciphertext))
  }
}
