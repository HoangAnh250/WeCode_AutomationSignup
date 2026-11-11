// Desktop uses the running Electron app version; preview uses the root build manifest.
export const appVersion = window.wecode?.appVersion ?? __WECODE_BUILD_VERSION__;
export const appBuildTime = new Date(__WECODE_BUILD_TIME__).toLocaleString();
