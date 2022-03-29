# DataLoader – understanding how it works by building it from scratch

## Intro

If you are willing to understand how DataLoader works, you should understand how Node.js works intentionally. Some of the basics at least. JavaScript is an asynchronous language, meaning that its engine (V8) can run non-blocking (asynchronous) operations simultaneously with synchronous tasks.

I assume that you already have some experience working with DataLoader, most likely with GraphQL, so you know why DataLoader is so powerful, but you also want to know how it works in Node.js.

In my opinion, the best way to understand how it works is to build it from scratch.

## Usage

The most common use case for DataLoader is batching multiple queries/function calls in one single function call, for example:

```js
const loaderFunction = async (keys) => {
  const result = await fetch('/api', {
    params: { ids: ids },
  });

  console.log('loaderFunction called with', keys);

  return result;
};

const loader = new DataLoader(loaderFunction);

loader.load(1);
loader.load(2);
loader.load(3);
loader.load(4);
// In console: loaderFunction called with [1, 2, 3, 4]
```

Look how loaderFunction is called with all the keys (1, 2, 3, 4) _after_ all `loader.load` function calls. Now we have to figure out how to implement a DataLoader class step by step following these requirements:

1. DataLoader instances have to receive an asynchronous loader function.
2. It needs to have `load` method, it should also be asynchronous, so we can call it in parallel.
3. Somehow execute loader function after all the `load` method calls.

## Implementing

As it's heavily inspired by Meta's (ex. Facebook) [DataLoader](https://github.com/graphql/dataloader) - let's call it MiniDataLoader (it will have much less functionality (there will be no cache system, no error handling, etc.)).

```diff
+ class MiniDataLoader {
+   constructor(loader) {
+     this.loader = loader;
+   }
+ }
```

The start is simple, we need to store the loader function inside DataLoader class, so we can refer to it later.

```diff
  class MiniDataLoader {
+   queue = [];

    constructor(loader) {
      this.loader = loader;
    }

+   load = (key) => {
+     return new Promise((resolve) => {
+       this.queue.push({ key, resolve });
+       // TODO: Call this.loader this all the keys
+     });
+   }
  }
```

The idea behind `load` method is to store an object with a key and resolve function values. The reason why we are passing `resolve` function is the ability to resolve these promises outside of this method (e. g. `loader.load(1).then((result) => console.log('result for key 1:', result))`).

```diff
  class MiniDataLoader {
    queue = [];

    constructor(loader) {
      this.loader = loader;
    }

+   dispatchQueue = () => {}

    load = (key) => {
      return new Promise((resolve) => {
        this.queue.push({ key, resolve });
-       // TODO: Call this.loader this all the keys
+       queueMicrotask(() => process.nextTick(this.dispatchQueue));
      });
    }
  }
```

`dispatchQueue` method is a function that will be called after all the `load` statements during the Node.js server tick.

In order to dispatch `dispatchQueue` method _after_ the synchronous, we have to pass it as callback in `process.nextTick` function (which is Node.js API), and also, to make sure `dispatchQueue` executes _after_ Promise resolution process, we have to wrap it into `queueMicrotask` functions (which is also Node.js API). This is the key thing to make DataLoader work.

```diff
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

    load = (key) => {
      return new Promise((resolve) => {
        this.queue.push({ key, resolve });
        queueMicrotask(() => process.nextTick(this.dispatchQueue));
      });
    }
  }
```

As you may guess, `dispatchQueue` will be called as many times as you call the `load` method on a loader. But because of the "trick" with calling them in the next frame of execution, our `queue` will be valid at the first `dispatchQueue` call.

That being said, in order to call our `loader` function just once, we have to clear the `queue` after the first `dispatchQueue` call and make sure we resolve the promises queue only when our `queue` isn't empty.

## Real example

Let's test it by writing some simple GraphQL server with `N+1` (it appears when you try to load the `Author` node on each `Book` item) problem and try to solve it using our MiniDataLoader.

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

const books = [{ id: 1, title: 'The Awakening', authorId: 1 } /* ... */];
const authors = [{ id: 1, name: 'Kate Chopin' } /* ... */];

const batchLoadAuthors = async (keys) => {
  console.log('It executes only once!');

  // Imitate an asynchronous API call
  return await setTimeout(
    200,
    keys.map((key) => authors.find((author) => author.id === key)),
  );
};

const authorsLoader = new MiniDataLoader(batchLoadAuthors);

const resolvers = {
  Book: {
    author: (root) => {
      return authorsLoader.load(root.authorId);
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
