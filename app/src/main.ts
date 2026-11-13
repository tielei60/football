import "./assets/styles/main.css";
import "./utils/registerIcons";
import "element-plus/es/components/message/style/css";
import { createApp } from "vue";
import { debug } from "./utils/debugBus";
import router from "./router";
import App from "./App.vue";
import UiSelect from "./components/ui/UiSelect.vue";
import UiDialog from "./components/ui/UiDialog.vue";
import UiConfirmHost from "./components/ui/UiConfirmHost.vue";
import pinia from "./stores/index.js";

const app = createApp(App);
if (import.meta.env.DEV) {
  window.$debug = debug;
}

app.component("UiSelect", UiSelect);
app.component("UiDialog", UiDialog);
app.use(pinia);
app.use(router);
app.mount("#app");

const confirmationRoot = document.createElement("div");
confirmationRoot.id = "ui-confirmation-root";
document.body.append(confirmationRoot);
createApp(UiConfirmHost).mount(confirmationRoot);
