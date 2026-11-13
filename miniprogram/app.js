App({
  onLaunch() {
    require("./utils/media").clearImageCache();
    // Sensitive team data is loaded only after authenticated page requests.
  },
});
