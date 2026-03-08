/**
 * Detection utility for in-app browsers (WebViews)
 * Google blocks OAuth requests from these embedded user-agents.
 */
export const isInAppBrowser = () => {
    if (typeof window === 'undefined' || !window.navigator) return false;

    const ua = navigator.userAgent || navigator.vendor || window.opera;

    // Common in-app browser signatures
    const inAppPatterns = [
        /FBAN|FBAV/i,           // Facebook
        /Instagram/i,           // Instagram
        /TikTok/i,              // TikTok
        /Threads/i,             // Threads
        /Twitter|TwitterAndroid/i, // Twitter/X
        /Line/i,                // Line
        /MicroMessenger/i,     // WeChat
        /LinkedInApp/i,        // LinkedIn
        /Snapchat/i,           // Snapchat
        /Pinterest/i,          // Pinterest
    ];

    const isInternal = inAppPatterns.some(pattern => pattern.test(ua));

    // Additional check for generic WebViews on iOS
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isSafari = /Safari/i.test(ua);
    const isChrome = /CriOS/i.test(ua);

    // On iOS, if it's not Safari or Chrome but it's a mobile device, it's likely a WebView
    const isIOSWebView = isIOS && !isSafari && !isChrome;

    return isInternal || isIOSWebView;
};

export const getPlatformHelp = () => {
    const ua = navigator.userAgent || navigator.vendor || window.opera;
    const isIOS = /iPhone|iPad|iPod/i.test(ua);

    if (isIOS) {
        return {
            platform: 'iOS',
            steps: [
                'Tap the **...** or **Share** icon at the bottom or top.',
                'Select **Open in Safari** from the menu.'
            ]
        };
    } else {
        return {
            platform: 'Android',
            steps: [
                'Tap the **...** (three dots) menu in the top right corner.',
                'Select **Open in Chrome** or **Open in Browser**.'
            ]
        };
    }
};
