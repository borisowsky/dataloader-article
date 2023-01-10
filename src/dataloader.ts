type QueueItem<K, V> = {
  key: K;
  resolve: (value: V) => void;
};

export class MiniDataLoader<K, V> {
  constructor(public loader: (keys: K[]) => Promise<V[]>) {}

  queue: QueueItem<K, V>[] = [];

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

  load = (key: K) => {
    return new Promise<V>((resolve) => {
      this.queue.push({ key, resolve });
      queueMicrotask(() => process.nextTick(this.dispatchQueue));
    });
  };
}
