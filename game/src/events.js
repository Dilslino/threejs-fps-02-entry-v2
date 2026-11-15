// events.js — a tiny event bus with zero allocation on the hot path.
// One bus for the whole game. Gameplay systems publish facts ("a shot was
// fired here", "a footstep landed there"); audio and bot hearing subscribe.
// Nothing here imports three.js or the DOM, so the bus is trivially testable.
export function makeBus() {
  const handlers = new Map();
  return {
    on(type, fn) {
      let list = handlers.get(type);
      if (!list) { list = []; handlers.set(type, list); }
      list.push(fn);
    },
    emit(type, data) {
      const list = handlers.get(type);
      if (!list) return;
      for (let i = 0; i < list.length; i++) list[i](data);
    },
  };
}
