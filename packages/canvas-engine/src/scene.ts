import RBush from "rbush";
import type { CanvasElement } from "./elements.js";
import { boundsOf, hitTest, type Bounds } from "./geometry.js";

type Entry = Bounds & { id: string };

export class Scene {
  private elements = new Map<string, CanvasElement>();
  private insertionOrder = new Map<string, number>();
  private nextOrder = 0;
  private index = new RBush<Entry>();
  private entries = new Map<string, Entry>();
  private bounds = new Map<string, Bounds>();
  private dirty = true;
  private sorted: CanvasElement[] = [];
  get size() {
    return this.elements.size;
  }
  get(id: string) {
    return this.elements.get(id);
  }
  all() {
    if (this.dirty) {
      this.sorted = [...this.elements.values()].sort(
        (a, b) =>
          (a.order ?? this.insertionOrder.get(a.id)!) -
          (b.order ?? this.insertionOrder.get(b.id)!),
      );
      this.dirty = false;
    }
    return this.sorted;
  }
  set(element: CanvasElement) {
    if (this.elements.get(element.id) === element) return;
    const old = this.entries.get(element.id);
    if (old) this.index.remove(old);
    this.elements.set(element.id, element);
    if (!this.insertionOrder.has(element.id))
      this.insertionOrder.set(element.id, this.nextOrder++);
    const entry = { ...boundsOf(element), id: element.id };
    this.entries.set(element.id, entry);
    this.bounds.set(element.id, entry);
    this.index.insert(entry);
    this.dirty = true;
  }
  delete(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.index.remove(entry);
    this.entries.delete(id);
    this.bounds.delete(id);
    this.elements.delete(id);
    this.insertionOrder.delete(id);
    this.dirty = true;
    return true;
  }
  clear() {
    this.elements.clear();
    this.insertionOrder.clear();
    this.entries.clear();
    this.bounds.clear();
    this.index.clear();
    this.dirty = true;
  }
  query(area: Bounds) {
    return this.index
      .search(area)
      .map((entry) => this.elements.get(entry.id)!)
      .filter(Boolean)
      .sort(
        (a, b) =>
          (a.order ?? this.insertionOrder.get(a.id)!) -
          (b.order ?? this.insertionOrder.get(b.id)!),
      );
  }
  hit(x: number, y: number, tolerance = 6) {
    return [
      ...this.query({
        minX: x - tolerance,
        minY: y - tolerance,
        maxX: x + tolerance,
        maxY: y + tolerance,
      }),
    ]
      .reverse()
      .find((element) => hitTest(element, x, y, tolerance));
  }
  getBounds(id: string) {
    return this.bounds.get(id);
  }
}
