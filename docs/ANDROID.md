# Nyaay on Android

Nyaay is an installable web app. An Android app (APK) is a window onto your Nyaay server; the server, database and AI
stay on your PC or hosting. So the phone must be able to reach that server.

## Option 1: install it on a phone today (no APK)
Needs the server reachable from the phone over **HTTPS** (a deployed Nyaay, see DEPLOY.md).
1. Open your Nyaay address in Chrome on the phone and sign in.
2. Menu (three dots) > **Install app** (or **Add to Home screen**).
3. It opens full screen with its own icon, like any app.

Plain `http://192.168.x.x` addresses on your home Wi-Fi work for using Nyaay in the browser, but Chrome will not offer
"Install app" without HTTPS.

## Option 2: build a real APK from your deployed address
1. Deploy Nyaay with HTTPS first.
2. Go to https://www.pwabuilder.com, enter your Nyaay address, and choose **Package for stores > Android**.
3. Download the package. It includes an APK you can send to phones, and an AAB for the Play Store.
4. Keep the signing key file safe. You need the same key for every future update.

## Option 3: build it yourself (developers)
Use Bubblewrap (`npm i -g @bubblewrap/cli`, then `bubblewrap init --manifest https://YOUR-ADDRESS/manifest.webmanifest`
and `bubblewrap build`). It needs Java and the Android SDK on your PC.

## What the APK cannot do
- It cannot run the AI or the database on the phone. Without a connection it shows an offline page.
- Legal data is never stored in the app's cache: only icons and scripts are.
- Before real clients' data goes on any phone, turn on a screen lock and use a strong Nyaay password.
