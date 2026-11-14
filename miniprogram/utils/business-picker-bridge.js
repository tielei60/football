// Explicit page ownership through a bound pickeropen event, never global page lookup.
const requests = new Map();
let serial = 0;
function request(component, config) {
  const requestId = "business-picker-" + ++serial;
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  const entry = { config, resolve, claimed: false, timer: null };
  requests.set(requestId, entry);
  // Component events may cross the view/logic bridge asynchronously. Allow the
  // explicit owner to claim the request; only abandoned triggers expire.
  entry.timer = setTimeout(() => {
    if (requests.get(requestId) === entry && !entry.claimed) cancel(requestId);
  }, 2000);
  try {
    component.triggerEvent("pickeropen", { requestId });
  } catch (_) {
    cancel(requestId);
  }
  return { requestId, promise };
}
async function open(page, event) {
  const id = event?.detail?.requestId,
    entry = requests.get(id);
  if (!entry || entry.claimed) return;
  entry.claimed = true;
  clearTimeout(entry.timer);
  entry.timer = null;
  try {
    const ui = require("./ui");
    const result = await ui.showPicker(page, entry.config);
    if (requests.get(id) === entry) entry.resolve(result);
  } catch (_) {
    entry.resolve({ aborted: true, confirm: false, cancel: true });
  } finally {
    requests.delete(id);
  }
}
function cancel(id) {
  const e = requests.get(id);
  if (e) {
    clearTimeout(e.timer);
    requests.delete(id);
    e.resolve({ aborted: true, confirm: false, cancel: true });
  }
}
module.exports = { request, open, cancel };
