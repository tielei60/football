App({
  onLaunch() {
    require("./utils/media").clearImageCache();
    require("./utils/player-photo-cache").clearAll();
    // Sensitive team data is loaded only after authenticated page requests.
  },
});
