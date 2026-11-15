package com.joint.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.os.Build
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.android.billingclient.api.*
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

class MainActivity : AppCompatActivity(), PurchasesUpdatedListener {

    private lateinit var webView: WebView
    private lateinit var billingClient: BillingClient

    private val products = mutableMapOf<String, ProductDetails>()

    private val productIds = listOf(
        "joint_diamonds_5",
        "joint_diamonds_10",
        "joint_diamonds_25",
        "joint_diamonds_50",
        "joint_diamonds_100",
        "joint_diamonds_250",
        "joint_diamonds_500",
        "joint_diamonds_750",
        "joint_diamonds_1000"
    )

    private var pageReady = false

    private var pendingWebPermissionRequest: PermissionRequest? = null
    private lateinit var mediaPermissionLauncher: ActivityResultLauncher<Array<String>>
    private lateinit var notificationPermissionLauncher: ActivityResultLauncher<String>

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        mediaPermissionLauncher =
            registerForActivityResult(
                ActivityResultContracts.RequestMultiplePermissions()
            ) { results ->
                val request = pendingWebPermissionRequest
                pendingWebPermissionRequest = null

                if (request != null) {
                    val stillTrusted =
                        request.origin.scheme == "https" &&
                        request.origin.host in listOf(
                            "myjointapp.com",
                            "www.myjointapp.com"
                        )

                    val resourcesToGrant = request.resources.filter { resource ->
                        when (resource) {
                            PermissionRequest.RESOURCE_VIDEO_CAPTURE ->
                                ContextCompat.checkSelfPermission(
                                    this@MainActivity,
                                    Manifest.permission.CAMERA
                                ) == PackageManager.PERMISSION_GRANTED

                            PermissionRequest.RESOURCE_AUDIO_CAPTURE ->
                                ContextCompat.checkSelfPermission(
                                    this@MainActivity,
                                    Manifest.permission.RECORD_AUDIO
                                ) == PackageManager.PERMISSION_GRANTED

                            else -> false
                        }
                    }

                    if (stillTrusted && resourcesToGrant.isNotEmpty()) {
                        try {
                            request.grant(resourcesToGrant.toTypedArray())
                        } catch (_: IllegalStateException) {
                            request.deny()
                        }
                    } else {
                        request.deny()
                    }
                }
            }

        notificationPermissionLauncher =
            registerForActivityResult(
                ActivityResultContracts.RequestPermission()
            ) { /* The operating system records the user's choice. */ }

        webView = WebView(this)
        setContentView(webView)

        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = false
        webView.settings.mixedContentMode =
            android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW

        webView.settings.mediaPlaybackRequiresUserGesture = false

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    val origin = request.origin
                    val trustedOrigin =
                        origin.scheme == "https" &&
                        origin.host in listOf(
                            "myjointapp.com",
                            "www.myjointapp.com"
                        )

                    if (!trustedOrigin) {
                        request.deny()
                        return@runOnUiThread
                    }

                    val requestedResources = request.resources.filter {
                        it == PermissionRequest.RESOURCE_VIDEO_CAPTURE ||
                        it == PermissionRequest.RESOURCE_AUDIO_CAPTURE
                    }

                    if (requestedResources.isEmpty()) {
                        request.deny()
                        return@runOnUiThread
                    }

                    val missingPermissions = mutableListOf<String>()

                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE in requestedResources &&
                        ContextCompat.checkSelfPermission(
                            this@MainActivity,
                            Manifest.permission.CAMERA
                        ) != PackageManager.PERMISSION_GRANTED
                    ) {
                        missingPermissions.add(Manifest.permission.CAMERA)
                    }

                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE in requestedResources &&
                        ContextCompat.checkSelfPermission(
                            this@MainActivity,
                            Manifest.permission.RECORD_AUDIO
                        ) != PackageManager.PERMISSION_GRANTED
                    ) {
                        missingPermissions.add(Manifest.permission.RECORD_AUDIO)
                    }

                    if (missingPermissions.isEmpty()) {
                        try {
                            request.grant(requestedResources.toTypedArray())
                        } catch (_: IllegalStateException) {
                            request.deny()
                        }
                    } else {
                        pendingWebPermissionRequest?.let {
                            try {
                                it.deny()
                            } catch (_: Exception) {}
                        }
                        pendingWebPermissionRequest = request
                        mediaPermissionLauncher.launch(
                            missingPermissions.distinct().toTypedArray()
                        )
                    }
                }
            }

            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                if (pendingWebPermissionRequest == request) {
                    pendingWebPermissionRequest = null
                }
            }
        }

        webView.webViewClient = object : WebViewClient() {

            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                val uri = request?.url ?: return true
                val host = uri.host?.lowercase()

                if (uri.scheme == "https" &&
                    host in listOf("myjointapp.com", "www.myjointapp.com")
                ) return false

                if (host != null &&
                    (host == "paystack.com" ||
                     host.endsWith(".paystack.com") ||
                     host == "paystack.co" ||
                     host.endsWith(".paystack.co"))
                ) {
                    emit(
                        "billingError",
                        JSONObject().put(
                            "message",
                            "Use the JOINT website for Paystack payments."
                        )
                    )
                    return true
                }

                if (uri.scheme == "https") {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, uri))
                    } catch (_: Exception) {}
                }

                return true
            }

            override fun onPageStarted(
                view: WebView?,
                url: String?,
                favicon: Bitmap?
            ) {
                pageReady = false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                pageReady = true
                injectWalletIntegration()
                queryProducts()
                requestNotificationPermissionOnce()
            }
        }

        if (WebViewFeature.isFeatureSupported(
                WebViewFeature.WEB_MESSAGE_LISTENER
            )
        ) {
            WebViewCompat.addWebMessageListener(
                webView,
                "jointPlayBilling",
                setOf(
                    "https://myjointapp.com",
                    "https://www.myjointapp.com"
                ),
                WebViewCompat.WebMessageListener {
                    _, message: WebMessageCompat,
                    sourceOrigin, isMainFrame, replyProxy ->

                    if (!isMainFrame ||
                        sourceOrigin.scheme != "https" ||
                        sourceOrigin.host !in listOf(
                            "myjointapp.com",
                            "www.myjointapp.com"
                        )
                    ) return@WebMessageListener

                    handleBridgeMessage(
                        message.data ?: "{}",
                        replyProxy
                    )
                }
            )
        }

        billingClient = BillingClient.newBuilder(this)
            .setListener(this)
            .enablePendingPurchases(
                PendingPurchasesParams.newBuilder()
                    .enableOneTimeProducts()
                    .build()
            )
            .enableAutoServiceReconnection()
            .build()

        billingClient.startConnection(
            object : BillingClientStateListener {

                override fun onBillingSetupFinished(
                    result: BillingResult
                ) {
                    if (result.responseCode ==
                        BillingClient.BillingResponseCode.OK
                    ) {
                        queryProducts()
                        queryExistingPurchases()
                    } else {
                        emit(
                            "billingError",
                            JSONObject().put(
                                "message",
                                result.debugMessage
                            )
                        )
                    }
                }

                override fun onBillingServiceDisconnected() {}
            }
        )

        webView.loadUrl("https://myjointapp.com/")
    }

    private fun requestNotificationPermissionOnce() {
        if (Build.VERSION.SDK_INT < 33) return

        val alreadyGranted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED

        if (alreadyGranted) return

        val preferences = getSharedPreferences("joint_permissions", MODE_PRIVATE)
        val alreadyAsked = preferences.getBoolean("notifications_prompted", false)

        if (!alreadyAsked) {
            preferences.edit()
                .putBoolean("notifications_prompted", true)
                .apply()
            notificationPermissionLauncher.launch(
                Manifest.permission.POST_NOTIFICATIONS
            )
        }
    }

    private fun handleBridgeMessage(
        raw: String,
        reply: JavaScriptReplyProxy
    ) {
        val request = try {
            JSONObject(raw)
        } catch (_: Exception) {
            JSONObject()
        }

        when (request.optString("action")) {

            "getProducts" -> {
                queryProducts {
                    reply.postMessage(productsJson().toString())
                }
            }

            "buy" -> {
                val productId = request.optString("productId")
                val accountId = request.optString("accountId")

                runOnUiThread {
                    val details = products[productId]

                    if (details == null) {
                        reply.postMessage(
                            JSONObject()
                                .put("ok", false)
                                .put("error", "Product unavailable.")
                                .toString()
                        )
                    } else {
                        reply.postMessage(
                            JSONObject()
                                .put("ok", true)
                                .put("launching", true)
                                .toString()
                        )

                        launchPurchase(details, accountId)
                    }
                }
            }

            "consume" -> {
                val token = request.optString("purchaseToken")

                if (token.isBlank()) {
                    reply.postMessage(
                        JSONObject()
                            .put("ok", false)
                            .put("error", "Missing purchase token.")
                            .toString()
                    )
                } else {
                    consumeVerifiedPurchase(token) { result ->
                        reply.postMessage(
                            JSONObject()
                                .put(
                                    "ok",
                                    result.responseCode ==
                                        BillingClient.BillingResponseCode.OK
                                )
                                .put("message", result.debugMessage)
                                .toString()
                        )
                    }
                }
            }

            else -> {
                reply.postMessage(
                    JSONObject()
                        .put("ok", false)
                        .put("error", "Unsupported action.")
                        .toString()
                )
            }
        }
    }

    private fun queryProducts(done: (() -> Unit)? = null) {
        if (!::billingClient.isInitialized ||
            !billingClient.isReady
        ) {
            done?.invoke()
            return
        }

        val requested = productIds.map {
            QueryProductDetailsParams.Product.newBuilder()
                .setProductId(it)
                .setProductType(BillingClient.ProductType.INAPP)
                .build()
        }

        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(requested)
            .build()

        billingClient.queryProductDetailsAsync(params) { result, response ->

            if (result.responseCode ==
                BillingClient.BillingResponseCode.OK
            ) {
                products.clear()

                response.productDetailsList.forEach {
                    products[it.productId] = it
                }

                if (pageReady) {
                    emit("products", productsJson())
                }

            } else {
                emit(
                    "billingError",
                    JSONObject().put("message", result.debugMessage)
                )
            }

            done?.invoke()
        }
    }

    private fun productsJson(): JSONObject {
        val array = JSONArray()

        products.values.forEach { item ->
            val offer =
                item.oneTimePurchaseOfferDetailsList?.firstOrNull()

            array.put(
                JSONObject()
                    .put("productId", item.productId)
                    .put("title", item.title)
                    .put("description", item.description)
                    .put(
                        "formattedPrice",
                        offer?.formattedPrice ?: ""
                    )
                    .put(
                        "priceCurrencyCode",
                        offer?.priceCurrencyCode ?: ""
                    )
                    .put(
                        "priceAmountMicros",
                        offer?.priceAmountMicros ?: 0
                    )
            )
        }

        return JSONObject()
            .put("ok", true)
            .put("products", array)
    }

    private fun launchPurchase(
        details: ProductDetails,
        accountId: String
    ) {
        val offer =
            details.oneTimePurchaseOfferDetailsList?.firstOrNull()

        val productParams =
            BillingFlowParams.ProductDetailsParams.newBuilder()
                .setProductDetails(details)
                .apply {
                    offer?.offerToken
                        ?.takeIf { it.isNotBlank() }
                        ?.let { setOfferToken(it) }
                }
                .build()

        val builder = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(listOf(productParams))

        if (accountId.isNotBlank()) {
            val digest = MessageDigest.getInstance("SHA-256")
                .digest(accountId.toByteArray())

            val obfuscated = digest.joinToString("") {
                "%02x".format(it)
            }

            builder.setObfuscatedAccountId(obfuscated)
        }

        val result = billingClient.launchBillingFlow(
            this,
            builder.build()
        )

        if (result.responseCode !=
            BillingClient.BillingResponseCode.OK
        ) {
            emit(
                "billingError",
                JSONObject().put("message", result.debugMessage)
            )
        }
    }

    override fun onPurchasesUpdated(
        result: BillingResult,
        purchases: List<Purchase>?
    ) {
        when (result.responseCode) {

            BillingClient.BillingResponseCode.OK -> {
                purchases?.forEach {
                    sendPurchaseToPage(it)
                }
            }

            BillingClient.BillingResponseCode.USER_CANCELED -> {
                emit("purchaseCancelled", JSONObject())
            }

            else -> {
                emit(
                    "billingError",
                    JSONObject().put("message", result.debugMessage)
                )
            }
        }
    }

    private fun sendPurchaseToPage(purchase: Purchase) {
        val data = JSONObject()
            .put("purchaseToken", purchase.purchaseToken)
            .put("products", JSONArray(purchase.products))
            .put("orderId", purchase.orderId ?: "")
            .put("purchaseState", purchase.purchaseState)
            .put("isAcknowledged", purchase.isAcknowledged)
            .put("purchaseTime", purchase.purchaseTime)

        if (purchase.purchaseState ==
            Purchase.PurchaseState.PURCHASED
        ) {
            emit("purchase", data)
        } else {
            emit("purchasePending", data)
        }
    }

    private fun queryExistingPurchases() {
        val params = QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.INAPP)
            .build()

        billingClient.queryPurchasesAsync(params) { result, list ->
            if (result.responseCode ==
                BillingClient.BillingResponseCode.OK
            ) {
                list.forEach {
                    sendPurchaseToPage(it)
                }
            }
        }
    }

    private fun consumeVerifiedPurchase(
        token: String,
        done: (BillingResult) -> Unit
    ) {
        val params = ConsumeParams.newBuilder()
            .setPurchaseToken(token)
            .build()

        billingClient.consumeAsync(params) { result, _ ->
            done(result)
        }
    }

    private fun injectWalletIntegration() {
        try {
            val script = assets.open("joint-play-billing.js")
                .bufferedReader()
                .use { it.readText() }

            webView.evaluateJavascript(script, null)
        } catch (_: Exception) {}
    }

    private fun emit(type: String, data: JSONObject) {
        if (!pageReady) return

        val event = JSONObject()
            .put("type", type)
            .put("data", data)

        val encoded = JSONObject.quote(event.toString())

        runOnUiThread {
            webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent(" +
                    "'jointPlayBillingEvent'," +
                    "{detail:JSON.parse($encoded)}));",
                null
            )
        }
    }

    override fun onResume() {
        super.onResume()

        if (::billingClient.isInitialized &&
            billingClient.isReady
        ) {
            queryExistingPurchases()
        }
    }

    override fun onDestroy() {
        if (::billingClient.isInitialized) {
            billingClient.endConnection()
        }

        if (::webView.isInitialized) {
            webView.destroy()
        }

        super.onDestroy()
    }

    @Deprecated("Deprecated in Android API")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
