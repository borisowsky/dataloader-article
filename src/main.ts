import { setTimeout } from 'timers/promises';
import { ApolloServer, gql } from 'apollo-server';

import { MiniDataLoader } from './dataloader';

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
  {
    id: 1,
    title: 'The Awakening',
    authorId: 2,
  },
  {
    id: 2,
    title: 'City of Glass',
    authorId: 3,
  },
  {
    id: 3,
    title: 'The Green Mile',
    authorId: 1,
  },
];

const authors: Author[] = [
  {
    id: 1,
    name: 'Stephen King',
  },
  {
    id: 2,
    name: 'Kate Chopin',
  },
  {
    id: 3,
    name: 'Paul Auster',
  },
  {
    id: 4,
    name: 'Gregory Keyes',
  },
];

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

server.listen().then(({ url }) => {
  console.log(`Server ready at ${url}`);
});
