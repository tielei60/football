// 把克隆 SVG 内的 <image> 外部引用转成 dataURL，避免导出 PNG/SVG/缩略图时
// 因 SVG 沙箱隔离导致照片、球图标丢失
export async function inlineImages(root: ParentNode) {
  const images = root.querySelectorAll("image");
  await Promise.all(
    Array.from(images).map(async (img) => {
      const href = img.getAttribute("href");
      if (!href || href.startsWith("data:")) return;
      try {
        const res = await fetch(href);
        if (!res.ok) return;
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        img.setAttribute("href", dataUrl);
      } catch {
        // 内联失败则保留原引用，不阻塞导出
      }
    })
  );
}
