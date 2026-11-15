export class ImageResources {
  private images = new Map<string, HTMLImageElement>();
  constructor(
    private readonly limit = 128,
    private readonly onLoad: () => void = () => {},
  ) {}
  get(source: string) {
    const cached = this.images.get(source);
    if (cached) {
      this.images.delete(source);
      this.images.set(source, cached);
      return cached;
    }
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = this.onLoad;
    image.src = source;
    this.images.set(source, image);
    if (this.images.size > this.limit) {
      const oldest = this.images.keys().next().value!;
      this.images.get(oldest)!.src = "";
      this.images.delete(oldest);
    }
    return image;
  }
  dispose() {
    for (const image of this.images.values()) image.src = "";
    this.images.clear();
  }
}
