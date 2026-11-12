// Only checked-in SVG assets are imported here. User-uploaded images never use
// this code path. Preserve native SVG attributes without a legacy build plugin.
const namespace = "http://www.w3.org/2000/svg";
const icons = import.meta.glob<string>("../assets/icons/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
});
const sprite = document.createElementNS(namespace, "svg");
sprite.id = "football-icon-sprite";
sprite.setAttribute("aria-hidden", "true");
sprite.setAttribute("width", "0");
sprite.setAttribute("height", "0");
sprite.style.position = "absolute";
sprite.style.pointerEvents = "none";
Object.entries(icons).forEach(([path, source]) => {
  const name = path.slice(path.lastIndexOf("/") + 1, -4);
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  if (parsed.querySelector("parsererror") || parsed.documentElement.localName !== "svg") {
    throw new Error(`Invalid checked-in SVG icon: ${name}`);
  }
  const root = parsed.documentElement;
  const symbol = document.createElementNS(namespace, "symbol");
  Array.from(root.attributes).forEach(({ name: attribute, value }) => {
    if (!["id", "xmlns", "width", "height"].includes(attribute)) symbol.setAttribute(attribute, value);
  });
  symbol.id = `icon-${name}`;
  const ids = new Map<string, string>();
  root.querySelectorAll("[id]").forEach((element) => {
    ids.set(element.id, `icon-${name}-${element.id}`);
  });
  root.querySelectorAll("*").forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      let { value } = attribute;
      ids.forEach((replacement, oldId) => {
        if (attribute.name === "id" && value === oldId) value = replacement;
        else if (["href", "xlink:href"].includes(attribute.name) && value === `#${oldId}`) value = `#${replacement}`;
        else value = value.split(`url(#${oldId})`).join(`url(#${replacement})`);
      });
      element.setAttributeNS(attribute.namespaceURI, attribute.name, value);
    });
  });
  Array.from(root.childNodes).forEach((node) => symbol.appendChild(document.importNode(node, true)));
  sprite.appendChild(symbol);
});
document.body.prepend(sprite);
