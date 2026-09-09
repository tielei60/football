import { onMounted, onBeforeUnmount, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useGlobalStore } from "@/stores/globalStore";
import { ElMessage } from "element-plus";

export function useWorkspaceFullscreen() {
  const { isFullscreen } = storeToRefs(useGlobalStore());
  const busy = ref(false);
  let previousOverflow = "";
  const sync = () => {
    isFullscreen.value = !!document.fullscreenElement;
  };
  const exit = async () => {
    if (busy.value) return;
    busy.value = true;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      isFullscreen.value = false;
    } catch {
      ElMessage.error("退出全屏失败，请按 Esc 重试");
    } finally {
      busy.value = false;
    }
  };
  const toggle = async () => {
    if (busy.value) return;
    if (isFullscreen.value) return exit();
    busy.value = true;
    isFullscreen.value = true;
    try {
      // Embedded browsers and phones may only support an in-page expanded workspace.
      await document.documentElement.requestFullscreen?.();
    } catch {
      isFullscreen.value = true;
    } finally {
      busy.value = false;
    }
  };
  watch(
    isFullscreen,
    (active) => {
      if (active) {
        previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
      } else document.body.style.overflow = previousOverflow;
    },
    { flush: "sync" }
  );
  onMounted(() => {
    document.addEventListener("fullscreenchange", sync);
    sync();
  });
  onBeforeUnmount(() => {
    document.removeEventListener("fullscreenchange", sync);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    isFullscreen.value = false;
  });
  return { isFullscreen, fullscreenBusy: busy, toggleFullscreen: toggle, exitFullscreen: exit };
}
