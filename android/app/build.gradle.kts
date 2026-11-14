
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.joint.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.joint.app"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
    }

    signingConfigs {
        create("release") {
            val storeFilePath = System.getenv("JOINT_KEYSTORE_FILE")
            if (!storeFilePath.isNullOrBlank()) {
                storeFile = file(storeFilePath)
                storePassword = System.getenv("JOINT_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("JOINT_KEY_ALIAS")
                keyPassword = System.getenv("JOINT_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            val hasSigning =
                !System.getenv("JOINT_KEYSTORE_FILE").isNullOrBlank()

            if (hasSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }

        getByName("debug") {
            applicationIdSuffix = ".debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("com.android.billingclient:billing-ktx:9.1.0")
}
