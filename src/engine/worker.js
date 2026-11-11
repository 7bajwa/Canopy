// Runs the engine off the main thread so the editor never stutters while a tree regenerates.
import { evaluate, transferables } from './evaluate.js';

self.onmessage = (e) => {
  const { id, graph, opts } = e.data;
  try {
    const res = evaluate(graph, opts);
    res.id = id;
    self.postMessage(res, transferables(res));
  } catch (err) {
    self.postMessage({ id, error: String(err?.stack || err) });
  }
};
