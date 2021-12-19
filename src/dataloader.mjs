export class MiniDataLoader {
  queue = [];

  constructor(loader) {
    this.loader = loader;
  }

  dispatchQueue = () => {
    const currentQueue = [...this.queue];
    this.queue = [];

    if (currentQueue.length > 0) {
      const keys = currentQueue.map((item) => item.key);

      this.loader(keys).then((response) => {
        currentQueue.forEach((item, index) => item.resolve(response[index]));
      });
    }
  };

  load = (key) => {
    return new Promise((resolve) => {
      this.queue.push({ key, resolve });
      queueMicrotask(() => process.nextTick(this.dispatchQueue));
    });
  };
}
