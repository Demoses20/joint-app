
(function () {
    "use strict";

    if (window.__jointPlayBillingInstalled) return;
    window.__jointPlayBillingInstalled = true;

    function sendToAndroid(action, data = {}) {
        if (
            !window.jointPlayBilling ||
            typeof window.jointPlayBilling.postMessage !== "function"
        ) {
            throw new Error(
                "Google Play Billing is available only in the JOINT Android app."
            );
        }

        window.jointPlayBilling.postMessage(
            JSON.stringify({
                action: action,
                ...data
            })
        );
    }

    window.JOINTPlayBilling = {
        isAvailable: function () {
            return !!window.jointPlayBilling;
        },

        getProducts: function () {
            sendToAndroid("getProducts");
        },

        purchase: function (productId, accountId) {
            if (!productId) {
                throw new Error("A product ID is required.");
            }

            sendToAndroid("buy", {
                productId: productId,
                accountId: accountId || ""
            });
        },

        consumeVerifiedPurchase: function (purchaseToken) {
            if (!purchaseToken) {
                throw new Error("A purchase token is required.");
            }

            sendToAndroid("consume", {
                purchaseToken: purchaseToken
            });
        },

        onEvent: function (callback) {
            if (typeof callback !== "function") return;

            window.addEventListener(
                "jointPlayBillingEvent",
                function (event) {
                    callback(event.detail);
                }
            );
        }
    };

    window.dispatchEvent(
        new CustomEvent("jointPlayBillingReady")
    );

})();
