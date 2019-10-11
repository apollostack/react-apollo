import React from 'react';
import { DocumentNode } from 'graphql';
import gql from 'graphql-tag';
import { mockSingleLink } from '@apollo/react-testing';
import { ApolloProvider, useLazyQuery } from '@apollo/react-hooks';
import { renderToStringWithData } from '@apollo/react-ssr';
import { ApolloClient } from 'apollo-client';
import { InMemoryCache } from 'apollo-cache-inmemory';

describe('useLazyQuery Hook SSR', () => {
  const CAR_QUERY: DocumentNode = gql`
    query {
      cars {
        make
        model
        vin
      }
    }
  `;

  const CAR_RESULT_DATA = {
    cars: [
      {
        make: 'Audi',
        model: 'RS8',
        vin: 'DOLLADOLLABILL',
        __typename: 'Car'
      }
    ]
  };

  it('should run query only after calling the lazy mode execute function', () => {
    const link = mockSingleLink({
      request: { query: CAR_QUERY },
      result: { data: CAR_RESULT_DATA }
    });

    const apolloClient = new ApolloClient({
      cache: new InMemoryCache(),
      link,
      ssrMode: true
    });

    const Component = () => {
      let html = null;
      const [execute, { loading, called, data, client }] = useLazyQuery(
        CAR_QUERY
      );

      if (!loading && !called) {
        expect(client).toEqual(apolloClient);
        execute();
      }

      if (!loading && called) {
        expect(client).toEqual(apolloClient);
        expect(loading).toEqual(false);
        expect(data).toEqual(CAR_RESULT_DATA);
        html = <p>{data.cars[0].make}</p>;
      }

      return html;
    };

    const app = (
      <ApolloProvider client={apolloClient}>
        <Component />
      </ApolloProvider>
    );

    return renderToStringWithData(app).then(markup => {
      expect(markup).toMatch(/Audi/);
    });
  });
});
