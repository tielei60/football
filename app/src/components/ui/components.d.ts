import type UiSelect from "./UiSelect.vue";
import type UiDialog from "./UiDialog.vue";
declare module "vue" {
  export interface GlobalComponents {
    UiSelect: typeof UiSelect;
    UiDialog: typeof UiDialog;
  }
}
export {};
