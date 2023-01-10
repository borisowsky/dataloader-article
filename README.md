# DataLoader – understanding how it works by building it from scratch

## Intro

If you are willing to understand how DataLoader works, you should understand how Node.js works intentionally. Some of the basics at least. JavaScript is an asynchronous language, meaning that its engine (V8) can run non-blocking (asynchronous) operations simultaneously with synchronous tasks.

I assume that you already have some experience working with DataLoader, most likely with GraphQL, so you know why DataLoader is so powerful, but you also want to know how it works in Node.js.

In my opinion, the best way to understand how it works is to build it from scratch.

## Usage

The most common use case for DataLoader is batching multiple queries/function calls in one single function call, for example:

```js
const loaderFn = async (keys) => {
  const result = await fetch('/api', {
    params: { ids: ids },
  });

  console.log('loaderFn called with', keys);

  return result;
};

const loader = new DataLoader(loaderFn);

loader.load(1);
loader.load(2);
loader.load(3);
loader.load(4);
// In console: loaderFn called with [1, 2, 3, 4]
```

Look how `loaderFn` is called with all the keys (1, 2, 3, 4) _after_ all `loader.load` function calls. Now we have to figure out how to implement a DataLoader class step by step following these requirements:

1. DataLoader instances have to receive an asynchronous loader function.
2. It needs to have `load` method. It should also be asynchronous, so we can call it in parallel.
3. Execute loader function _after_ all the `load` method calls.

## Implementing

As it's heavily inspired by Meta's (ex. Facebook) [DataLoader](https://github.com/graphql/dataloader) - let's call it MiniDataLoader (it will have much less functionality (there will be no cache system, no error handling, etc.)).

```diff
+ class MiniDataLoader<K, V> {
+   constructor(public loader: (keys: K[]) => Promise<V[]>) {}
+ }
```

The start is simple, we need to store the loader function inside DataLoader class, so we can refer to it later.

```diff
+ type QueueItem<K, V> = {
+   key: K;
+   resolve: (value: V) => void;
+ };

  class MiniDataLoader<K, V> {
    constructor(public loader: (keys: K[]) => Promise<V[]>) {}

+   queue: QueueItem<K, V>[] = [];

+   load = (key: K) => {
+     return new Promise<V>((resolve) => {
+       this.queue.push({ key, resolve });
+       // TODO: Call this.loader this all the keys
+     });
+   }
  }
```

The idea behind `load` method is to store an object with a key and resolve function values. The reason why we are passing `resolve` function is the ability to resolve these promises outside of this method (e. g. `loader.load(1).then((result) => console.log('result for key 1:', result))`).

```diff
  type QueueItem<K, V> = {
    key: K;
    resolve: (value: V) => void;
  };

  export class MiniDataLoader<K, V> {
    constructor(public loader: (keys: K[]) => Promise<V[]>) {}

    queue: QueueItem<K, V>[] = [];

+   dispatchQueue = () => {}

    load = (key: K) => {
      return new Promise<V>((resolve) => {
        this.queue.push({ key, resolve });
-       // TODO: Call this.loader this all the keys
+       queueMicrotask(() => process.nextTick(this.dispatchQueue));
      });
    }
  }
```

`dispatchQueue` method is a function that we need to call after all the `load` statements.

To achive that `dispatchQueue` function should be executed _after_ all the `load` calls, in the server's next tick. So here comes the `process.nextTick` API. It is a core Node.js API that allows its function argument to be called synchronously in the next frame of execution (aka next tick). But we also want to make sure that `dispatchQueue` executes _after_ Promise resolution process, or simply said, in the end of all asynchornous operations, so to do that we have to pass `dispatchQueue` into `queueMicrotask` (or similar API `setImmediate`) function.

```diff
  type QueueItem<K, V> = {
    key: K;
    resolve: (value: V) => void;
  };

  class MiniDataLoader {
    queue = [];

    constructor(loader) {
      this.loader = loader;
    }

-   dispatchQueue = () => {}
+   dispatchQueue = () => {
+     const currentQueue = [...this.queue];
+     this.queue = [];
+
+     if (currentQueue.length > 0) {
+       const keys = currentQueue.map((item) => item.key);
+
+       this.loader(keys).then((response) => {
+         currentQueue.forEach((item, index) => item.resolve(response[index]));
+       });
+     }
+   }

    load = (key: K) => {
      return new Promise<V>((resolve) => {
        this.queue.push({ key, resolve });
        queueMicrotask(() => process.nextTick(this.dispatchQueue));
      });
    };
  }
```

Initially, `dispatchQueue` will be called as many times as `load` function, but as we have control of _when_ its executed, we can simply restrict if from being called more than once in the currect frame by clearing the `queue` after the first call as we don't need it anymore.

## Real example

Let's test it by writing some GraphQL server with `N+1` problem in mind (it appears when you try to load the `Author` node on each `Book` item) and solve it with the `MiniDataLoader`.

```js
// Node.js ^15.0.0
import { setTimeout } from 'timers/promises';
import { ApolloServer, gql } from 'apollo-server';

import { MiniDataLoader } from './dataloader.mjs';

const typeDefs = gql`
  type Author {
    id: ID!
    name: String!
  }

  type Book {
    id: ID!
    title: String!
    author: Author!
  }

  type Query {
    books: [Book!]
    author: Author!
  }
`;

interface Book {
  id: number;
  title: string;
  authorId: number;
}

interface Author {
  id: number;
  name: string;
}

const books: Book[] = [
  { id: 1, title: 'The Awakening', authorId: 1 } /* ... */,
];

const authors: Author[] = [{ id: 1, name: 'Kate Chopin' } /* ... */];

const batchLoadAuthors = async (keys: number[]) => {
  // SELECT * FROM authors WHERE id IN (keys)
  const result = keys.map((key) => authors.find((author) => author.id === key));

  return await setTimeout(200, result);
};

const authorsLoader = new MiniDataLoader(batchLoadAuthors);

const resolvers = {
  Book: {
    author: async (root: Book) => {
      const author = await authorsLoader.load(root.authorId);

      return author;
    },
  },
  Query: {
    books: () => books,
  },
};

const server = new ApolloServer({ typeDefs, resolvers });

server.listen();
```

```bash
curl -g \
-X POST \
-H "Content-Type: application/json" \
-d '{"query":"query GetBooks {books {author {name}}}"}' \
http://localhost:4000/graphql
```

If we execute this query against the GraphQL server, we get all nested data, and also, in our console, we can see the "It executes only once!" message from our "console.log" statement, which actually appears only once, meaning that our `MiniDataLoader` is working as expected!

## Conclusion

At first glance, DataLoader might look like magic, but eventually, it just uses the basic principle of Node.js runtime – Event loop. The key thing is to tell Node.js how to execute the loader function once after all the `load` calls happen, by managing asynchronous flow with `queueMicrotask` and `process.nextTick` built-in functions.
