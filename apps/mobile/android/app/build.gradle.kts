plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Release signing (ADR 0010 decision 13): read ONLY from the environment (CI decodes the keystore
// secret to $RUNNER_TEMP). No keystore or password is ever committed.
//   ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD
// Without them a release build is signed with the debug key only when PK_ALLOW_DEBUG_SIGNING=true
// (staging test builds); otherwise it stays unsigned and cannot be installed.
val releaseKeystorePath: String? = System.getenv("ANDROID_KEYSTORE_PATH")?.takeIf { it.isNotBlank() }
val allowDebugSigning: Boolean = System.getenv("PK_ALLOW_DEBUG_SIGNING") == "true"

android {
    namespace = "id.co.drms.proyekkas"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // Package id proposal from ADR 0010 decision 1 (client to confirm the domain).
        applicationId = "id.co.drms.proyekkas"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        // flutter_appauth's default RedirectUriReceiverActivity placeholder; our manifest replaces
        // that activity with explicit App Link + fallback-scheme filters (see AndroidManifest.xml).
        manifestPlaceholders["appAuthRedirectScheme"] = "id.co.drms.proyekkas"
    }

    // AGP 9 disables custom resValue by default; the flavors set @string/app_name through it.
    buildFeatures {
        resValues = true
    }

    flavorDimensions += "env"
    productFlavors {
        create("staging") {
            dimension = "env"
            resValue("string", "app_name", "ProyekKas STG")
            manifestPlaceholders["appLinkHost"] = "drms-kas.staging.bimacreative.tech"
        }
        create("prod") {
            dimension = "env"
            resValue("string", "app_name", "ProyekKas")
            manifestPlaceholders["appLinkHost"] = "drms-kas.bimacreative.tech"
        }
    }

    signingConfigs {
        if (releaseKeystorePath != null) {
            create("release") {
                storeFile = file(releaseKeystorePath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = when {
                releaseKeystorePath != null -> signingConfigs.getByName("release")
                allowDebugSigning -> signingConfigs.getByName("debug")
                else -> null
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
