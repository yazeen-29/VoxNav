package com.contextcompanion.app

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.util.Base64
import androidx.exifinterface.media.ExifInterface
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.components.containers.Category
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import org.tensorflow.lite.Interpreter
import java.io.File
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Processes one user-requested camera photo locally. The module accepts only a
 * file in this app's cache directory and deletes it in finally; no image or
 * face template is stored by native code. JS receives a normalized embedding
 * only after an explicit open-eyes stage of a short blink movement challenge.
 *
 * This checks movement, not presentation-attack resistance. It must not be
 * used to authenticate payments, medical decisions, or emergency access.
 */
class CbcTrustedPersonModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  companion object {
    private const val FACE_LANDMARKER_ASSET = "face_landmarker.task"
    private const val EMBEDDING_ASSET = "mobilefacenet.tflite"
    private const val CLOSED_EYE_SCORE = 0.45f
    private const val OPEN_EYE_SCORE = 0.18f
    private const val BLINK_WINDOW_MS = 15_000L
  }

  private var faceLandmarker: FaceLandmarker? = null
  private var embeddingInterpreter: Interpreter? = null
  private var closedEyeAt: Long = 0L

  override fun getName() = "CbcTrustedPerson"

  @ReactMethod
  @Synchronized
  fun captureBlinkFrame(uriText: String, stage: String, promise: Promise) {
    var imageFile: File? = null
    try {
      imageFile = permittedCacheFile(uriText)
      val bitmap = loadUprightBitmap(imageFile)
      val result = faceLandmarker().detect(BitmapImageBuilder(bitmap).build())
      if (result.faceLandmarks().size != 1) {
        promise.reject("FACE_COUNT", "Keep exactly one face in the camera frame.")
        return
      }

      val landmarks = result.faceLandmarks().first()
      if (!isCenteredAndLargeEnough(landmarks.map { it.x() }, landmarks.map { it.y() })) {
        promise.reject("FACE_POSITION", "Move closer and keep your face centered in good light.")
        return
      }

      val blink = blinkScore(result.faceBlendshapes().orElse(emptyList()).firstOrNull().orEmpty())
      when (stage) {
        "closed" -> {
          if (blink < CLOSED_EYE_SCORE) {
            promise.reject("BLINK_NOT_SEEN", "Close both eyes briefly, then take the photo.")
            return
          }
          closedEyeAt = System.currentTimeMillis()
          promise.resolve(Arguments.createMap().apply {
            putString("stage", "closed")
            putDouble("blinkScore", blink.toDouble())
          })
        }
        "open" -> {
          if (System.currentTimeMillis() - closedEyeAt !in 0..BLINK_WINDOW_MS) {
            promise.reject("BLINK_EXPIRED", "Start the blink check again and take the next photo within 15 seconds.")
            return
          }
          closedEyeAt = 0L
          if (blink > OPEN_EYE_SCORE) {
            promise.reject("EYES_NOT_OPEN", "Open both eyes, then take the next photo.")
            return
          }
          val face = cropFace(bitmap, landmarks.map { it.x() }, landmarks.map { it.y() })
          val embedding = embeddingFor(face)
          promise.resolve(Arguments.createMap().apply {
            putString("stage", "open")
            putString("embedding", Base64.encodeToString(floatsToBytes(embedding), Base64.NO_WRAP))
            putDouble("blinkScore", blink.toDouble())
          })
        }
        else -> promise.reject("BAD_STAGE", "Unsupported camera check stage.")
      }
    } catch (error: Exception) {
      promise.reject("TRUSTED_PERSON_CAPTURE_FAILED", error.message ?: "Could not process this camera photo.", error)
    } finally {
      // The camera capture is a short-lived cache file. Do not retain it.
      imageFile?.delete()
    }
  }

  @ReactMethod
  fun compareEmbeddings(candidateText: String, knownText: String, promise: Promise) {
    try {
      val candidate = bytesToFloats(Base64.decode(candidateText, Base64.NO_WRAP))
      val known = bytesToFloats(Base64.decode(knownText, Base64.NO_WRAP))
      require(candidate.size == 192 && known.size == 192) { "Invalid local face template." }
      val similarity = candidate.indices.sumOf { (candidate[it] * known[it]).toDouble() }
      promise.resolve(similarity)
    } catch (error: Exception) {
      promise.reject("COMPARE_FAILED", error.message ?: "Could not compare local face templates.", error)
    }
  }

  private fun permittedCacheFile(uriText: String): File {
    val uri = Uri.parse(uriText)
    require(uri.scheme == "file") { "Camera photo must be a local file." }
    val file = File(requireNotNull(uri.path)).canonicalFile
    val cache = context.cacheDir.canonicalFile
    require(file.path.startsWith(cache.path + File.separator)) { "Camera photo is outside the app cache." }
    require(file.isFile) { "Camera photo is not available." }
    return file
  }

  private fun loadUprightBitmap(file: File): Bitmap {
    val decoded = BitmapFactory.decodeFile(file.path) ?: error("Could not read the camera photo.")
    val rotation = when (ExifInterface(file).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
      ExifInterface.ORIENTATION_ROTATE_90 -> 90f
      ExifInterface.ORIENTATION_ROTATE_180 -> 180f
      ExifInterface.ORIENTATION_ROTATE_270 -> 270f
      else -> 0f
    }
    if (rotation == 0f) return decoded
    return Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, Matrix().apply { postRotate(rotation) }, true)
  }

  private fun faceLandmarker(): FaceLandmarker {
    return faceLandmarker ?: FaceLandmarker.createFromOptions(
      context,
      FaceLandmarker.FaceLandmarkerOptions.builder()
        .setBaseOptions(BaseOptions.builder().setModelAssetPath(FACE_LANDMARKER_ASSET).build())
        .setRunningMode(RunningMode.IMAGE)
        .setNumFaces(1)
        .setMinFaceDetectionConfidence(0.65f)
        .setMinFacePresenceConfidence(0.65f)
        .setOutputFaceBlendshapes(true)
        .build()
    ).also { faceLandmarker = it }
  }

  private fun embeddingInterpreter(): Interpreter {
    return embeddingInterpreter ?: Interpreter(mapAsset(EMBEDDING_ASSET), Interpreter.Options().setNumThreads(2)).also { interpreter ->
      val input = interpreter.getInputTensor(0).shape().toList()
      val output = interpreter.getOutputTensor(0).shape().toList()
      require(input == listOf(1, 112, 112, 3) && output == listOf(1, 192)) { "Unexpected bundled embedding model shape." }
      embeddingInterpreter = interpreter
    }
  }

  private fun mapAsset(asset: String): ByteBuffer {
    context.assets.openFd(asset).use { descriptor ->
      FileInputStream(descriptor.fileDescriptor).channel.use { channel ->
        return channel.map(FileChannel.MapMode.READ_ONLY, descriptor.startOffset, descriptor.declaredLength)
      }
    }
  }

  private fun isCenteredAndLargeEnough(xs: List<Float>, ys: List<Float>): Boolean {
    val minX = xs.minOrNull() ?: return false
    val maxX = xs.maxOrNull() ?: return false
    val minY = ys.minOrNull() ?: return false
    val maxY = ys.maxOrNull() ?: return false
    val width = maxX - minX
    val height = maxY - minY
    val centerX = (minX + maxX) / 2f
    val centerY = (minY + maxY) / 2f
    return width >= 0.24f && height >= 0.24f && centerX in 0.30f..0.70f && centerY in 0.25f..0.75f
  }

  private fun blinkScore(categories: List<Category>): Float {
    val byName = categories.associate { it.categoryName() to it.score() }
    return (max(byName["eyeBlinkLeft"] ?: 0f, byName["eyeBlinkRight"] ?: 0f))
  }

  private fun cropFace(bitmap: Bitmap, xs: List<Float>, ys: List<Float>): Bitmap {
    val minX = xs.minOrNull() ?: error("No landmarks available.")
    val maxX = xs.maxOrNull() ?: error("No landmarks available.")
    val minY = ys.minOrNull() ?: error("No landmarks available.")
    val maxY = ys.maxOrNull() ?: error("No landmarks available.")
    val side = max(maxX - minX, maxY - minY) * 1.55f
    val centerX = (minX + maxX) / 2f
    val centerY = (minY + maxY) / 2f - side * 0.06f
    val left = ((centerX - side / 2f) * bitmap.width).toInt().coerceIn(0, bitmap.width - 1)
    val top = ((centerY - side / 2f) * bitmap.height).toInt().coerceIn(0, bitmap.height - 1)
    val right = ((centerX + side / 2f) * bitmap.width).toInt().coerceIn(left + 1, bitmap.width)
    val bottom = ((centerY + side / 2f) * bitmap.height).toInt().coerceIn(top + 1, bitmap.height)
    return Bitmap.createScaledBitmap(Bitmap.createBitmap(bitmap, left, top, right - left, bottom - top), 112, 112, true)
  }

  private fun embeddingFor(face: Bitmap): FloatArray {
    val input = ByteBuffer.allocateDirect(1 * 112 * 112 * 3 * 4).order(ByteOrder.nativeOrder())
    val pixels = IntArray(112 * 112)
    face.getPixels(pixels, 0, 112, 0, 0, 112, 112)
    pixels.forEach { pixel ->
      input.putFloat(((pixel shr 16 and 0xff) - 127.5f) / 128f)
      input.putFloat(((pixel shr 8 and 0xff) - 127.5f) / 128f)
      input.putFloat(((pixel and 0xff) - 127.5f) / 128f)
    }
    input.rewind()
    val output = Array(1) { FloatArray(192) }
    embeddingInterpreter().run(input, output)
    val norm = sqrt(output[0].sumOf { (it * it).toDouble() }).toFloat()
    require(norm > 0.0001f) { "Could not create a face template." }
    return output[0].map { it / norm }.toFloatArray()
  }

  private fun floatsToBytes(values: FloatArray): ByteArray = ByteBuffer.allocate(values.size * 4)
    .order(ByteOrder.LITTLE_ENDIAN)
    .also { buffer -> values.forEach(buffer::putFloat) }
    .array()

  private fun bytesToFloats(bytes: ByteArray): FloatArray {
    require(bytes.size == 192 * 4) { "Invalid local face template." }
    return FloatArray(192) { index -> ByteBuffer.wrap(bytes, index * 4, 4).order(ByteOrder.LITTLE_ENDIAN).float }
  }
}
